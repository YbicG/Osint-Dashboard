import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shodanConnector } from '../sources/consumer_api/shodan'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/shodan-host-example.json', import.meta.url)), 'utf-8')

describe('shodanConnector', () => {
  it('skips silently when SHODAN_API_KEY is not configured', async () => {
    const ctx = {
      input: { type: 'ip_address' as const, value: '45.33.32.156' },
      fetch: (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of shodanConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('parses a recorded Shodan host response into a geolocation claim with ports/services/vulns', async () => {
    const fakeFetch = (async (input: string | URL) => {
      expect(String(input)).toContain('key=test-shodan-key')
      return new Response(fixture, { status: 200 })
    }) as unknown as typeof fetch

    const ctx = {
      input: { type: 'ip_address' as const, value: '45.33.32.156' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: (envVar: string) => (envVar === 'SHODAN_API_KEY' ? 'test-shodan-key' : null),
    }

    const claims = []
    for await (const c of shodanConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('geolocation')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.ip).toBe('45.33.32.156')
    expect(value.org).toBe('Linode')
    expect(value.isp).toBe('Akamai Connected Cloud')
    expect(value.openPorts).toEqual([80, 31337, 123, 22])
    expect(Array.isArray(value.vulnCves)).toBe(true)
    expect((value.vulnCves as string[])).toContain('CVE-2014-0117')

    const services = value.services as Array<Record<string, unknown>>
    expect(services).toHaveLength(4)
    const sshService = services.find((s) => s.port === 22)
    expect(sshService?.product).toBe('OpenSSH')
    expect(sshService?.version).toBe('6.6.1p1 Ubuntu 2ubuntu2.13')

    expect(claims[0]!.evidenceUrl).toBe('https://www.shodan.io/host/45.33.32.156')
    expect(claims[0]!.observedAt?.toISOString()).toBe('2026-08-24T17:21:22.277Z')
  })

  it('ignores non-ip_address search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response(fixture)) as unknown as typeof fetch,
      log: () => {},
      apiKey: (envVar: string) => (envVar === 'SHODAN_API_KEY' ? 'test-shodan-key' : null),
    }
    const claims = []
    for await (const c of shodanConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('returns no claims (without throwing) when Shodan has no data for the IP (404)', async () => {
    const ctx = {
      input: { type: 'ip_address' as const, value: '203.0.113.5' },
      fetch: (async () => new Response(JSON.stringify({ error: 'No information available for that IP.' }), { status: 404 })) as unknown as typeof fetch,
      log: () => {},
      apiKey: (envVar: string) => (envVar === 'SHODAN_API_KEY' ? 'test-shodan-key' : null),
    }
    const claims = []
    for await (const c of shodanConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
