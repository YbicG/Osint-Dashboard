import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { parseName, normalizeForMatch, jaroWinkler } from '@osint/core'

/**
 * Federal Bureau of Prisons inmate locator — live-verified during planning
 * as the "best single win" in the person_name wave: facility, release
 * codes, and projected/actual release dates for anyone currently or
 * formerly in federal (not state/county) custody. Keyless — the public
 * bop.gov site's own AJAX search endpoint, `todo=query` being the
 * undocumented-but-required param the HTML form actually submits (there is
 * no published API doc for this; discovered by reading the form markup).
 */
const BOP_SEARCH_URL = 'https://www.bop.gov/PublicInfo/execute/inmateloc'
const NAME_MATCH_THRESHOLD = 0.82

interface BopInmateRecord {
  nameLast: string
  nameFirst: string
  nameMiddle: string
  sex: string
  race: string
  age: string
  inmateNum: string
  releaseCode: string
  faclCode: string
  faclName: string
  faclType: string
  faclURL: string
  projRelDate: string
  actRelDate: string
  suffix: string
}

interface BopSearchResponse {
  Captcha?: boolean
  InmateLocator?: BopInmateRecord[]
}

// BOP's own release-code legend (documented on the inmate locator page).
const RELEASE_CODE_LABELS: Record<string, string> = {
  R: 'Released',
  IS: 'In service of sentence',
}

export const bopInmateConnector = defineConnector({
  id: 'federal.bop_inmate',
  name: 'BOP Federal Inmate Locator',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['incarceration_record'],
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'bop.gov\'s own public inmate locator — the site itself has no robots.txt restriction on this path and the search is designed for public use by families/press/researchers.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Federal Bureau of Prisons custody only — does not cover state prisons, county jails, ICE detention, or pretrial custody in a US Marshals facility. Common names return many candidates; only those clearing the name-match threshold are surfaced.',

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const parsed = parseName(ctx.input.fullName)
    if (!parsed.first || !parsed.last) {
      ctx.log('BOP inmate locator requires both a first and last name to search — skipping.')
      return
    }

    const url = new URL(BOP_SEARCH_URL)
    url.searchParams.set('todo', 'query')
    url.searchParams.set('output', 'json')
    url.searchParams.set('inmateNum', '')
    url.searchParams.set('nameFirst', parsed.first)
    url.searchParams.set('nameMiddle', parsed.middle ?? '')
    url.searchParams.set('nameLast', parsed.last)
    url.searchParams.set('race', '')
    url.searchParams.set('age', '')
    url.searchParams.set('sex', '')

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`BOP inmate locator returned HTTP ${res.status}`)
      return
    }
    const data = (await res.json()) as BopSearchResponse
    if (data.Captcha) {
      ctx.log('BOP inmate locator presented a CAPTCHA — cannot complete this search unattended')
      return
    }
    const records = data.InmateLocator ?? []
    if (records.length === 0) {
      ctx.log(`No BOP federal custody record found for "${ctx.input.fullName}"`)
      return
    }

    const queryName = normalizeForMatch(ctx.input.fullName)
    let matched = 0
    for (const r of records) {
      const candidateName = normalizeForMatch(`${r.nameFirst} ${r.nameMiddle} ${r.nameLast}`.trim())
      const score = jaroWinkler(queryName, candidateName)
      if (score < NAME_MATCH_THRESHOLD) continue
      matched++

      yield claim('incarceration_record', {
        source: 'Federal Bureau of Prisons',
        matchedName: [r.nameFirst, r.nameMiddle, r.nameLast, r.suffix].filter(Boolean).join(' '),
        inmateNumber: r.inmateNum,
        sex: r.sex || null,
        race: r.race || null,
        age: r.age !== 'N/A' ? r.age : null,
        facilityName: r.faclName || null,
        facilityType: r.faclType || null,
        facilityUrl: r.faclURL ? `https://www.bop.gov${r.faclURL}` : null,
        releaseStatus: RELEASE_CODE_LABELS[r.releaseCode] ?? r.releaseCode ?? null,
        projectedReleaseDate: r.projRelDate || null,
        actualReleaseDate: r.actRelDate || null,
        nameMatchScore: score,
      }, {
        confidence: Math.min(0.9, 0.6 + score * 0.3),
        rawSnippet: `${r.nameFirst} ${r.nameLast} (#${r.inmateNum}), ${r.faclName || 'facility unknown'}, released: ${r.actRelDate || r.projRelDate || 'no release date on record'}`,
        evidenceUrl: 'https://www.bop.gov/inmateloc/',
      })
    }

    if (matched === 0) {
      ctx.log(`BOP returned ${records.length} candidate(s) for "${ctx.input.fullName}" but none cleared the name-match threshold`)
    } else if (records.length > matched) {
      ctx.log(`BOP returned ${records.length} candidates; ${matched} matched closely enough to surface`)
    }
  },
})
