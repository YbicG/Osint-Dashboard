import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * HackerNews usernames are globally unique and unauthenticated-readable via
 * Firebase — a keyless, no-rate-limit-header, always-available identity
 * check. On its own this is weak identity signal (anyone can register any
 * free username), so it's emitted at low confidence; its main value is
 * corroborating a username seen elsewhere (e.g. a Keybase hackernews proof).
 */
const HN_USER_URL = 'https://hacker-news.firebaseio.com/v0/user'

interface HackerNewsUser {
  id: string
  created: number
  karma: number
  about?: string
  submitted?: number[]
}

export const hackernewsConnector = defineConnector({
  id: 'digital.hackernews',
  name: 'Hacker News Profile',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['username'],
  emits: ['social_profile'],
  rateLimitPerMinute: 120,
  robotsPolicy: 'honor',
  tosNote: 'Firebase-hosted public read API explicitly published by Hacker News for this purpose; no key, no ToS restriction on read access.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Only registered Hacker News usernames resolve; a miss here is not evidence the username is unused elsewhere.',

  async *run(ctx) {
    if (ctx.input.type !== 'username') return
    const username = ctx.input.value

    const res = await ctx.fetch(`${HN_USER_URL}/${encodeURIComponent(username)}.json`)
    if (!res.ok) {
      ctx.log(`Hacker News lookup returned HTTP ${res.status}`)
      return
    }

    // The Firebase API returns the literal string "null" (200 OK) for an
    // unregistered id, not a 404 — so the body has to be checked, not just
    // the status.
    const body = await res.text()
    if (body.trim() === 'null') {
      ctx.log(`No Hacker News account registered for username "${username}"`)
      return
    }
    const user = JSON.parse(body) as HackerNewsUser

    yield claim('social_profile', {
      platform: 'hackernews',
      username: user.id,
      karma: user.karma,
      about: user.about ?? null,
      createdAt: new Date(user.created * 1000).toISOString(),
      submissionCount: user.submitted?.length ?? 0,
      profileUrl: `https://news.ycombinator.com/user?id=${user.id}`,
    }, {
      // Free, unauthenticated registration — weak identity signal on its
      // own, mainly useful to corroborate a username seen via another
      // connector rather than as standalone proof of identity.
      confidence: 0.3,
      evidenceUrl: `https://news.ycombinator.com/user?id=${user.id}`,
    })
  },
})
