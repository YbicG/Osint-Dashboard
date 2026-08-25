import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { parseName, normalizeForMatch, jaroWinkler } from '@osint/core'

/**
 * SSA Death Index / "Death Master File" equivalent — free lookup.
 *
 * ---------------------------------------------------------------------------
 * Research trail (checked live 2026-08-24/25, re-verified before writing this
 * file):
 *
 * The real, current, complete Death Master File is NOT free. Since the
 * Bipartisan Budget Act of 2013 (15 CFR Part 1110), public updates to the DMF
 * stopped in 2014 and the current file is restricted to certified paid
 * subscribers under NTIS's "Limited Access Death Master File" (LADMF) program
 * (https://www.ntis.gov/ladmf/ladmf.xhtml). There is no free tier and no
 * public API for the authoritative SSA file. We do not fabricate one.
 *
 * FamilySearch's "Deceased Person's Search" was the other candidate the task
 * named. Its API base (https://api.familysearch.org/platform) requires an
 * OAuth 2.0 bearer token for every call, including the "unauthenticated
 * session" grant, which still requires a registered, pre-approved developer
 * client_id (confirmed against developers.familysearch.org docs). That's
 * key-gated, not "genuinely free, no-signup" — disqualified.
 *
 * The genuinely free, no-key, live-queryable substitute this connector
 * actually uses is WikiTree's public `searchPerson` API
 * (https://api.wikitree.com/api.php, documented at
 * https://github.com/wikitree/wikitree-api). Confirmed live, no account/
 * session/API-key of any kind:
 *
 *   curl -G https://api.wikitree.com/api.php \
 *     --data-urlencode action=searchPerson \
 *     --data-urlencode FirstName=Franklin --data-urlencode LastName=Roosevelt \
 *     --data-urlencode dateInclude=both \
 *     --data-urlencode fields=Id,Name,FirstName,LastNameCurrent,BirthDate,DeathDate,DeathLocation,IsLiving \
 *     --data-urlencode appId=osint-dashboard
 *
 * returned (2026-08-25, HTTP 200, real data, verified against public
 * historical record): Id 2566 "Roosevelt-1", BirthDate 1882-01-30, DeathDate
 * 1945-04-12, DeathLocation "Warm Springs, Meriwether, Georgia, United
 * States" — the actual FDR record. See
 * ../../fixtures/wikitree-searchperson-roosevelt.json for the recorded
 * response used in this connector's test.
 *
 * Caveats this connector is honest about, reflected in confidence scoring and
 * tosNote below:
 *   - WikiTree is a free, non-profit, crowd-sourced genealogy wiki, not an
 *     official government vital-records index. Content is user-submitted and
 *     can be wrong, incomplete, or (rarely) vandalized.
 *   - Only already-public profiles are ever returned by the API — WikiTree's
 *     privacy policy excludes living people from public view by default, so
 *     this is not a way to unmask a living person's status.
 *   - Global in practice (profiles from many countries), not US-specific
 *     like the real SSDI/DMF; `jurisdictionScope: 'national'` is the closest
 *     fit in the existing enum (JurisdictionScope has no "international"
 *     option) rather than a claim that WikiTree is a US-only index.
 * ---------------------------------------------------------------------------
 */
const SEARCH_URL = 'https://api.wikitree.com/api.php'
const RESULT_LIMIT = 25
const NAME_MATCH_THRESHOLD = 0.82
const FIELDS = [
  'Id',
  'Name',
  'FirstName',
  'MiddleName',
  'LastNameAtBirth',
  'LastNameCurrent',
  'RealName',
  'BirthDate',
  'DeathDate',
  'BirthLocation',
  'DeathLocation',
  'Gender',
  'IsLiving',
].join(',')

interface WikiTreeMatch {
  Id: number
  Name: string
  FirstName?: string
  MiddleName?: string
  LastNameAtBirth?: string
  LastNameCurrent?: string
  RealName?: string
  BirthDate?: string
  DeathDate?: string
  BirthLocation?: string
  DeathLocation?: string
  Gender?: string
  IsLiving?: number
}

interface WikiTreeSearchPayload {
  status: number
  matches?: WikiTreeMatch[]
  total?: number
}

/** WikiTree stores unknown month/day as zeros ("1945-00-00" etc.) rather than omitting the field. */
function hasRealDate(d?: string): d is string {
  if (!d) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return !!m && m[1] !== '0000'
}

