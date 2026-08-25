import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'

/**
 * HHS Office of Inspector General — List of Excluded Individuals/Entities
 * (LEIE). Federal healthcare-fraud exclusion list: providers and businesses
 * barred from participating in Medicare/Medicaid/federal health programs
 * under Social Security Act §1128. Published as a single flat-file bulk
 * CSV, republished (in place, same URL) roughly monthly — confirmed live
 * 2026-08-24: 200 OK, Content-Type text/csv, Last-Modified 2026-08-10,
 * ~15.5MB, no API key. Header row confirmed live matches the 18 columns
 * below exactly.
 *
 * No per-record permalink exists in the CSV itself — the only public
 * per-record lookup is the online search tool, which redirect-loops for a
 * plain unauthenticated GET (confirmed live), so `evidenceUrl` points at
 * the exclusions program landing page instead; the CSV download URL below
 * is the actual, reproducible evidence for any given claim.
 */
const LEIE_CSV_URL = 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv'
const LANDING_PAGE_URL = 'https://oig.hhs.gov/exclusions/'
const MATCH_THRESHOLD = 0.82
// LEIE is republished monthly (not daily like some sanctions feeds), and the
// file is ~15.5MB, so we cache considerably longer than OFAC's SDN connector
// to avoid re-pulling a large file on every search.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface LeieRecord {
  lastName: string
  firstName: string
  midName: string
  busName: string
  general: string
  specialty: string
  npi: string
  dob: string
  address: string
  city: string
  state: string
  zip: string
  exclType: string
  exclDate: string
  reinDate: string
  waiverDate: string
  wvrState: string
}

let cache: { records: LeieRecord[]; fetchedAt: number } | null = null

/** Minimal quoted-CSV row splitter — LEIE quotes every field (including empty ones); handles embedded commas/escaped quotes without a CSV dependency. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { current += ch }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

/** LEIE uses the literal string "NULL" in a handful of rows as a missing-data placeholder rather than leaving the field blank. */
function cleanField(v: string | undefined): string {
  const trimmed = (v ?? '').trim()
  return trimmed.toUpperCase() === 'NULL' ? '' : trimmed
}

/** LEIE dates are YYYYMMDD, with "00000000" meaning "not applicable" (e.g. never reinstated). */
function parseYyyymmdd(s: string): Date | null {
  if (!s || s === '00000000' || s.length !== 8) return null
  const year = Number(s.slice(0, 4))
  const month = Number(s.slice(4, 6))
  const day = Number(s.slice(6, 8))
  const dt = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(dt.getTime()) ? null : dt
}

async function loadLeieList(fetchImpl: typeof fetch): Promise<LeieRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records

  const res = await fetchImpl(LEIE_CSV_URL)
  if (!res.ok) throw new Error(`HHS-OIG LEIE download failed: ${res.status}`)
  const text = await res.text()

  const records: LeieRecord[] = []
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    // skip header row
    const line = lines[i]
    if (!line || !line.trim()) continue
    const cols = parseCsvLine(line)
    if (cols.length < 18) continue
    const [lastName, firstName, midName, busName, general, specialty, , npi, dob, address, city, state, zip, exclType, exclDate, reinDate, waiverDate, wvrState] = cols
    records.push({
      lastName: cleanField(lastName),
      firstName: cleanField(firstName),
      midName: cleanField(midName),
      busName: cleanField(busName),
      general: cleanField(general),
      specialty: cleanField(specialty),
      npi: cleanField(npi),
      dob: cleanField(dob),
      address: cleanField(address),
      city: cleanField(city),
      state: cleanField(state),
      zip: cleanField(zip),
      exclType: cleanField(exclType),
      exclDate: cleanField(exclDate),
      reinDate: cleanField(reinDate),
      waiverDate: cleanField(waiverDate),
      wvrState: cleanField(wvrState),
    })
  }
  cache = { records, fetchedAt: Date.now() }
  return records
}

/** Candidate full-name strings to compare against the query — with and without middle name, since queries usually omit it. */
function candidateNames(rec: LeieRecord): string[] {
  const withMiddle = [rec.firstName, rec.midName, rec.lastName].filter(Boolean).join(' ')
  const withoutMiddle = [rec.firstName, rec.lastName].filter(Boolean).join(' ')
  return [...new Set([withMiddle, withoutMiddle].filter((s) => s.length > 0))]
}

export const hhsOigExclusionsConnector = defineConnector({
  id: 'federal.hhs_oig_exclusions',
  name: 'HHS-OIG List of Excluded Individuals/Entities (LEIE)',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['exclusion_listing'],
  rateLimitPerMinute: 10,
  robotsPolicy: 'honor',
  tosNote: 'U.S. government public-domain data published under Social Security Act §1128; HHS-OIG explicitly intends the LEIE for public/provider due-diligence screening — no usage restriction, no key required.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    if (!queryName) return

    ctx.log('Downloading/loading cached HHS-OIG LEIE exclusion list...')
    const records = await loadLeieList(ctx.fetch)

    for (const record of records) {
      // Business-only rows (no individual name) can't match a person_name query.
      if (!record.firstName && !record.lastName) continue

      let bestScore = 0
      for (const candidate of candidateNames(record)) {
        const score = jaroWinkler(queryName, normalizeForMatch(candidate))
        if (score > bestScore) bestScore = score
      }
      if (bestScore < MATCH_THRESHOLD) continue

      const matchedName = `${record.lastName}, ${[record.firstName, record.midName].filter(Boolean).join(' ')}`.replace(/^,\s*/, '').trim()
      const exclusionDate = parseYyyymmdd(record.exclDate)

      yield claim('exclusion_listing', {
        listName: 'HHS-OIG LEIE',
        matchedName,
        firstName: record.firstName || null,
        middleName: record.midName || null,
        lastName: record.lastName || null,
        npi: record.npi && record.npi !== '0000000000' ? record.npi : null,
        generalCategory: record.general || null,
        specialty: record.specialty || null,
        exclusionType: record.exclType || null,
        exclusionDate: record.exclDate || null,
        reinstatementDate: record.reinDate !== '00000000' ? record.reinDate : null,
        waiverDate: record.waiverDate !== '00000000' ? record.waiverDate : null,
        waiverState: record.wvrState || null,
        city: record.city || null,
        state: record.state || null,
        nameMatchScore: bestScore,
      }, {
        confidence: bestScore,
        observedAt: exclusionDate,
        rawSnippet: `${matchedName} | ${record.general} | ${record.specialty} | exclusion type ${record.exclType} on ${record.exclDate}`,
        evidenceUrl: LANDING_PAGE_URL,
      })
    }
  },
})
