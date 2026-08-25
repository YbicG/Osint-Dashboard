import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'

/**
 * OFAC Specially Designated Nationals list — public-domain U.S. Treasury
 * data, free for any use (unlike OpenSanctions' CC BY-NC aggregation, see
 * plan doc). No API key. The download endpoint 302s to a signed S3 URL;
 * `fetch` follows redirects by default so this "just works."
 */
const SDN_CSV_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV'
const MATCH_THRESHOLD = 0.82
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

interface SdnRecord {
  entNum: string
  name: string
  type: string
  program: string
  remarks: string
}

let cache: { records: SdnRecord[]; fetchedAt: number } | null = null

/** Minimal quoted-CSV row splitter — sufficient for OFAC's fixed 12-column export, avoids pulling in a CSV dependency for one file. */
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

async function loadSdnList(fetchImpl: typeof fetch): Promise<SdnRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records

  const res = await fetchImpl(SDN_CSV_URL)
  if (!res.ok) throw new Error(`OFAC SDN download failed: ${res.status}`)
  const text = await res.text()

  const records: SdnRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    if (cols.length < 12) continue
    const [entNum, name, type, program, , , , , , , , remarks] = cols
    if (!name || name === '-0-') continue
    records.push({ entNum: entNum ?? '', name, type: type ?? '', program: program ?? '', remarks: remarks ?? '' })
  }
  cache = { records, fetchedAt: Date.now() }
  return records
}

export const ofacSdnConnector = defineConnector({
  id: 'sanctions.ofac_sdn',
  name: 'OFAC Specially Designated Nationals List',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['sanctions_listing'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'U.S. government public-domain data (31 CFR Part 501) — no usage restriction.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    ctx.log('Downloading/loading cached OFAC SDN list...')
    const records = await loadSdnList(ctx.fetch)

    for (const record of records) {
      const candidateName = normalizeForMatch(record.name)
      const score = jaroWinkler(queryName, candidateName)
      if (score < MATCH_THRESHOLD) continue

      yield claim('sanctions_listing', {
        listName: 'OFAC SDN',
        entityNumber: record.entNum,
        matchedName: record.name,
        sdnType: record.type,
        program: record.program,
        remarks: record.remarks,
        nameMatchScore: score,
      }, {
        confidence: score,
        rawSnippet: `${record.name} | ${record.type} | ${record.program}`,
        evidenceUrl: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${record.entNum}`,
      })
    }
  },
})
