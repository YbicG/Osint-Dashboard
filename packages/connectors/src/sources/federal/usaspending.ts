import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { ConnectorHttpError } from '../../sdk/http'

/**
 * USAspending.gov — `spending_by_award` full-text award search. This is the
 * same endpoint that powers usaspending.gov's own search page. Free, public,
 * no API key (U.S. Treasury / DATA Act transparency data).
 *
 * Two quirks found via live verification on 2026-08-24 that are NOT obvious
 * from a quick read of the docs, and that contradict a "just send one
 * request with every award_type_code" assumption:
 *
 * 1. `award_type_codes` must come from exactly ONE award-type group per
 *    request. Sending contract codes (A/B/C/D) together with assistance/
 *    grant codes (02/03/04/05) in one call now 422s with:
 *      "'award_type_codes' must only contain types from one group."
 *    So this connector issues two separate searches — contracts, then
 *    grants/assistance — and merges the results.
 * 2. The human-readable award-type-name field is named differently per
 *    group: contract results expose it as "Contract Award Type"; grant/
 *    assistance results expose it as "Award Type". Requesting the field
 *    name from the wrong group doesn't error — it just silently comes back
 *    null, which would have shipped a connector that looks like it works
 *    but quietly drops a field.
 *
 * Verified live 2026-08-24:
 *   POST https://api.usaspending.gov/api/v2/search/spending_by_award/
 *   body: {"filters":{"recipient_search_text":["Lockheed Martin"],
 *          "award_type_codes":["A","B","C","D"]},
 *          "fields":["Award ID","Recipient Name","Award Amount","Start Date",
 *          "End Date","Awarding Agency","Contract Award Type"],"limit":5}
 *   -> 200, real contract rows for LOCKHEED MARTIN INTEGRATED SYSTEMS, LLC.
 * Award detail pages resolve at https://www.usaspending.gov/award/{generated_internal_id}
 * (confirmed 200 for both a CONT_AWD_... and an ASST_NON_... id).
 *
 * Note on match quality: `recipient_search_text` is a broad text search —
 * it also matched "Halliburton" against a subsidiary's legal name
 * ("Landmark Graphics Corporation") in testing — not a confirmed identity
 * match, hence the moderate confidence below.
 */
const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'

const CONTRACT_TYPE_CODES = ['A', 'B', 'C', 'D']
const GRANT_TYPE_CODES = ['02', '03', '04', '05']
const RESULTS_PER_GROUP = 10 // 10 contracts + 10 grants = 20 total, matching the source brief's overall limit

interface AwardResult {
  'Award ID': string | null
  'Recipient Name': string | null
  'Award Amount': number | null
  'Start Date': string | null
  'End Date': string | null
  'Awarding Agency': string | null
  generated_internal_id?: string
  // Present on one group's results only, depending on which was requested —
  // see quirk #2 above. Both are read defensively in the claim-building step.
  'Contract Award Type'?: string | null
  'Award Type'?: string | null
}

interface SpendingByAwardResponse {
  results: AwardResult[]
}

async function searchAwards(
  fetchImpl: typeof fetch,
  recipientName: string,
  awardTypeCodes: string[],
  typeFieldName: 'Contract Award Type' | 'Award Type',
): Promise<AwardResult[]> {
  const res = await fetchImpl(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: {
        recipient_search_text: [recipientName],
        award_type_codes: awardTypeCodes,
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'End Date', 'Awarding Agency', typeFieldName],
      limit: RESULTS_PER_GROUP,
    }),
  })
  if (!res.ok) {
    throw new Error(`USAspending search returned ${res.status}`)
  }
  const data = (await res.json()) as SpendingByAwardResponse
  return data.results ?? []
}

export const usaSpendingConnector = defineConnector({
  id: 'federal.usaspending',
  name: 'USAspending.gov Federal Contracts & Grants Search',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['government_contract'],
  rateLimitPerMinute: 20, // shared free public resource, no auth/key to isolate our usage
  robotsPolicy: 'honor',
  tosNote:
    'U.S. Treasury public spending-transparency data (DATA Act, 31 U.S.C. 6101 note) — public domain, no usage restriction. https://www.usaspending.gov/download_center/using_the_data',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const recipientName = ctx.input.fullName

    let contracts: AwardResult[] = []
    try {
      contracts = await searchAwards(ctx.fetch, recipientName, CONTRACT_TYPE_CODES, 'Contract Award Type')
    } catch (err) {
      if (err instanceof ConnectorHttpError) throw err // blocked/5xx — let the caller classify the whole run
      ctx.log(`USAspending contracts search failed: ${(err as Error).message}`)
    }

    let grants: AwardResult[] = []
    try {
      grants = await searchAwards(ctx.fetch, recipientName, GRANT_TYPE_CODES, 'Award Type')
    } catch (err) {
      if (err instanceof ConnectorHttpError) throw err
      ctx.log(`USAspending grants search failed: ${(err as Error).message}`)
    }

    for (const award of contracts) {
      yield claim('government_contract', {
        awardId: award['Award ID'],
        recipientName: award['Recipient Name'],
        awardAmount: award['Award Amount'],
        awardingAgency: award['Awarding Agency'],
        awardType: award['Contract Award Type'] ?? null,
        awardCategory: 'contract',
        startDate: award['Start Date'],
        endDate: award['End Date'],
      }, {
        confidence: 0.6, // recipient_search_text is a broad text match, not a confirmed identity match
        observedAt: award['Start Date'] ? new Date(award['Start Date']) : null,
        rawSnippet: `${award['Recipient Name']} — ${award['Contract Award Type'] ?? 'contract'} — ${award['Awarding Agency']}`,
        evidenceUrl: award.generated_internal_id ? `https://www.usaspending.gov/award/${award.generated_internal_id}` : null,
      })
    }

    for (const award of grants) {
      yield claim('government_contract', {
        awardId: award['Award ID'],
        recipientName: award['Recipient Name'],
        awardAmount: award['Award Amount'],
        awardingAgency: award['Awarding Agency'],
        awardType: award['Award Type'] ?? null,
        awardCategory: 'grant',
        startDate: award['Start Date'],
        endDate: award['End Date'],
      }, {
        confidence: 0.6,
        observedAt: award['Start Date'] ? new Date(award['Start Date']) : null,
        rawSnippet: `${award['Recipient Name']} — ${award['Award Type'] ?? 'grant'} — ${award['Awarding Agency']}`,
        evidenceUrl: award.generated_internal_id ? `https://www.usaspending.gov/award/${award.generated_internal_id}` : null,
      })
    }
  },
})
