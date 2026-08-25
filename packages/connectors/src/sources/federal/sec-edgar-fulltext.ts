import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * SEC EDGAR full-text search (undocumented but stable, widely relied upon —
 * see plan doc verification). No API key; SEC only requires a descriptive
 * User-Agent identifying the requester, which createConnectorFetch sets.
 * Surfaces any filing (10-K, 8-K, Form 4 insider transactions, proxy
 * statements, ...) that mentions the searched name — useful for officer/
 * director/beneficial-owner discovery, not just full companies.
 */
const EDGAR_FTS_URL = 'https://efts.sec.gov/LATEST/search-index'

interface EdgarHit {
  _id: string
  _source: {
    file_type: string
    file_date: string
    display_names: string[]
    forms: string[]
    ciks: string[]
  }
}

interface EdgarFtsResponse {
  hits: { total: { value: number }; hits: EdgarHit[] }
}

export const secEdgarFullTextConnector = defineConnector({
  id: 'federal.sec_edgar_fulltext',
  name: 'SEC EDGAR Full-Text Search',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['sec_filing', 'business_officer'],
  rateLimitPerMinute: 10, // SEC's documented courtesy limit is 10 req/s; per-minute here is deliberately far under that
  robotsPolicy: 'honor',
  tosNote: 'Public EDGAR data. SEC asks for a descriptive User-Agent and <=10 req/s — see sec.gov/os/webmaster-faq#developers.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const url = new URL(EDGAR_FTS_URL)
    url.searchParams.set('q', `"${ctx.input.fullName}"`)

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`SEC EDGAR full-text search returned ${res.status}`)
      return
    }
    const data = (await res.json()) as EdgarFtsResponse

    for (const hit of data.hits?.hits ?? []) {
      const cik = hit._source.ciks?.[0]
      yield claim('sec_filing', {
        accessionId: hit._id,
        forms: hit._source.forms,
        fileDate: hit._source.file_date,
        filerNames: hit._source.display_names,
        cik,
      }, {
        confidence: 0.6, // full-text mention, not a confirmed identity match — name could be a different person with the same name
        observedAt: hit._source.file_date ? new Date(hit._source.file_date) : null,
        rawSnippet: hit._source.display_names?.join('; ') ?? null,
        evidenceUrl: cik
          ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`
          : `https://www.sec.gov/cgi-bin/browse-edgar`,
      })
    }
  },
})
