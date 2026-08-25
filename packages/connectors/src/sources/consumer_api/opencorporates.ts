import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { ConnectorHttpError } from '../../sdk/http'
import { jaroWinkler, normalizeForMatch } from '@osint/core'

/**
 * OpenCorporates — the largest open database of company registration
 * records worldwide (200M+ companies across 140+ jurisdictions' registries).
 *
 * VERIFIED LIVE 2026-08-24 via direct curl against production:
 *   GET https://api.opencorporates.com/v0.4/companies/search?q=Apple
 *   GET https://api.opencorporates.com/v0.4/officers/search?q=John+Smith
 * Both endpoints are live and reachable, but contrary to this connector's
 * original brief ("works without api_token at a heavily-throttled anonymous
 * rate"), OpenCorporates has since shut the anonymous tier down entirely.
 * With no token, with an obviously-fake token, and across five requests in
 * a row (checking for a throttle-then-allow pattern), every single request
 * came back identical:
 *   HTTP 401 {"error":{"message":"Invalid Api Token. Please check your
 *   OpenCorporates account"}}
 * There is no rate-limited-but-functional anonymous mode left to degrade
 * to — a registered api_token is mandatory on every call now, free tier or
 * not (consistent with OpenCorporates' own current docs: free accounts get
 * ~50 requests/day and 200/month — see knowledge.opencorporates.com/
 * knowledge-base/api-authentication-authorisation/). This connector is
 * written to that reality: with no key configured it logs the gap and
 * yields nothing (a skip, not an error — same contract every consumer_api
 * connector in this codebase follows, see twilio-lookup.ts); with a key
 * configured it calls the real endpoints below.
 *
 * This is a person_name connector, but OpenCorporates' headline
 * `companies/search` endpoint only searches *company* names. The stronger,
 * purpose-built signal for a person search is the separate documented
 * `officers/search` endpoint (knowledge.opencorporates.com/knowledge-base/
 * searching-for-an-officer/), which searches corporate-officer names
 * directly and returns each officer's position/dates plus the company they
 * held it at. That is treated here as the real signal — one
 * `business_officer` claim per matched officer, plus a lightweight
 * `business_registration` claim per distinct company that officer sits on
 * (jurisdiction/number/name only; see note below on why incorporation
 * date/status are left null on that path). Only when `officers/search`
 * isn't reachable (blocked, erroring, or the token being rejected) does
 * this fall back to the weaker signal the brief describes: a plain
 * `companies/search?q=<name>`, keeping only companies whose name literally
 * contains the searched full name (eponymous firms — "Jane Cooper
 * Consulting LLC" style), at the same flat, deliberately unremarkable
 * confidence (0.5) the ProPublica Nonprofit connector uses for its
 * analogous name-in-org-name coincidence — never a confirmed officer or
 * ownership link. That fallback path *does* carry incorporation date and
 * status, since companies/search returns them directly.
 *
 * Fixture provenance: no OPENCORPORATES_API_KEY credential was available in
 * the environment this connector was built in, and registering an
 * OpenCorporates account is out of scope for this task, so the
 * success-path fixtures are not a fresh authenticated capture. They are
 * transcribed field-for-field from OpenCorporates' own current, published
 * documentation examples (a real company and its real director —
 * OpenCorporates Holding Ltd, UK company number 11268479 — quoted verbatim
 * from the knowledge-base URL above; and OpenCorporates Ltd, UK company
 * number 07444723, from the companies-search walkthrough doc), which is
 * the closest available thing to "real" without a paid/registered
 * credential. One additional company row in the companies/search fallback
 * fixture ("Jane Cooper Consulting LLC") is a synthetic filler added only
 * to exercise the substring-match filter, the same real-plus-synthetic-
 * filler pattern already used in fixtures/ofac-sdn-sample.csv. The
 * 401-with-no-token behavior described above, by contrast, was captured
 * live, not transcribed.
 */
