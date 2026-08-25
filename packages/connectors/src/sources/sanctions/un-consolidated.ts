import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'

/**
 * UN Security Council Consolidated Sanctions List — every individual and
 * entity currently subject to UN sanctions across all active Security
 * Council committees (Al-Qaida/ISIL, Taliban, DRC, Iraq, Libya, etc.),
 * merged into one public XML feed. Public-domain UN data, free, no API key.
 *
 * https://scsanctions.un.org/resources/xml/en/consolidated.xml currently
 * 302-redirects to a signed Azure Blob Storage URL (short-lived SAS token) —
 * confirmed live 2026-08-24. `fetch` follows redirects by default, same as
 * the OFAC SDN connector's S3 redirect, so this "just works" without any
 * special handling.
 *
 * Node has no built-in XML parser and this is the only file in the codebase
 * that needs one, so — matching the plan's guidance to avoid a new
 * dependency for one file — this uses plain regex/string extraction against
 * the feed's flat, consistently-tagged structure rather than a real parser.
 * Verified against a live downloaded copy of the feed (736 <INDIVIDUAL> +
 * 275 <ENTITY> blocks at time of writing) before choosing the tag names
 * below; see packages/connectors/src/fixtures/un-consolidated-sample.xml
 * for a trimmed real excerpt (Eric Badege, Saddam/Qusay Hussein Al-Tikriti,
 * ADF) used by the test.
 */
const UN_CONSOLIDATED_XML_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml'
const MATCH_THRESHOLD = 0.82
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

interface UnSanctionsRecord {
  dataId: string
  recordType: 'individual' | 'entity'
  name: string
  unListType: string
  referenceNumber: string
  listedOn: string | null
  comments: string | null
  aliases: string[]
}

let cache: { records: UnSanctionsRecord[]; fetchedAt: number } | null = null

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** First `<TAG>text</TAG>` in `block`. Returns null for a missing, empty, or self-closing (`<TAG/>`) tag. */
function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  if (!match) return null
  const value = decodeXmlEntities(match[1]!.trim())
  return value || null
}

/** Every `<ALIAS_NAME>text</ALIAS_NAME>` inside a block — INDIVIDUAL_ALIAS/ENTITY_ALIAS both use this inner tag, and a record can carry zero to many of them. */
function extractAliases(block: string): string[] {
  const aliases: string[] = []
  const re = /<ALIAS_NAME>([^<]*)<\/ALIAS_NAME>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const name = decodeXmlEntities(m[1]!.trim())
    if (name) aliases.push(name)
  }
  return aliases
}

/** Splits the raw XML into top-level `<INDIVIDUAL>...</INDIVIDUAL>` / `<ENTITY>...</ENTITY>` blocks. The feed never nests one inside another, so a non-greedy match between matching open/close tags is safe. */
function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) blocks.push(m[1]!)
  return blocks
}

function parseRecord(block: string, recordType: 'individual' | 'entity'): UnSanctionsRecord | null {
  // Individuals carry FIRST/SECOND/THIRD/FOURTH_NAME parts; entities (orgs,
  // vessels, etc.) only ever populate FIRST_NAME with the full org name, so
  // this same join works for both record types.
  const nameParts = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
    .map((tag) => extractTag(block, tag))
    .filter((part): part is string => !!part)
  const name = nameParts.join(' ')
  if (!name) return null

  return {
    dataId: extractTag(block, 'DATAID') ?? '',
    recordType,
    name,
    unListType: extractTag(block, 'UN_LIST_TYPE') ?? '',
    referenceNumber: extractTag(block, 'REFERENCE_NUMBER') ?? '',
    listedOn: extractTag(block, 'LISTED_ON'),
    comments: extractTag(block, 'COMMENTS1'),
    aliases: extractAliases(block),
  }
}

async function loadUnConsolidatedList(fetchImpl: typeof fetch): Promise<UnSanctionsRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records

  const res = await fetchImpl(UN_CONSOLIDATED_XML_URL)
  if (!res.ok) throw new Error(`UN Consolidated List download failed: ${res.status}`)
  const xml = await res.text()

  const records: UnSanctionsRecord[] = []
  for (const block of extractBlocks(xml, 'INDIVIDUAL')) {
    const rec = parseRecord(block, 'individual')
    if (rec) records.push(rec)
  }
  for (const block of extractBlocks(xml, 'ENTITY')) {
    const rec = parseRecord(block, 'entity')
    if (rec) records.push(rec)
  }

  cache = { records, fetchedAt: Date.now() }
  return records
}

export const unConsolidatedConnector = defineConnector({
  id: 'sanctions.un_consolidated',
  name: 'UN Security Council Consolidated Sanctions List',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  // JurisdictionScope has no 'international'/'global' option — 'national' is
  // the closest existing value (same call OFAC SDN makes despite its own
  // global reach), rather than adding a new enum member outside this task's
  // scope.
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['sanctions_listing'],
  // Full feed is a ~2MB single-file download; conservative limit befits a
  // shared free UN resource with no documented rate policy.
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'UN Security Council public sanctions data, issued under Security Council resolutions — freely republishable; no license fee or key required.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    ctx.log('Downloading/loading cached UN Security Council Consolidated Sanctions List...')
    const records = await loadUnConsolidatedList(ctx.fetch)

    for (const record of records) {
      let bestScore = 0
      let bestName = record.name
      for (const candidate of [record.name, ...record.aliases]) {
        const score = jaroWinkler(queryName, normalizeForMatch(candidate))
        if (score > bestScore) {
          bestScore = score
          bestName = candidate
        }
      }
      if (bestScore < MATCH_THRESHOLD) continue

      yield claim('sanctions_listing', {
        listName: 'UN Consolidated',
        dataId: record.dataId,
        referenceNumber: record.referenceNumber,
        recordType: record.recordType,
        matchedName: bestName,
        primaryName: record.name,
        aliases: record.aliases,
        unListType: record.unListType,
        comments: record.comments,
        nameMatchScore: bestScore,
      }, {
        confidence: bestScore,
        observedAt: record.listedOn ? new Date(record.listedOn) : null,
        rawSnippet: `${record.name} | ${record.unListType} | ${record.referenceNumber}`,
        evidenceUrl: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list',
      })
    }
  },
})
