import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { certificateTransparencyConnector } from '../sources/digital/certificate-transparency'

// crt.sh's first entry below is a genuinely live-captured response (id
// 8506962125). crt.sh suffered a sustained 502/timeout outage for the rest
// of this session (a known characteristic of this shared community
// resource, and exactly why this connector's rateLimitPerMinute is
// deliberately conservative) — the remaining two entries follow the same
// verified real schema to exercise subdomain dedup and wildcard skipping.
const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/crtsh-example-com.json', import.meta.url)), 'utf-8')

describe('certificateTransparencyConnector', () => {
  it('emits both domain_certificate and subdomain claims, skipping the root domain and wildcards', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of certificateTransparencyConnector.run(ctx)) claims.push(c)

    const certClaims = claims.filter((c) => c.predicate === 'domain_certificate')
    const subdomainClaims = claims.filter((c) => c.predicate === 'subdomain')

    // Unique names across all 3 entries: example.com, user@example.com (kept
    // as-is, dedup is on raw name_value lines), www.example.com, *.example.com
    expect(certClaims.length).toBeGreaterThan(0)

    // subdomain claims must exclude the bare root domain and the wildcard entry
    const subdomainValues = subdomainClaims.map((c) => c.value)
    expect(subdomainValues).toContain('www.example.com')
    expect(subdomainValues).not.toContain('example.com')
    expect(subdomainValues).not.toContain('*.example.com')
  })

  it('yields nothing on an empty crt.sh response', async () => {
    const fakeFetch = (async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of certificateTransparencyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-domain inputs', async () => {
    const ctx = {
      input: { type: 'username' as const, value: 'someone' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of certificateTransparencyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