const OFFICERS_SEARCH_URL = 'https://api.opencorporates.com/v0.4/officers/search'
const COMPANIES_SEARCH_URL = 'https://api.opencorporates.com/v0.4/companies/search'

/** Officer names are real personal names (not loosely-tokenized company names), so a tighter threshold than OFAC's 0.82 is appropriate. */
const OFFICER_MATCH_THRESHOLD = 0.85

interface OfficerRecord {
  name: string
  jurisdiction_code: string
  position: string | null
  start_date: string | null
  end_date: string | null
  occupation: string | null
  nationality: string | null
  opencorporates_url: string
  company: {
    name: string
    jurisdiction_code: string
    company_number: string
    opencorporates_url: string
  }
}

interface OfficerSearchResponse {
  results?: {
    officers?: { officer: OfficerRecord }[]
  }
}

interface CompanyRecord {
  name: string
  company_number: string
  jurisdiction_code: string
  incorporation_date: string | null
  current_status: string | null
  opencorporates_url: string
}

interface CompanySearchResponse {
  results?: {
    companies?: { company: CompanyRecord }[]
  }
}

type FetchImpl = typeof fetch
type Logger = (message: string) => void

/** Returns the matched officers, or the string 'unreachable' when the endpoint itself couldn't be used (bad token, blocked, erroring) so the caller knows to fall back. */
async function searchOfficers(
  fetchImpl: FetchImpl,
  log: Logger,
  fullName: string,
  apiToken: string,
): Promise<{ officer: OfficerRecord }[] | 'unreachable'> {
  const url = new URL(OFFICERS_SEARCH_URL)
  url.searchParams.set('q', fullName)
  url.searchParams.set('order', 'score')
  url.searchParams.set('api_token', apiToken)

  try {
    const res = await fetchImpl(url.toString())
    if (res.status === 401) {
      log('OpenCorporates rejected OPENCORPORATES_API_KEY (401 Invalid Api Token) — check the credential; falling back to company-name search with the same token')
      return 'unreachable'
    }
    if (!res.ok) {
      log(`OpenCorporates officers/search returned ${res.status} — falling back to company-name search`)
      return 'unreachable'
    }
    const data = (await res.json()) as OfficerSearchResponse
    return data.results?.officers ?? []
  } catch (err) {
    if (err instanceof ConnectorHttpError) {
      log(`OpenCorporates officers/search ${err.classification} (${err.message}) — falling back to company-name search`)
      return 'unreachable'
    }
    throw err
  }
}

async function searchCompaniesByName(
  fetchImpl: FetchImpl,
  log: Logger,
  fullName: string,
  apiToken: string,
): Promise<{ company: CompanyRecord }[]> {
  const url = new URL(COMPANIES_SEARCH_URL)
  url.searchParams.set('q', fullName)
  url.searchParams.set('api_token', apiToken)

  try {
    const res = await fetchImpl(url.toString())
    if (!res.ok) {
      log(`OpenCorporates companies/search returned ${res.status}`)
      return []
    }
    const data = (await res.json()) as CompanySearchResponse
    return data.results?.companies ?? []
  } catch (err) {
    if (err instanceof ConnectorHttpError) {
      log(`OpenCorporates companies/search ${err.classification}: ${err.message}`)
      return []
    }
    throw err
  }
}

