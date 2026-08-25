import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { parseName, normalizeForMatch, jaroWinkler } from '@osint/core'

/**
 * FINRA BrokerCheck — the public registry of every securities broker and
 * investment adviser representative registered in the US, keyless via its
 * own search-backend API (the same one BrokerCheck's web UI calls). Live
 * verified during planning. `ind_bc_disclosure_fl: 'Y'` flags a licensed
 * professional with a disclosed disqualifying/reportable event (complaints,
 * regulatory actions, terminations, etc.) — meaningful on its own even
 * without the full disclosure-detail API (which requires the CRD number
 * this search surfaces, but isn't fetched here to keep this connector to
 * one request per search).
 */
const BROKERCHECK_URL = 'https://api.brokercheck.finra.org/search/individual'
const NAME_MATCH_THRESHOLD = 0.82
const MAX_RESULTS = 25

interface BrokerCheckEmployment {
  firm_name: string
  branch_city?: string
  branch_state?: string
}

interface BrokerCheckHit {
  ind_source_id: string
  ind_firstname: string
  ind_middlename?: string
  ind_lastname: string
  ind_namesuffix?: string
  ind_bc_scope?: string
  ind_ia_scope?: string
  ind_bc_disclosure_fl?: string
  ind_current_employments?: BrokerCheckEmployment[]
}

interface BrokerCheckResponse {
  hits?: { total: number; hits: { _source: BrokerCheckHit }[] }
}

export const finraBrokercheckConnector = defineConnector({
  id: 'finra.brokercheck',
  name: 'FINRA BrokerCheck',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['professional_license', 'finra_disclosure'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'FINRA publishes BrokerCheck data specifically for public due-diligence use; this hits the same public API the brokercheck.finra.org web UI itself calls, no key.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Only covers people who are or were registered as a securities broker or investment adviser representative — a miss here says nothing about anyone outside the securities industry.',

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const parsed = parseName(ctx.input.fullName)
    if (!parsed.last) {
      ctx.log('BrokerCheck search requires a last name — skipping.')
      return
    }

    const url = new URL(BROKERCHECK_URL)
    url.searchParams.set('query', ctx.input.fullName)
    url.searchParams.set('filter', 'active=true')
    url.searchParams.set('includePrevious', 'true')
    url.searchParams.set('hl', 'true')
    url.searchParams.set('nrows', String(MAX_RESULTS))
    url.searchParams.set('start', '0')
    url.searchParams.set('r', '25')
    url.searchParams.set('wt', 'json')

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`FINRA BrokerCheck search returned HTTP ${res.status}`)
      return
    }
    const data = (await res.json()) as BrokerCheckResponse
    const hits = data.hits?.hits ?? []
    if (hits.length === 0) {
      ctx.log(`No FINRA-registered broker/adviser found for "${ctx.input.fullName}"`)
      return
    }

    const queryName = normalizeForMatch(ctx.input.fullName)
    let matched = 0
    for (const hit of hits) {
      const r = hit._source
      const candidateName = normalizeForMatch(`${r.ind_firstname} ${r.ind_middlename ?? ''} ${r.ind_lastname}`.trim())
      const score = jaroWinkler(queryName, candidateName)
      if (score < NAME_MATCH_THRESHOLD) continue
      matched++

      const matchedName = [r.ind_firstname, r.ind_middlename, r.ind_lastname, r.ind_namesuffix].filter(Boolean).join(' ')
      const currentFirm = r.ind_current_employments?.[0]
      const hasDisclosure = r.ind_bc_disclosure_fl === 'Y'
      const evidenceUrl = `https://brokercheck.finra.org/individual/summary/${r.ind_source_id}`

      yield claim('professional_license', {
        source: 'FINRA BrokerCheck',
        crdNumber: r.ind_source_id,
        matchedName,
        brokerScope: r.ind_bc_scope ?? null,
        investmentAdviserScope: r.ind_ia_scope ?? null,
        currentFirm: currentFirm?.firm_name ?? null,
        currentFirmCity: currentFirm?.branch_city ?? null,
        currentFirmState: currentFirm?.branch_state ?? null,
        hasDisclosure,
        nameMatchScore: score,
      }, {
        confidence: Math.min(0.9, 0.6 + score * 0.3),
        rawSnippet: `${matchedName} (CRD# ${r.ind_source_id}), ${currentFirm?.firm_name ?? 'no current firm on record'}`,
        evidenceUrl,
      })

      if (hasDisclosure) {
        yield claim('finra_disclosure', {
          crdNumber: r.ind_source_id,
          matchedName,
          note: 'BrokerCheck flags at least one disclosed reportable event (complaint, regulatory action, termination, etc.); this connector does not fetch disclosure detail records.',
        }, {
          confidence: Math.min(0.9, 0.6 + score * 0.3),
          evidenceUrl,
        })
      }
    }

    if (matched === 0) {
      ctx.log(`BrokerCheck returned ${hits.length} candidate(s) for "${ctx.input.fullName}" but none cleared the name-match threshold`)
    }
  },
})
