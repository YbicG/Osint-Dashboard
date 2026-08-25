import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { keybaseConnector } from '../sources/digital/keybase'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/keybase-example.json', import.meta.url)), 'utf-8')

describe('keybaseConnector', () => {
  it('yields a social_profile claim plus one username_presence claim per verified proof', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'chris' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of keybaseConnector.run(ctx)) claims.push(c)

    const profileClaims = claims.filter((c) => c.predicate === 'social_profile')
    const presenceClaims = claims.filter((c) => c.predicate === 'username_presence')

    expect(profileClaims).toHaveLength(1)
    const profile = profileClaims[0]!.value as Record<string, unknown>
    expect(profile.fullName).toBe('Chris Coyne')
    expect(profile.location).toBe('Maine')

    // twitter, github, reddit, hackernews, web:chriscoyne.com (2 proofs) = 6 total proofs
    expect(presenceClaims).toHaveLength(6)
    const platforms = presenceClaims.map((c) => (c.value as Record<string, unknown>).platform)
    expect(platforms).toContain('twitter')
    expect(platforms).toContain('github')
    expect(platforms).toContain('reddit')
    expect(platforms).toContain('hackernews')
    expect(platforms.filter((p) => p === 'web:chriscoyne.com')).toHaveLength(2)

    // Cryptographic proofs are asserted at high confidence.
    for (const c of presenceClaims) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('logs a coverage gap and yields nothing for an unregistered username', async () => {
    const messages: string[] = []
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ status: { code: 0, name: 'OK' }, them: [null] }), { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'definitely-not-a-real-keybase-user-xyz' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of keybaseConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no keybase account/i)
  })

  it('ignores non-username inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of keybaseConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
