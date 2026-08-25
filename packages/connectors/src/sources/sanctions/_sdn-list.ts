/**
 * Shared OFAC SDN CSV fetch/parse/cache, lifted out of ofac-sdn.ts so a
 * second connector (ofac-crypto.ts) can scan the same downloaded list
 * without a second network request. Extracted as its own module rather
 * than duplicated — behavior-preserving by construction, since ofac-sdn.ts
 * now just imports this instead of defining it inline, and its existing
 * test still exercises the exact same parsing code path.
 */

export const SDN_CSV_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

export interface SdnRecord {
  entNum: string
  name: string
  type: string
  program: string
  remarks: string
}

let cache: { records: SdnRecord[]; fetchedAt: number } | null = null

/** Minimal quoted-CSV row splitter — sufficient for OFAC's fixed 12-column export, avoids pulling in a CSV dependency for one file. */
export function parseCsvLine(line: string): string[] {
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

export async function loadSdnList(fetchImpl: typeof fetch): Promise<SdnRecord[]> {
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
