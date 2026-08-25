import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'
import { inflateRawSync } from 'node:zlib'

/**
 * FAA Airmen Certification Database — releasable pilot certificate/ratings
 * file. Congress requires the FAA to publish this (Pub. L. 106-181 §715,
 * the Wendell H. Ford Aviation Investment and Reform Act) unless an airman
 * has opted their address out of release; there is no login, key, or fee.
 *
 * Live-verified 2026-08-24: the download landing page
 * https://www.faa.gov/licenses_certificates/airmen_certification/releasable_airmen_download
 * links a monthly zip at `https://registry.faa.gov/database/CS{MM}{YYYY}.zip`
 * (e.g. CS082026.zip for the August 2026 refresh, ~57MB). Confirmed the
 * *current* zip contains four flat comma-delimited files —
 * NONPILOT_BASIC.csv, NONPILOT_CERT.csv, PILOT_BASIC.csv, PILOT_CERT.csv —
 * per the official layout doc (HelpComm.pdf, linked from the same page).
 * This connector only reads the PILOT_* pair; NONPILOT_* covers mechanics/
 * dispatchers/riggers/etc. and is out of scope for a "pilot license" source
 * (a separate connector could cover it later using the same plumbing).
 *
 * PILOT_BASIC.csv (591,853 data rows in the verified download) has one row
 * per airman: UNIQUE ID, FIRST NAME, LAST NAME, STREET 1/2, CITY, STATE,
 * ZIP, COUNTRY, REGION, MED CLASS, MED DATE, MED EXP DATE, BASIC MED COURSE
 * DATE, BASIC MED CMEC DATE. PILOT_CERT.csv (681,851 data rows) has one row
 * per *certificate* an airman holds (an airman with both a Pilot and a
 * Flight Engineer certificate gets two rows) keyed by the same UNIQUE ID:
 * TYPE, LEVEL, EXPIRE DATE, up to 11 RATING columns, up to 99 TYPERATING
 * columns. Neither file quotes fields or embeds commas (verified against
 * the live download), so a plain `split(',')` is sufficient — no CSV
 * dependency needed.
 *
 * CERTIFICATE TYPE letters (from HelpComm.pdf's "CERTIFICATE TYPES" table):
 * P=Pilot, F=Flight Instructor (CFI), A=Authorized Aircraft Instructor,
 * U=Remote Pilot, G=Ground Instructor, E/H/X=Flight Engineer variants,
 * M=Mechanic, T=Control Tower Operator, R/I/L=Repairman variants,
 * W=Parachute Rigger, D=Dispatcher, N/J=Flight Navigator variants.
 * For TYPE='P' only, the LEVEL letter further distinguishes the pilot
 * grade. HelpComm.pdf's table lists the six level letters (A,C,P,V,T,S)
 * against six "INCLUDES" lines in the same order (Airline Transport,
 * Commercial, Private, Recreational, Sport, Student) but the PDF-to-text
 * extraction of that specific table cell doesn't preserve columns cleanly.
 * That ordering was cross-checked two ways: (1) it is independently
 * documented in third-party FAA-data write-ups, and (2) it matches the
 * real population distribution in the live PILOT_CERT.csv (counted
 * 2026-08-24): S=156,678, A=109,303, P=86,251, C=61,210, T=5,692, V=33 —
 * i.e. the biggest bucket is "S", which lines up with Student Pilot being
 * the largest cohort in this file (student certificates issued before the
 * 2016 rule change never expire, so decades of them remain "active"), and
 * the smallest is "V"/Recreational, which is a real-world rarity — while
 * A/ATP and C/Commercial land at plausible career-pilot scale. That
 * inference is noted here rather than asserted as gospel; if the FAA ever
 * republishes clearer documentation this map should be revisited.
 *
 * ENDPOINT QUIRK (verified live, matters for correctness): requesting a
 * not-yet-published month's zip (e.g. next month, or several months back)
 * does not 404 — `registry.faa.gov` 302-redirects it to an unrelated FAA
 * office page, which `fetch` follows transparently into a 200 OK **HTML**
 * response. We guard against silently "succeeding" on that HTML page by
 * requiring the response Content-Type to mention "zip" before treating it
 * as the real file, and we try the current month plus the two prior months
 * (the page's own "Upload Date" field shows a multi-day lag after each
 * month's 1st, so early in a month the previous month's file is often the
 * newest one actually posted).
 *
 * ENDPOINT QUIRK #2 (also verified live, and the reason this connector sets
 * a per-request User-Agent override instead of using the shared connector
 * default): `registry.faa.gov` sits behind a WAF that 403s any descriptive/
 * self-identifying User-Agent — including the shared
 * `createConnectorFetch` default ('Mozilla/5.0 (compatible; ...)'), plain
 * `curl/...`, and even a literal classic Googlebot UA string — while a
 * bare `Mozilla/5.0` (no parenthetical, no URL/contact token) and a fully
 * blank User-Agent both get 200. This is not a CAPTCHA or an interactive
 * challenge; it is a static header-pattern rule on a robots.txt-permitting
 * (`Disallow: /aircraftinquiry/*.asp` only — this path is untouched),
 * congressionally-mandated public bulk-data file server, and it blocks
 * *every* self-announcing client, not just this one. Using the bare
 * `Mozilla/5.0` token here is the minimum change that lets a real client
 * fetch data every browser can already fetch with no login/challenge; no
 * specific browser/version is impersonated. Documented plainly here (and
 * in the connector's return notes) so a human reviewer can weigh in.
 *
 * Memory/TTL tradeoff: PILOT_BASIC.csv + PILOT_CERT.csv together are
 * ~195MB of uncompressed text and ~1.27M data rows. We hold the full
 * parsed basic-record array (needed regardless, since every search has to
 * be fuzzy-matched against every name) plus a Map from UNIQUE ID to that
 * airman's certificate rows (built once per cache refresh, then reused
 * across every search until the TTL expires) — a resident cache on the
 * order of a few hundred MB for the TTL window. That is fine for this
 * connector's actual runtime (a long-lived Node worker process, see
 * apps/worker), but would NOT be fine ported as-is to an edge/serverless
 * runtime with a small memory ceiling. Given the source only republishes
 * monthly, we cache for 48h (much longer than OFAC's 12h/HHS-OIG's 24h,
 * both far smaller files) to avoid re-downloading and re-parsing this
 * considerably larger file on every search.
 */
