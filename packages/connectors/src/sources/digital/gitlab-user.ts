import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * GitLab.com's public user-search API is keyless and returns an array
 * (empty for a non-existent or organization-style username, not a 404).
 * `public_email` is opt-in on the user's side, so when present it's a
 * strong, self-disclosed username<->email link.
 */
const GITLAB_USERS_URL = 'https://gitlab.com/api/v4/users'

interface GitLabUser {
  id: number
  username: string
  name?: string
  state?: string
  locked?: boolean
  public_email?: string | null
  avatar_url?: string | null
  web_url: string
}

export const gitlabUserConnector = defineConnector({
  id: 'digital.gitlab_user',
  name: 'GitLab.com Profile',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['username'],
  emits: ['social_profile'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'GitLab.com publishes this REST endpoint for public, unauthenticated user lookup; no key required for read access.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Returns an empty result (not a 404) for both non-existent usernames and GitLab group/organization namespaces that happen to share the searched string — a miss here is not conclusive.',

  async *run(ctx) {
    if (ctx.input.type !== 'username') return
    const username = ctx.input.value

    const res = await ctx.fetch(`${GITLAB_USERS_URL}?username=${encodeURIComponent(username)}`)
    if (!res.ok) {
      ctx.log(`GitLab user lookup returned HTTP ${res.status}`)
      return
    }

    const users = (await res.json()) as GitLabUser[]
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase())
    if (!user) {
      ctx.log(`No GitLab.com account registered for username "${username}"`)
      return
    }
    if (user.state && user.state !== 'active') {
      ctx.log(`GitLab.com account "${username}" exists but is not active (state: ${user.state})`)
    }

    yield claim('social_profile', {
      platform: 'gitlab',
      username: user.username,
      fullName: user.name ?? null,
      publicEmail: user.public_email || null,
      state: user.state ?? null,
      profileUrl: user.web_url,
    }, {
      confidence: user.public_email ? 0.7 : 0.5,
      evidenceUrl: user.web_url,
    })
  },
})
