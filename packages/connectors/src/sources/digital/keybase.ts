import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Keybase's own identity proofs — cryptographically signed at creation time,
 * so a `username_presence` claim sourced from here carries meaningfully
 * higher confidence than a bare enumeration hit against a profile URL. Per
 * the plan: "highest pivot value per request in the catalog" — one keyless
 * call can return proven links to Twitter, GitHub, Reddit, HN, arbitrary
 * websites, and (not modeled here — no crypto_wallet emission yet) BTC/ZEC
 * addresses some users publish on their Keybase profile.
 */
const KEYBASE_LOOKUP_URL = 'https://keybase.io/_/api/1.0/user/lookup.json'

interface KeybaseProof {
  proof_type: string
  nametag: string
  state: number
  service_url?: string
  proof_url?: string
  human_url?: string
}

interface KeybaseUser {
  basics?: { username?: string }
  profile?: { full_name?: string; location?: string; bio?: string }
  proofs_summary?: {
    by_presentation_group?: Record<string, KeybaseProof[]>
  }
}

interface KeybaseLookupResponse {
  status: { code: number; name: string }
  them: (KeybaseUser | null)[]
}

// Keybase's own proof state codes: 1 = ok (currently verified live). Other
// values (revoked, temporarily unreachable, etc.) are real signal too, but
// this connector only asserts the strongest case rather than guess at the
// meaning of every intermediate state.
const PROOF_STATE_OK = 1

export const keybaseConnector = defineConnector({
  id: 'digital.keybase',
  name: 'Keybase Identity Proofs',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['username'],
  emits: ['social_profile', 'username_presence'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Keybase publishes this lookup endpoint for public, unauthenticated identity-proof verification; no key required.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Only returns results for usernames actually registered on Keybase — most usernames will yield nothing, which is expected and not a coverage gap in the connector.',

  async *run(ctx) {
    if (ctx.input.type !== 'username') return
    const username = ctx.input.value

    const url = `${KEYBASE_LOOKUP_URL}?usernames=${encodeURIComponent(username)}&fields=basics,profile,proofs_summary`
    const res = await ctx.fetch(url)
    if (!res.ok) {
      ctx.log(`Keybase lookup returned HTTP ${res.status}`)
      return
    }

    const data = (await res.json()) as KeybaseLookupResponse
    if (data.status?.code !== 0) {
      ctx.log(`Keybase lookup returned status ${data.status?.code} (${data.status?.name})`)
      return
    }

    const them = data.them?.[0]
    if (!them) {
      ctx.log(`No Keybase account registered for username "${username}"`)
      return
    }

    if (them.profile && (them.profile.full_name || them.profile.location || them.profile.bio)) {
      yield claim('social_profile', {
        platform: 'keybase',
        username: them.basics?.username ?? username,
        fullName: them.profile.full_name ?? null,
        location: them.profile.location ?? null,
        bio: them.profile.bio ?? null,
        profileUrl: `https://keybase.io/${them.basics?.username ?? username}`,
      }, {
        confidence: 0.6,
        evidenceUrl: `https://keybase.io/${them.basics?.username ?? username}`,
      })
    }

    const byPlatform = them.proofs_summary?.by_presentation_group ?? {}
    for (const [platform, proofs] of Object.entries(byPlatform)) {
      for (const proof of proofs) {
        if (proof.state !== PROOF_STATE_OK) continue
        yield claim('username_presence', {
          platform,
          username: proof.nametag,
          proofType: proof.proof_type,
          verifiedUrl: proof.service_url ?? proof.proof_url ?? proof.human_url ?? null,
        }, {
          // Cryptographically signed proof of control at creation time, not
          // a bare enumeration hit — hence a materially higher confidence
          // than the plain username_presence connectors in this codebase.
          confidence: 0.95,
          evidenceUrl: proof.human_url ?? proof.proof_url ?? null,
        })
      }
    }
  },
})