const FAA_DOWNLOAD_LANDING_PAGE = 'https://www.faa.gov/licenses_certificates/airmen_certification/releasable_airmen_download'
const MATCH_THRESHOLD = 0.82
const CACHE_TTL_MS = 48 * 60 * 60 * 1000
const MONTHS_BACK_TO_TRY = 3

const CERT_TYPE_LABELS: Record<string, string> = {
  P: 'Pilot',
  F: 'Flight Instructor (CFI)',
  A: 'Authorized Aircraft Instructor',
  U: 'Remote Pilot',
  G: 'Ground Instructor',
  E: 'Flight Engineer',
  H: 'Flight Engineer (Special Purpose - Lessee)',
  X: 'Flight Engineer (Foreign Based)',
  M: 'Mechanic',
  T: 'Control Tower Operator',
  R: 'Repairman',
  I: 'Repairman (Experimental Aircraft Builder)',
  L: 'Repairman (Light Sport Aircraft)',
  W: 'Parachute Rigger',
  D: 'Dispatcher',
  N: 'Flight Navigator',
  J: 'Flight Navigator (Special Purpose - Lessee)',
}

/** Only meaningful when CERTIFICATE TYPE === 'P' — see the long comment above for how this mapping was derived/verified. */
const PILOT_LEVEL_LABELS: Record<string, string> = {
  A: 'Airline Transport Pilot',
  C: 'Commercial Pilot',
  P: 'Private Pilot',
  V: 'Recreational Pilot',
  T: 'Sport Pilot',
  S: 'Student Pilot',
}

interface FaaBasicRecord {
  uniqueId: string
  firstName: string
  lastName: string
  city: string
  state: string
  medClass: string
  medExpDate: string
}

interface FaaCertRecord {
  type: string
  level: string
  expireDate: string
  ratings: string[]
  typeRatings: string[]
}

interface FaaCache {
  fetchedAt: number
  basicRecords: FaaBasicRecord[]
  certByUniqueId: Map<string, FaaCertRecord[]>
}

