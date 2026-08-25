import { createHash } from 'node:crypto'
import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Gravatar's legacy profile JSON endpoint — still live and keyless as of
 * planning (verified against a real hash). The v3 REST API
 * (api.gravatar.com/v3) requires a key; this is not that. A profile is
 * addressable either by the MD5 of a lowercased, trimmed email, or
 * directly by username slug (Gravatar profile URLs are
 * gravatar.com/<username>), which is what makes this connector useful for
 * both `email` and `username` search — one keyless call often returns
 * *verified* links to other accounts (X/GitHub/etc.), which is unusually
 * high pivot value for a single request.
 */
const GRAVATAR_BASE = 'https://www.gravatar.com'

interface GravatarAccount {
  domain: string
  username: string | null
  display: string | null
  url: string | null
  verified?: boolean
}

interface GravatarEntry {
  hash: string
  requestHash: string
  profileUrl: string
  preferredUsername: string | null
  displayName: string | null
  name?: { formatted?: string }
  location?: string
  currentLocation?: string
  aboutMe?: string
  accounts?: GravatarAccount[]
  urls?: { title: string; value: string }[]
}

interface GravatarResponse {
  entry: GravatarEntry[]
}

function emailToGravatarHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex')
}

export const gravatarConnector = defineConnector({
  id: 'digital.gravatar',
  name: 'Gravatar Profile Lookup',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['email', 'username'],
  emits: ['social_profile', 'username_presence'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Public opt-in profile data — a user must have actively created a Gravatar profile. Legacy JSON endpoint, no auth.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    let lookupKey: string
    if (ctx.input.type === 'email') {
      lookupKey = emailToGravatarHash(ctx.input.value)
    } else if (ctx.input.type === 'username') {
      lookupKey = ctx.input.value
    } else {
      return
    }

    const res = await ctx.fetch(`${GRAVATAR_BASE}/${encodeURIComponent(lookupKey)}.json`)
    if (res.status === 404) {
      ctx.log('No Gravatar profile registered for this identifier')
      return
    }
    if (!res.ok) {
      ctx.log(`Gravatar lookup returned ${res.status}`)
      return
    }

    const data = (await res.json()) as GravatarResponse
    const profile = data.entry?.[0]
    if (!profile) return

    yield claim('social_profile', {
      platform: 'gravatar',
      displayName: profile.displayName ?? profile.name?.formatted ?? null,
      preferredUsername: profile.preferredUsername ?? null,
      location: profile.currentLocation ?? profile.location ?? null,
      aboutMe: profile.aboutMe ?? null,
      profileUrl: profile.profileUrl,
    }, {
      confidence: 0.7,
      evidenceUrl: profile.profileUrl,
    })

    // Gravatar profiles can carry *verified* links to other accounts — each
    // one is real pivot value (a keybase-style corroborated identity link),
    // so surface every linked account as its own username_presence claim
    // rather than burying them inside the profile blob.
    for (const account of profile.accounts ?? []) {
      if (!account.username) continue
      yield claim('username_presence', {
        platform: account.domain,
        username: account.username,
        displayName: account.display,
        verified: account.verified ?? false,
      }, {
        confidence: account.verified ? 0.85 : 0.6,
        evidenceUrl: account.url ?? profile.profileUrl,
      })
    }
  },
})
