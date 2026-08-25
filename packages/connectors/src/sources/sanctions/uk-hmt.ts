import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'

/**
 * UK sanctions consolidated list — person/entity name screening.
 *
 * IMPORTANT PROVENANCE NOTE: the source this connector was originally
 * specified against — the OFSI ("Office of Financial Sanctions
 * Implementation") Consolidated List of Financial Sanctions Targets, long
 * published from ofsistorage.blob.core.windows.net/publishlive/... — was
 * formally RETIRED by HM Treasury on 28 January 2026. Confirmed live via
 * gov.uk 2026-08-24: "The OFSI Consolidated List has closed. The names and
 * details of designated persons under UK sanctions are available on the UK
 * Sanctions List." (https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets/consolidated-list-of-targets)
 * The old blob-storage CSV URL is dead.
 *
 * The UK Sanctions List (UKSL) is its official, current replacement and is
 * now the single consolidated source for ALL UK sanctions designations
 * (financial, trade, immigration — OFSI's asset-freeze targets are a subset
 * of it), published at https://www.gov.uk/government/publications/the-uk-sanctions-list.
 * This connector points at that live successor rather than the dead URL, so
 * the coverage this connector id promises ("UK HMT/OFSI sanctions screening")
 * keeps working — the alternative (leaving a hard-coded dead endpoint) would
 * silently return zero claims forever with no indication why.
 *
 * Verified live 2026-08-24:
 *   HEAD https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv -> 200,
 *   Content-Length 49821406 (~49.8MB), Last-Modified 20 Aug 2026, served via
 *   CloudFront/S3, no auth. Full download completed in ~2.7s in testing, well
 *   inside the shared ConnectorHttpError timeout.
 *
 * Format: NOT a normal one-row-per-entity CSV. Row 1 is a free-text
 * "Report Date: DD-Mon-YYYY" banner (not data). Row 2 is the real header.
 * Each subsequent row is one (name-variant x address) combination for an
 * entity, so a single heavily-aliased/multi-address entity can occupy
 * dozens of near-duplicate rows sharing the same "Unique ID" — confirmed
 * live: ~58,300 data rows collapse to ~6,300 distinct Unique IDs. This
 * connector groups rows by Unique ID before matching, so a match is
 * reported once per sanctioned entity, not once per row.
 *
 * Name columns are laid out confusingly (header literally reads "Name 6,
 * Name 1,Name 2,Name 3,Name 4,Name 5") and, despite the numbering, "Name 6"
 * is the one column always populated when any name exists — it holds an
 * entity's full name OR an individual's surname — while Name 1..5 hold an
 * individual's given name(s)/patronymic in first-to-last order and are blank
 * for entities. Verified against three live records captured verbatim in
 * fixtures/uk-hmt-sample.csv: the HAJI KHAIRULLAH HAJI SATTAR MONEY EXCHANGE
 * entity (Unique ID AFG0001, only Name 6 populated) and two individuals —
 * PUTIN, Vladimir Vladimirovich (RUS0251: Name 6=PUTIN, Name 1=Vladimir,
 * Name 2=Vladimirovich) and BASTRYKIN, Alexander Ivanovich (GHR0011) — both
 * following the same Name 6=surname, Name 1=given, Name 2=patronymic pattern.
 * The literal column-order join therefore reads "PUTIN Vladimir
 * Vladimirovich" — a poor Jaro-Winkler match against the "First Last" order
 * most users actually type — so we also generate a given-name(s)-first
 * reordering ("Vladimir Vladimirovich Putin", i.e. Name 1..5 followed by
 * Name 6 last) as a second candidate string per record. This is a
 * best-effort heuristic, not a guarantee: a handful of Alias-type rows in the
 * live data spread fragmentary aliases unusually across these columns, so
 * some alias matches may still be missed. Primary Name rows — what most
 * direct-identity searches hit — follow the convention consistently in every
 * record checked.
 *
 * Public, free, Open Government Licence v3.0 — confirmed via the gov.uk
 * publication page footer ("This publication is licensed under the terms of
 * the Open Government Licence v3.0 except where otherwise stated"). No API
 * key.
 */
const UK_SANCTIONS_LIST_CSV_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv'
const UK_SANCTIONS_SEARCH_TOOL_URL = 'https://search-uk-sanctions-list.service.gov.uk/'
const MATCH_THRESHOLD = 0.82
// The file is ~50MB and (per the publication page) is republished on an
// as-designations-change cadence rather than intraday, so we cache
// considerably longer than the smaller/more-frequently-updated OFAC SDN feed
// — same reasoning as the HHS-OIG LEIE connector's 24h TTL for its ~15.5MB file.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface UkSanctionsRecord {
  uniqueId: string
  names: string[]
  regimeName: string | null
  designationType: string | null // Individual / Entity / Ship
  sanctionsImposed: string | null
  statementOfReasons: string | null
  dateDesignated: string | null // DD/MM/YYYY as published
}

