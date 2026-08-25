import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * The commit-email technique — but built as the plan's own research
 * corrected it, not as first proposed. `author-email:` is not a supported
 * GitHub code/commit search qualifier, so there is no way to go
 * email -> username via GitHub's search API. What *is* real and keyless:
 * `GET /users/{login}/events/public` lists a user's recent push activity
 * (repo + head commit sha, no author data in the event payload itself —
 * GitHub stopped inlining commit authors there years ago), and
 * `GET /repos/{owner}/{repo}/commits/{sha}` returns the underlying git
 * commit object, whose `commit.author.email` is whatever address the
 * person's local git config used — frequently their real address, not
 * their GitHub-account email, and not something GitHub's UI surfaces
 * directly. So this connector runs **username -> email**, the direction
 * that is actually supported, and is registered as a username pivot
 * source rather than a reverse-email search.
 */
const GITHUB_API = 'https://api.github.com'
const MAX_EVENTS_TO_SCAN = 10

interface GitHubEvent {
  type: string
  repo: { name: string }
  payload: { head?: string }
}

interface GitHubCommit {
  sha: string
  commit: {
    author: { name: string; email: string; date: string }
  }
}

export const githubEmailConnector = defineConnector({
  id: 'digital.github_email',
  name: 'GitHub Commit Email',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['username'],
  emits: ['email_address'],
  rateLimitPerMinute: 30, // unauthenticated GitHub REST calls are capped at 60/hr per IP; each run costs up to 1 + MAX_EVENTS_TO_SCAN requests
  robotsPolicy: 'honor',
  tosNote: 'GitHub\'s public REST API for public events and public commit metadata; unauthenticated requests are rate-limited to 60/hour by GitHub itself.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Only surfaces an email when the account has recent public push activity and their local git config used a real address rather than GitHub\'s noreply@users.noreply.github.com privacy address (which this connector explicitly skips as non-identifying).',

  async *run(ctx) {
    if (ctx.input.type !== 'username') return
    const username = ctx.input.value

    const eventsRes = await ctx.fetch(`${GITHUB_API}/users/${encodeURIComponent(username)}/events/public`)
    if (eventsRes.status === 404) {
      ctx.log(`No GitHub account registered for username "${username}"`)
      return
    }
    if (!eventsRes.ok) {
      ctx.log(`GitHub events lookup returned HTTP ${eventsRes.status}`)
      return
    }

    const events = (await eventsRes.json()) as GitHubEvent[]
    const pushShas = events
      .filter((e): e is GitHubEvent & { payload: { head: string } } => e.type === 'PushEvent' && Boolean(e.payload.head))
      .slice(0, MAX_EVENTS_TO_SCAN)

    if (pushShas.length === 0) {
      ctx.log(`No recent public push activity for "${username}" to derive a commit email from`)
      return
    }

    const seenEmails = new Set<string>()
    for (const event of pushShas) {
      const commitRes = await ctx.fetch(`${GITHUB_API}/repos/${event.repo.name}/commits/${event.payload.head}`)
      if (!commitRes.ok) continue
      const commit = (await commitRes.json()) as GitHubCommit
      const email = commit.commit?.author?.email
      if (!email || seenEmails.has(email.toLowerCase())) continue
      if (email.endsWith('@users.noreply.github.com')) continue // GitHub's own privacy address — not identifying
      seenEmails.add(email.toLowerCase())

      yield claim('email_address', email, {
        confidence: 0.6,
        rawSnippet: `git commit ${commit.sha.slice(0, 8)} in ${event.repo.name} authored as "${commit.commit.author.name} <${email}>"`,
        evidenceUrl: `https://github.com/${event.repo.name}/commit/${commit.sha}`,
      })
    }

    if (seenEmails.size === 0) {
      ctx.log(`"${username}"'s recent commits all used GitHub's noreply privacy address — no identifying email found`)
    }
  },
})