export const openCorporatesConnector = defineConnector({
  id: 'business.opencorporates',
  name: 'OpenCorporates Company & Officer Search',
  category: 'business_professional',
  costType: 'freemium',
  transport: 'http',
  // OpenCorporates aggregates 140+ national/state/provincial registries
  // behind one API; the jurisdiction of any given hit is carried per-claim
  // in jurisdictionCode rather than fixed for the whole connector.
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['business_officer', 'business_registration'],
  rateLimitPerMinute: 5,
  robotsPolicy: 'honor',
  tosNote:
    'OpenCorporates API terms: free-tier tokens are share-alike (attribution required, no closed redistribution of the raw data) and capped around 50 requests/day, 200/month (knowledge.opencorporates.com/knowledge-base/api-authentication-authorisation/) — rateLimitPerMinute here only smooths bursts, it cannot enforce that daily/monthly cap itself. Paid plans lift the share-alike restriction; free at-scale access is available on application for journalism/NGO/anti-corruption research use.',
  requiresApiKey: 'OPENCORPORATES_API_KEY',
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const fullName = ctx.input.fullName.trim()
    if (!fullName) return

    const apiToken = ctx.apiKey('OPENCORPORATES_API_KEY')
    if (!apiToken) {
      ctx.log(
        'OPENCORPORATES_API_KEY not configured — OpenCorporates now requires a registered api_token on every request (verified live: unauthenticated and invalid-token requests both return 401 "Invalid Api Token"; no anonymous tier remains) — skipping (a coverage gap, not an error)',
      )
      return
    }

    const officers = await searchOfficers(ctx.fetch, ctx.log, fullName, apiToken)

    if (officers === 'unreachable') {
      const companies = await searchCompaniesByName(ctx.fetch, ctx.log, fullName, apiToken)
      const needle = fullName.toLowerCase()
      for (const { company } of companies) {
        if (!company.name.toLowerCase().includes(needle)) continue
        yield claim(
          'business_registration',
          {
            companyName: company.name,
            companyNumber: company.company_number,
            jurisdictionCode: company.jurisdiction_code,
            incorporationDate: company.incorporation_date,
            status: company.current_status,
            matchBasis: 'searched_full_name_is_substring_of_company_name',
          },
          {
            // Name-substring coincidence only — see header comment. Never a
            // confirmed officer/ownership link, hence the flat low confidence.
            confidence: 0.5,
            rawSnippet: `${company.name} (${company.jurisdiction_code}/${company.company_number}) — ${company.current_status ?? 'status unknown'}`,
            evidenceUrl: company.opencorporates_url,
            observedAt: company.incorporation_date ? new Date(company.incorporation_date) : null,
          },
        )
      }
      return
    }

    const queryNorm = normalizeForMatch(fullName)
    const seenCompanies = new Set<string>()

    for (const { officer } of officers) {
      const score = jaroWinkler(queryNorm, normalizeForMatch(officer.name))
      if (score < OFFICER_MATCH_THRESHOLD) continue

      yield claim(
        'business_officer',
        {
          officerName: officer.name,
          position: officer.position,
          startDate: officer.start_date,
          endDate: officer.end_date,
          occupation: officer.occupation,
          nationality: officer.nationality,
          companyName: officer.company.name,
          companyNumber: officer.company.company_number,
          jurisdictionCode: officer.company.jurisdiction_code,
          nameMatchScore: score,
        },
        {
          confidence: score,
          rawSnippet: `${officer.name} — ${officer.position ?? 'officer'} of ${officer.company.name} (${officer.company.jurisdiction_code}/${officer.company.company_number})`,
          evidenceUrl: officer.opencorporates_url,
          observedAt: officer.start_date ? new Date(officer.start_date) : null,
        },
      )

      const companyKey = `${officer.company.jurisdiction_code}/${officer.company.company_number}`
      if (seenCompanies.has(companyKey)) continue
      seenCompanies.add(companyKey)

      yield claim(
        'business_registration',
        {
          companyName: officer.company.name,
          companyNumber: officer.company.company_number,
          jurisdictionCode: officer.company.jurisdiction_code,
          // Not present on the officers/search company sub-object (verified
          // against OpenCorporates' own documented shape — only the
          // companies/search and per-company detail endpoints carry these).
          // Deliberately not fetched with a follow-up call: see header
          // comment on the ~50-requests/day free-tier budget.
          incorporationDate: null,
          status: null,
        },
        {
          confidence: score,
          evidenceUrl: officer.company.opencorporates_url,
        },
      )
    }
  },
})