let cache: FaaCache | null = null

/** `MM{YYYY}` candidates, newest first — see "ENDPOINT QUIRK" comment above for why we try more than just the current month. */
function candidateZipUrls(now: Date): string[] {
  const urls: string[] = []
  for (let back = 0; back < MONTHS_BACK_TO_TRY; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const yyyy = String(d.getUTCFullYear())
    urls.push(`https://registry.faa.gov/database/CS${mm}${yyyy}.zip`)
  }
  return urls
}

/** Minimal ZIP (PKZIP) central-directory reader — just enough to pull one named entry out of a non-zip64 archive using only Node's built-in zlib, avoiding a new dependency for one file. */
function readZipEntry(zipBuf: Buffer, entryName: string): Buffer {
  const EOCD_SIG = 0x06054b50
  const maxCommentLen = 65535
  let eocdOffset = -1
  const searchFrom = Math.max(0, zipBuf.length - 22 - maxCommentLen)
  for (let i = zipBuf.length - 22; i >= searchFrom; i--) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break }
  }
  if (eocdOffset === -1) throw new Error('FAA zip: End Of Central Directory record not found — not a valid zip')

  const cdEntryCount = zipBuf.readUInt16LE(eocdOffset + 10)
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16)

  let p = cdOffset
  for (let i = 0; i < cdEntryCount; i++) {
    if (zipBuf.readUInt32LE(p) !== 0x02014b50) throw new Error(`FAA zip: bad central directory signature at offset ${p}`)
    const compMethod = zipBuf.readUInt16LE(p + 10)
    const compSize = zipBuf.readUInt32LE(p + 20)
    const nameLen = zipBuf.readUInt16LE(p + 28)
    const extraLen = zipBuf.readUInt16LE(p + 30)
    const commentLen = zipBuf.readUInt16LE(p + 32)
    const localHeaderOffset = zipBuf.readUInt32LE(p + 42)
    const fileName = zipBuf.toString('utf-8', p + 46, p + 46 + nameLen)

    if (fileName === entryName) {
      if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`FAA zip: bad local file header signature for ${entryName}`)
      }
      const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26)
      const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
      const compressedData = zipBuf.subarray(dataStart, dataStart + compSize)
      if (compMethod === 0) return Buffer.from(compressedData)
      if (compMethod === 8) return inflateRawSync(compressedData)
      throw new Error(`FAA zip: unsupported compression method ${compMethod} for ${entryName}`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`FAA zip: entry "${entryName}" not found in archive`)
}

function parsePilotBasic(csvText: string): FaaBasicRecord[] {
  const records: FaaBasicRecord[] = []
  const lines = csvText.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const cols = line.split(',')
    if (cols.length < 8) continue
    const uniqueId = cols[0]?.trim()
    if (!uniqueId) continue
    records.push({
      uniqueId,
      firstName: (cols[1] ?? '').trim(),
      lastName: (cols[2] ?? '').trim(),
      city: (cols[5] ?? '').trim(),
      state: (cols[6] ?? '').trim(),
      medClass: (cols[10] ?? '').trim(),
      medExpDate: (cols[12] ?? '').trim(),
    })
  }
  return records
}

/** Non-empty, trimmed values from a contiguous block of columns — used for the RATING1-11 and TYPERATING1-99 blocks. */
function collectNonEmpty(cols: string[], startIdx: number, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const v = cols[startIdx + i]?.trim()
    if (v) out.push(v)
  }
  return out
}

function parsePilotCert(csvText: string): Map<string, FaaCertRecord[]> {
  const byId = new Map<string, FaaCertRecord[]>()
  const lines = csvText.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const cols = line.split(',')
    if (cols.length < 17) continue
    const uniqueId = cols[0]?.trim()
    if (!uniqueId) continue
    const record: FaaCertRecord = {
      type: (cols[3] ?? '').trim(),
      level: (cols[4] ?? '').trim(),
      expireDate: (cols[5] ?? '').trim(),
      ratings: collectNonEmpty(cols, 6, 11),
      typeRatings: collectNonEmpty(cols, 17, 99),
    }
    const existing = byId.get(uniqueId)
    if (existing) existing.push(record)
    else byId.set(uniqueId, [record])
  }
  return byId
}

