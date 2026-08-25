import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * CourtListener REST API v4 — RECAP/PACER federal docket search plus case
 * law. Works anonymously at a lower rate limit; set COURTLISTENER_API_TOKEN
 * for higher limits (https://www.courtlistener.com/help/api/rest/).
 */
const SEARCH_URL = 'https://www.courtlistener.com/api/rest/v4/search/'

interface CourtListenerResult {
  caseName: string
  court: string
  dateFiled: string | null
  docketNumber: string | null
  absolute_url: string
  status: string | null
}

interface CourtListenerResponse {
  count: number
  results: CourtListenerResult[]
}

export const courtListenerConnector = defineConnector({
  id: 'federal.courtlistener',
  name: 'CourtListener (RECAP/PACER + Case Law)',
  category: 'courts_corrections',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['court_case', 'case_disposition'],
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'Free Law Project — RECAP Archive documents are free permanently; API is free with rate limits.',
  requiresApiKey: 'COURTLISTENER_API_TOKEN',
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const url = new URL(SEARCH_URL)
    url.searchParams.set('type', 'r') // r = RECAP dockets
    url.searchParams.set('party_name', ctx.input.fullName)

    const token = ctx.apiKey('COURTLISTENER_API_TOKEN')
    const res = await ctx.fetch(url.toString(), {
      headers: token ? { Authorization: `Token ${token}` } : undefined,
    })
    if (!res.ok) {
      ctx.log(`CourtListener search returned ${res.status}`)
      return
    }
    const data = (await res.json()) as CourtListenerResponse

    for (const result of data.results ?? []) {
      yield claim('court_case', {
        caseName: result.caseName,
        court: result.court,
        docketNumber: result.docketNumber,
        status: result.status,
        source: 'RECAP/PACER via CourtListener',
      }, {
        confidence: 0.65, // party-name text match, not a confirmed identity — common names produce false positives
        observedAt: result.dateFiled ? new Date(result.dateFiled) : null,
        rawSnippet: `${result.caseName} — ${result.court} — ${result.docketNumber ?? 'no docket #'}`,
        evidenceUrl: `https://www.courtlistener.com${result.absolute_url}`,
      })
    }
  },
})
