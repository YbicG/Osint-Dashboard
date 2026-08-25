import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { ConnectorHttpError } from '../../sdk/http'

/**
 * Sherlock/Maigret-style username enumeration: for each site, request the
 * profile URL and decide "exists" either from the HTTP status code or from
 * a known "not found" marker string in the body (many SPAs return 200 for
 * every username and render the not-found state client-side, so a bare
 * status check would false-positive on every one of those).
 *
 * This is a starter set (~20 sites) demonstrating the pattern the plan doc
 * describes — porting Maigret's full 3,000+-site definition DB behind this
 * same rate-limited/stealth transport is data entry against this same
 * `SiteDefinition[]` shape, not new architecture (mirrors how
 * registry/jurisdictions.ts seeds county portals rather than enumerating
 * all ~3,000 counties).
 */
type CheckStrategy =
  | { kind: 'status_code' } // 2xx (after redirects) = exists, 404 = does not
  | { kind: 'body_missing_marker'; marker: string } // marker present in body = does NOT exist
  | { kind: 'body_present_marker'; marker: string } // marker present in body = DOES exist

interface SiteDefinition {
  name: string
  urlTemplate: string // {username} placeholder
  check: CheckStrategy
}

const SITES: SiteDefinition[] = [
  { name: 'GitHub', urlTemplate: 'https://github.com/{username}', check: { kind: 'status_code' } },
  { name: 'GitLab', urlTemplate: 'https://gitlab.com/{username}', check: { kind: 'status_code' } },
  { name: 'Reddit', urlTemplate: 'https://www.reddit.com/user/{username}/about.json', check: { kind: 'body_missing_marker', marker: '"error": 404' } },
  { name: 'YouTube', urlTemplate: 'https://www.youtube.com/@{username}', check: { kind: 'status_code' } },
  { name: 'Medium', urlTemplate: 'https://medium.com/@{username}', check: { kind: 'status_code' } },
  { name: 'DEV Community', urlTemplate: 'https://dev.to/{username}', check: { kind: 'status_code' } },
  { name: 'Keybase', urlTemplate: 'https://keybase.io/{username}', check: { kind: 'status_code' } },
  { name: 'Hacker News', urlTemplate: 'https://news.ycombinator.com/user?id={username}', check: { kind: 'body_present_marker', marker: 'No such user' } },
  { name: 'SoundCloud', urlTemplate: 'https://soundcloud.com/{username}', check: { kind: 'status_code' } },
  { name: 'Vimeo', urlTemplate: 'https://vimeo.com/{username}', check: { kind: 'status_code' } },
  { name: 'Flickr', urlTemplate: 'https://www.flickr.com/people/{username}', check: { kind: 'status_code' } },
  { name: 'Behance', urlTemplate: 'https://www.behance.net/{username}', check: { kind: 'status_code' } },
  { name: 'Dribbble', urlTemplate: 'https://dribbble.com/{username}', check: { kind: 'status_code' } },
  { name: 'Steam', urlTemplate: 'https://steamcommunity.com/id/{username}', check: { kind: 'body_present_marker', marker: 'The specified profile could not be found' } },
  { name: 'Twitch', urlTemplate: 'https://www.twitch.tv/{username}', check: { kind: 'body_present_marker', marker: 'Sorry. Unless you' } },
  { name: 'TikTok', urlTemplate: 'https://www.tiktok.com/@{username}', check: { kind: 'body_present_marker', marker: "Couldn't find this account" } },
  { name: 'Pinterest', urlTemplate: 'https://www.pinterest.com/{username}/', check: { kind: 'body_present_marker', marker: 'Sorry! We couldn' } },
  { name: 'Telegram', urlTemplate: 'https://t.me/{username}', check: { kind: 'body_missing_marker', marker: 'tgme_page_title' } },
  { name: 'Spotify', urlTemplate: 'https://open.spotify.com/user/{username}', check: { kind: 'status_code' } },
  { name: 'HackerOne', urlTemplate: 'https://hackerone.com/{username}', check: { kind: 'status_code' } },
]

function buildUrl(template: string, username: string): string {
  return template.replace('{username}', encodeURIComponent(username))
}

async function checkSite(site: SiteDefinition, username: string, fetchImpl: typeof fetch): Promise<'found' | 'not_found' | 'unknown'> {
  const url = buildUrl(site.urlTemplate, username)
  try {
    const res = await fetchImpl(url, { redirect: 'follow' })
    if (site.check.kind === 'status_code') {
      return res.ok ? 'found' : 'not_found'
    }
    const body = await res.text()
    if (site.check.kind === 'body_missing_marker') {
      return body.includes(site.check.marker) ? 'not_found' : 'found'
    }
    return body.includes(site.check.marker) ? 'found' : 'not_found'
  } catch (err) {
    if (err instanceof ConnectorHttpError) return 'unknown' // blocked/rate-limited — coverage gap, not "not found"
    return 'unknown'
  }
}

export const usernameEnumerationConnector = defineConnector({
  id: 'digital.username_enumeration',
  name: 'Username Enumeration (Sherlock/Maigret-style)',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['username'],
  emits: ['username_presence', 'social_profile'],
  rateLimitPerMinute: 60, // per-site limiter below is what actually protects each target; this is the connector's own aggregate ceiling
  robotsPolicy: 'honor',
  tosNote: 'Each site checked individually — some (X, Instagram, Facebook, LinkedIn) are deliberately excluded from this starter set as unreliable without an authenticated session; see cookie-jar-aware social connectors for those.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'username') return
    const username = ctx.input.value

    const results = await Promise.all(
      SITES.map(async (site) => ({ site, status: await checkSite(site, username, ctx.fetch) })),
    )

    for (const { site, status } of results) {
      if (status === 'unknown') {
        ctx.log(`${site.name}: blocked or ambiguous — coverage gap, not a negative result`)
        continue
      }
      const url = buildUrl(site.urlTemplate, username)
      yield claim('username_presence', {
        site: site.name,
        username,
        exists: status === 'found',
      }, {
        confidence: status === 'found' ? 0.85 : 0.6,
        evidenceUrl: url,
      })
      if (status === 'found') {
        yield claim('social_profile', { platform: site.name, url, username }, { confidence: 0.85, evidenceUrl: url })
      }
    }
  },
})
