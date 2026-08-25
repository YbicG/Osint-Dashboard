import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { internetdbShodanConnector } from '../sources/digital/internetdb-shodan'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/internetdb-8.8.8.8.json', import.meta.url)), 'utf-8')

describe('internetdbShodanConnector', () => {
  it('yields an ip_reputation claim from a real InternetDB response', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'ip_address' as const, value: '8.8.8.8' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of internetdbShodanConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.openPorts).toEqual([53, 443])
    expect(value.hostnames).toContain('dns.google')
  })

  it('logs a coverage gap and yields nothing on a 404 (no scan data)', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response(JSON.stringify({ detail: 'No information available' }), { status: 404 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'ip_address' as const, value: '198.51.100.7' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of internetdbShodanConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no shodan scan data/i)
  })

  it('ignores non-ip_address inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of internetdbShodanConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