let cache: { records: UkSanctionsRecord[]; fetchedAt: number } | null = null

/** Minimal quoted-CSV row splitter — same approach as the OFAC SDN / HHS-OIG LEIE connectors, avoids a CSV dependency for one file. */
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

function clean(v: string | undefined): string {
  return (v ?? '').trim()
}

async function loadUkSanctionsList(fetchImpl: typeof fetch): Promise<UkSanctionsRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records

  const res = await fetchImpl(UK_SANCTIONS_LIST_CSV_URL)
  if (!res.ok) throw new Error(`UK Sanctions List download failed: ${res.status}`)
  const text = await res.text()

  const lines = text.split('\n')
  // Row 1 is a "Report Date: ..." banner, not data. Locate the real header
  // (first column literally "Last Updated") defensively rather than
  // hard-coding "skip exactly 2 lines", in case a future publish drops or
  // duplicates the banner row.
  let dataStartIndex = 2
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (parseCsvLine(lines[i] ?? '')[0]?.trim() === 'Last Updated') {
      dataStartIndex = i + 1
      break
    }
  }

  const byId = new Map<string, UkSanctionsRecord>()
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const cols = parseCsvLine(line)
    if (cols.length < 22) continue // fewer columns than "UK Statement of Reasons" (index 21) means a malformed/truncated row

    const uniqueId = clean(cols[1])
    if (!uniqueId) continue

    // Name 6 = entity full name OR individual surname; Name 1-5 = an
    // individual's given name(s)/patronymic, given-name-first (see file
    // header comment). Joining in column order gives "Surname Given
    // Patronymic"; joining Name 1-5 then Name 6 gives "Given Patronymic
    // Surname", a much better match against how users typically type names.
    const [name6, name1, name2, name3, name4, name5] = [cols[4], cols[5], cols[6], cols[7], cols[8], cols[9]].map(clean)
    const literalOrder = [name6, name1, name2, name3, name4, name5].filter(Boolean).join(' ')
    const givenFirstOrder = [name1, name2, name3, name4, name5, name6].filter(Boolean).join(' ')

    let record = byId.get(uniqueId)
    if (!record) {
      record = {
        uniqueId,
        names: [],
        regimeName: clean(cols[16]) || null,
        designationType: clean(cols[17]) || null,
        sanctionsImposed: clean(cols[19]) || null,
        statementOfReasons: clean(cols[21]) || null,
        dateDesignated: clean(cols[33]) || null,
      }
      byId.set(uniqueId, record)
    }
    for (const name of [literalOrder, givenFirstOrder]) {
      if (name && !record.names.includes(name)) record.names.push(name)
    }
  }

  const records = [...byId.values()]
  cache = { records, fetchedAt: Date.now() }
  return records
}

/** UK Sanctions List dates are published as DD/MM/YYYY. */
function parseUkDate(s: string | null): Date | null {
  if (!s) return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, day, month, year] = m
  const dt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return Number.isNaN(dt.getTime()) ? null : dt
}

export const ukHmtConnector = defineConnector({
  id: 'sanctions.uk_hmt',
  name: 'UK Sanctions List (HMT/OFSI successor)',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['sanctions_listing'],
  // Large (~50MB) shared free file; conservative limit given the download
  // cost per hit even though a hit is cache-served for CACHE_TTL_MS.
  rateLimitPerMinute: 10,
  robotsPolicy: 'honor',
  tosNote: 'UK government sanctions data (Sanctions and Anti-Money Laundering Act 2018), published under the Open Government Licence v3.0 — freely reusable, no key required. Note: this is the UK Sanctions List, the official successor to the retired OFSI Consolidated List (closed 28 Jan 2026); OFSI-administered asset-freeze designations are a subset of it.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    if (!queryName) return

    ctx.log('Downloading/loading cached UK Sanctions List...')
    const records = await loadUkSanctionsList(ctx.fetch)

    for (const record of records) {
      let bestScore = 0
      let bestName = record.names[0] ?? ''
      for (const candidate of record.names) {
        const score = jaroWinkler(queryName, normalizeForMatch(candidate))
        if (score > bestScore) {
          bestScore = score
          bestName = candidate
        }
      }
      if (bestScore < MATCH_THRESHOLD) continue

      yield claim('sanctions_listing', {
        listName: 'UK OFSI',
        uniqueId: record.uniqueId,
        matchedName: bestName,
        aliases: record.names,
        designationType: record.designationType,
        regimeName: record.regimeName,
        sanctionsImposed: record.sanctionsImposed,
        statementOfReasons: record.statementOfReasons,
        nameMatchScore: bestScore,
      }, {
        confidence: bestScore,
        observedAt: parseUkDate(record.dateDesignated),
        rawSnippet: `${bestName} | ${record.designationType ?? ''} | ${record.regimeName ?? ''}`,
        evidenceUrl: UK_SANCTIONS_SEARCH_TOOL_URL,
      })
    }
  },
})
