import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * ProPublica Nonprofit Explorer API v2 — free, no API key. Built from the
 * IRS Exempt Organizations Business Master File plus IRS Form 990 e-file
 * extracts. Docs: https://projects.propublica.org/nonprofits/api/
 *
 * This is an ORGANIZATION name search — there is no "search by officer/
 * founder/donor name" endpoint anywhere in this API. Its value for a
 * person_name search is indirect: family and memorial foundations are very
 * often literally named after a person ("The <Full Name> Family
 * Foundation", "<Full Name> Charitable Trust", ...), so a hit here is a
 * lead worth a human glance, never a confirmed link.
 *
 * Verified live 2026-08-24 with curl against the real endpoints:
 *  - GET .../api/v2/search.json?q=<name> ranks results with a fuzzy/
 *    tokenized relevance score, NOT a substring match — querying "John
 *    Smith" returned 25 "matches" including "Knights Of Columbus" and
 *    "Crow Farm Foundation" with no textual relation to the query at all
 *    (their *sub_name* mentions a trustee/member named John or Smith
 *    separately). So this connector re-filters the API's own results,
 *    keeping only organizations whose name/sub_name literally contains the
 *    searched full name. That is a strictly stronger filter than the API
 *    applies, and it's still only a name coincidence, not a confirmed
 *    officer/founder/family link — hence the flat, deliberately
 *    unremarkable confidence of 0.5 for every hit (per the connector spec)
 *    rather than this SDK's usual 0.75 default.
 *  - Quirk verified live: a zero-match query comes back as HTTP 404 (not
 *    200), despite the body being a well-formed
 *    {"total_results":0,"organizations":[]} JSON document. Treated here as
 *    "no matches," not a fetch failure.
 *  - GET .../api/v2/search.json never includes financial figures (only
 *    name/EIN/city/state/NTEE/subsection code). The most-recent Form 990
 *    total revenue the connector spec asks for only exists on the per-
 *    organization detail endpoint, .../api/v2/organizations/<ein>.json
 *    (verified live) — so each name-matched org gets one follow-up call
 *    there, capped by MAX_REVENUE_LOOKUPS so a common surname can't fan
 *    out into dozens of extra requests against a free, key-less API with
 *    no documented rate limit. A failed/absent detail lookup just leaves
 *    the revenue fields null rather than dropping the match.
 */
const SEARCH_URL = 'https://projects.propublica.org/nonprofits/api/v2/search.json'
const ORGANIZATION_URL = 'https://projects.propublica.org/nonprofits/api/v2/organizations'

/** Extra per-org detail fetches allowed per search, purely to fetch the most-recent Form 990 revenue figure. */
const MAX_REVENUE_LOOKUPS = 10

interface SearchOrg {
  ein: number
  strein: string
  name: string
  sub_name: string | null
  city: string | null
  state: string | null
  ntee_code: string | null
  subseccd: number | null
}

interface SearchResponse {
  total_results: number
  organizations: SearchOrg[]
}

interface FilingWithData {
  tax_prd_yr: number | null
  totrevenue: number | null
}

interface OrganizationDetailResponse {
  filings_with_data?: FilingWithData[]
}

async function fetchMostRecentRevenue(
  fetchImpl: typeof fetch,
  ein: number,
  log: (message: string) => void,
): Promise<{ totalRevenue: number | null; filingYear: number | null }> {
  try {
    const res = await fetchImpl(`${ORGANIZATION_URL}/${ein}.json`)
    if (!res.ok) return { totalRevenue: null, filingYear: null }
    const detail = (await res.json()) as OrganizationDetailResponse
    // filings_with_data is API-ordered most-recent-first (verified live).
    const latest = detail.filings_with_data?.[0]
    if (!latest) return { totalRevenue: null, filingYear: null }
    return { totalRevenue: latest.totrevenue ?? null, filingYear: latest.tax_prd_yr ?? null }
  } catch (err) {
    log(`Form 990 detail lookup failed for EIN ${ein}: ${err instanceof Error ? err.message : String(err)}`)
    return { totalRevenue: null, filingYear: null }
  }
}

export const propublicaNonprofitConnector = defineConnector({
  id: 'federal.propublica_nonprofit',
  name: 'ProPublica Nonprofit Explorer (IRS Form 990)',
  // NOTE: packages/contracts/src/source.ts's SourceCategory enum has no
  // 'financial' value (the connector spec's "category: financial" refers
  // to the PREDICATE_CATEGORY UI-tab grouping that 'nonprofit_filing'
  // belongs to in predicate.ts, a separate, string-keyed mapping — not this
  // field). 'federal' is the closest fit in the actual enum and matches
  // this file's directory siblings (fbi-wanted.ts, sec-edgar-fulltext.ts),
  // which are likewise thin wrappers over a federal-agency-sourced public
  // dataset. Flagging this rather than inventing a new enum value, since
  // that would require a contracts-package change outside this task's scope.
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['nonprofit_filing'],
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote:
    'ProPublica Data Store Terms of Use (projects.propublica.org/datastore/terms): free to use with attribution; no bulk redistribution, resale, sub-licensing, or paywalling of the raw data. Underlying records are public-domain IRS Form 990 e-file/Business Master File extracts.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const fullName = ctx.input.fullName.trim()
    if (!fullName) return

    const url = new URL(SEARCH_URL)
    url.searchParams.set('q', fullName)

    const res = await ctx.fetch(url.toString())

    let data: SearchResponse
    if (res.status === 404) {
      // Verified live: the API answers a zero-match query with HTTP 404
      // but a valid {"total_results":0,"organizations":[]} JSON body.
      // Cast applied to the whole catch-wrapped expression, not just the
      // fallback value — `Response.json()` resolves to `unknown` (not
      // `any`) under this project's @types/node, so `unknown | SearchResponse`
      // still widens to `unknown` if only the fallback branch is cast.
      data = (await res.json().catch(() => ({ total_results: 0, organizations: [] }))) as SearchResponse
    } else if (!res.ok) {
      ctx.log(`ProPublica Nonprofit Explorer search returned ${res.status}`)
      return
    } else {
      data = (await res.json()) as SearchResponse
    }

    const needle = fullName.toLowerCase()
    const matches = (data.organizations ?? []).filter((org) => {
      const name = (org.name ?? '').toLowerCase()
      const subName = (org.sub_name ?? '').toLowerCase()
      return name.includes(needle) || subName.includes(needle)
    })

    if (matches.length > MAX_REVENUE_LOOKUPS) {
      ctx.log(
        `${matches.length} nonprofits literally match "${fullName}" — enriching only the first ${MAX_REVENUE_LOOKUPS} with Form 990 revenue detail`,
      )
    }

    for (let i = 0; i < matches.length; i++) {
      const org = matches[i]!
      const revenue =
        i < MAX_REVENUE_LOOKUPS
          ? await fetchMostRecentRevenue(ctx.fetch, org.ein, ctx.log)
          : { totalRevenue: null, filingYear: null }

      yield claim(
        'nonprofit_filing',
        {
          orgName: org.name,
          ein: org.strein,
          nteeCode: org.ntee_code,
          state: org.state,
          city: org.city,
          subsectionCode: org.subseccd,
          mostRecentTotalRevenue: revenue.totalRevenue,
          mostRecentFilingYear: revenue.filingYear,
          matchBasis: 'searched_full_name_is_substring_of_org_name',
        },
        {
          // Name-substring coincidence only — never a confirmed officer,
          // founder, or family link. See connector spec / header comment.
          confidence: 0.5,
          rawSnippet: `${org.name} (EIN ${org.strein}) — ${org.city ?? '?'}, ${org.state ?? '?'}`,
          evidenceUrl: `https://projects.propublica.org/nonprofits/organizations/${org.ein}`,
        },
      )
    }
  },
})