/** Best-effort Date for a WikiTree date string, tolerating zeroed month/day. Returns null if the year itself is unknown. */
function parseWikiDate(d?: string): Date | null {
  if (!hasRealDate(d)) return null
  const [y, mo, day] = d.split('-')
  const dt = new Date(`${y}-${mo === '00' ? '01' : mo}-${day === '00' ? '01' : day}T00:00:00Z`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** Accepts the SearchInput's optional partial-precision dateOfBirth ("YYYY" or "YYYY-MM-DD") and maps it to WikiTree's YYYY-MM-DD search param format. */
function toWikiTreeSearchDate(input: string): string | null {
  if (/^\d{4}$/.test(input)) return `${input}-00-00`
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input
  return null
}

export const ssaDeathIndexConnector = defineConnector({
  id: 'vital.ssdi',
  name: 'WikiTree Deceased-Person Search (free SSDI/DMF substitute)',
  category: 'vital_genealogy',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['death_record', 'date_of_death'],
  // Shared free non-profit infrastructure, not a paid/commercial API — kept
  // conservative even though WikiTree's own docs only "encourage" (don't
  // enforce) an appId to avoid the strict default throttling.
  rateLimitPerMinute: 15,
  robotsPolicy: 'honor',
  tosNote:
    'The real SSDI/DMF stopped free public distribution in 2014 (15 CFR Part 1110); the current file is ' +
    'sold only to certified subscribers via NTIS\'s paid Limited Access DMF program. This connector uses ' +
    'WikiTree\'s public searchPerson API (api.wikitree.com) as the closest genuinely free, no-signup, ' +
    'live substitute. WikiTree content is free/non-profit and community-contributed under its own Honor ' +
    'Code; living people are privacy-protected and excluded from public results by WikiTree policy, so ' +
    'only already-public (generally deceased) profiles are ever returned. Data is crowd-sourced, not an ' +
    'official vital-records index — treat matches as an investigative lead, not authoritative confirmation ' +
    'of death.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const parsed = parseName(ctx.input.fullName)
    if (!parsed.last) {
      ctx.log('Could not split a last name out of the search name; WikiTree searchPerson requires one — skipping.')
      return
    }

    const url = new URL(SEARCH_URL)
    url.searchParams.set('action', 'searchPerson')
    if (parsed.first) url.searchParams.set('FirstName', parsed.first)
    url.searchParams.set('LastName', parsed.last)
    // "both" asks WikiTree to prefer already-dated profiles; it's a best-effort
    // hint, not a strict server-side filter (confirmed live — some undated
    // profiles still come back), so we still filter client-side below.
    url.searchParams.set('dateInclude', 'both')
    url.searchParams.set('fields', FIELDS)
    url.searchParams.set('limit', String(RESULT_LIMIT))
    // Self-identifying app tag, not a registered credential — WikiTree's docs
    // "encourage" this to avoid the strict no-id rate limit, no signup involved.
    url.searchParams.set('appId', 'osint-dashboard')

    if (ctx.input.dateOfBirth) {
      const wikiDate = toWikiTreeSearchDate(ctx.input.dateOfBirth)
      if (wikiDate) {
        url.searchParams.set('BirthDate', wikiDate)
        url.searchParams.set('dateSpread', '2')
      }
    }

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`WikiTree searchPerson returned ${res.status}`)
      return
    }

    const body = (await res.json()) as WikiTreeSearchPayload[]
    const payload = body[0]
    if (!payload || payload.status !== 0 || !payload.matches?.length) return

    const queryName = normalizeForMatch(ctx.input.fullName)

    for (const m of payload.matches) {
      if (m.IsLiving === 1) continue
      if (!hasRealDate(m.DeathDate)) continue

      const lastName = m.LastNameCurrent || m.LastNameAtBirth || ''
      const firstName = m.FirstName || m.RealName || ''
      const candidateName = normalizeForMatch(`${firstName} ${lastName}`.trim())
      if (!candidateName) continue

      const score = jaroWinkler(queryName, candidateName)
      if (score < NAME_MATCH_THRESHOLD) continue

      const profileUrl = `https://www.wikitree.com/wiki/${m.Name}`
      const birthDate = hasRealDate(m.BirthDate) ? m.BirthDate : null
      // Crowd-sourced, non-authoritative source — cap confidence well below
      // what an official government list (e.g. OFAC SDN) would earn even at
      // a perfect name match.
      const confidence = Math.min(0.75, 0.45 + score * 0.3)

      yield claim(
        'death_record',
        {
          source: 'WikiTree (free, crowd-sourced genealogy wiki — not an official vital-records index)',
          wikiTreeId: m.Name,
          matchedName: [firstName, lastName].filter(Boolean).join(' '),
          birthDate,
          deathDate: m.DeathDate,
          birthLocation: m.BirthLocation || null,
          deathLocation: m.DeathLocation || null,
          gender: m.Gender ?? null,
          nameMatchScore: score,
        },
        {
          confidence,
          rawSnippet: `${m.Name}: ${firstName} ${lastName}, b. ${birthDate ?? 'unknown'}, d. ${m.DeathDate}${m.DeathLocation ? ` in ${m.DeathLocation}` : ''}`,
          evidenceUrl: profileUrl,
          observedAt: parseWikiDate(m.DeathDate),
        },
      )

      yield claim('date_of_death', m.DeathDate, {
        confidence,
        evidenceUrl: profileUrl,
        observedAt: parseWikiDate(m.DeathDate),
      })
    }
  },
})