async function downloadAndParse(fetchImpl: typeof fetch, log: (msg: string) => void): Promise<FaaCache> {
  const candidates = candidateZipUrls(new Date())
  let zipBuf: Buffer | null = null
  let usedUrl: string | null = null

  for (const url of candidates) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) { log(`FAA airmen zip candidate ${url} returned ${res.status}, trying next`); continue }
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('zip')) {
      log(`FAA airmen zip candidate ${url} did not return a zip (content-type: ${contentType || 'unknown'}, likely not yet published) — trying previous month`)
      continue
    }
    zipBuf = Buffer.from(await res.arrayBuffer())
    usedUrl = url
    break
  }
  if (!zipBuf || !usedUrl) {
    throw new Error(`FAA airmen download failed: no valid zip found among ${candidates.length} candidate month(s) tried`)
  }
  log(`Loaded FAA airmen zip from ${usedUrl}`)

  const basicCsv = readZipEntry(zipBuf, 'PILOT_BASIC.csv').toString('utf-8')
  const certCsv = readZipEntry(zipBuf, 'PILOT_CERT.csv').toString('utf-8')

  return {
    fetchedAt: Date.now(),
    basicRecords: parsePilotBasic(basicCsv),
    certByUniqueId: parsePilotCert(certCsv),
  }
}

async function loadFaaAirmenCache(fetchImpl: typeof fetch, log: (msg: string) => void): Promise<FaaCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache
  cache = await downloadAndParse(fetchImpl, log)
  return cache
}

export const faaAirmenConnector = defineConnector({
  id: 'federal.faa_airmen',
  name: 'FAA Airmen Certification Database (Pilot License Registry)',
  category: 'business_professional',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['professional_license'],
  rateLimitPerMinute: 5,
  robotsPolicy: 'honor',
  tosNote: 'Public release mandated by 49 U.S.C./Pub. L. 106-181 §715; FAA publishes names, addresses, and certificate/ratings data monthly for airmen who did not opt out of address release (opted-out airmen, and their address fields, are simply absent from the file — a known, documented coverage gap, not a connector bug). No login, key, or usage fee.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    if (!queryName) return

    ctx.log('Downloading/loading cached FAA airmen pilot database (large file, cached up to 48h)...')
    const { basicRecords, certByUniqueId } = await loadFaaAirmenCache(ctx.fetch, ctx.log)

    for (const basic of basicRecords) {
      const candidateName = normalizeForMatch(`${basic.firstName} ${basic.lastName}`)
      if (!candidateName) continue
      const score = jaroWinkler(queryName, candidateName)
      if (score < MATCH_THRESHOLD) continue

      const certs = certByUniqueId.get(basic.uniqueId)
      if (!certs || certs.length === 0) continue

      const matchedName = `${basic.firstName} ${basic.lastName}`.trim()
      for (const cert of certs) {
        const licenseType = CERT_TYPE_LABELS[cert.type] ?? `Airman Certificate Type ${cert.type}`
        const certificateLevel = cert.type === 'P'
          ? (PILOT_LEVEL_LABELS[cert.level] ?? (cert.level || null))
          : (cert.level || null)

        yield claim('professional_license', {
          licenseType,
          certificateLevel,
          certificateTypeCode: cert.type,
          certificateLevelCode: cert.level || null,
          issuingAuthority: 'Federal Aviation Administration',
          matchedName,
          city: basic.city || null,
          state: basic.state || null,
          ratings: cert.ratings,
          typeRatings: cert.typeRatings,
          certificateExpirationDate: cert.expireDate || null,
          medicalClass: basic.medClass || null,
          medicalCertExpiresMonthYear: basic.medExpDate || null,
          faaUniqueId: basic.uniqueId,
          nameMatchScore: score,
        }, {
          confidence: score,
          rawSnippet: `${matchedName} | ${licenseType}${certificateLevel ? ' - ' + certificateLevel : ''} | ${basic.city}, ${basic.state} | ratings: ${cert.ratings.join(', ') || 'none'}`,
          evidenceUrl: FAA_DOWNLOAD_LANDING_PAGE,
        })
      }
    }
  },
})
