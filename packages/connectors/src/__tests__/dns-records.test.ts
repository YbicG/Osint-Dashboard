import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dnsRecordsConnector } from '../sources/digital/dns-records'

const aFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-example-a.json', import.meta.url)), 'utf-8')
const aaaaFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-example-aaaa.json', import.meta.url)), 'utf-8')
const nsFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-example-ns.json', import.meta.url)), 'utf-8')

function fakeFetchFor(domain: string) {
  return (async (input: string | URL) => {
    const url = new URL(input.toString())
    const name = url.searchParams.get('name')
    const type = url.searchParams.get('type')
    if (name !== domain) return new Response('', { status: 404 })
    if (type === 'A') return new Response(aFixture, { status: 200 })
    if (type === 'AAAA') return new Response(aaaaFixture, { status: 200 })
    if (type === 'NS') return new Response(nsFixture, { status: 200 })
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

describe('dnsRecordsConnector', () => {
  it('yields ip_address_seen claims for every A/AAAA record and one dns_record claim for NS', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetchFor('example.com'),
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsRecordsConnector.run(ctx)) claims.push(c)

    const ipClaims = claims.filter((c) => c.predicate === 'ip_address_seen')
    const nsClaims = claims.filter((c) => c.predicate === 'dns_record')

    expect(ipClaims).toHaveLength(4) // 2 A + 2 AAAA from the live fixtures
    expect(nsClaims).toHaveLength(1)
    const nsValue = nsClaims[0]!.value as Record<string, unknown>
    expect(nsValue.values).toEqual(['hera.ns.cloudflare.com', 'elliott.ns.cloudflare.com'])
  })

  it('logs a coverage gap and yields no ip claims when a domain has no A/AAAA records', async () => {
    const messages: string[] = []
    const emptyDns = JSON.stringify({ Status: 0 })
    const fakeFetch = (async (input: string | URL) => {
      const url = new URL(input.toString())
      if (url.searchParams.get('type') === 'NS') return new Response(nsFixture, { status: 200 })
      return new Response(emptyDns, { status: 200 })
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'domain' as const, value: 'no-a-record-example.test' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsRecordsConnector.run(ctx)) claims.push(c)
    expect(claims.filter((c) => c.predicate === 'ip_address_seen')).toHaveLength(0)
    expect(messages[0]).toMatch(/no a\/aaaa records/i)
  })

  it('ignores non-domain inputs', async () => {
    const ctx = {
      input: { type: 'email' as const, value: 'x@example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsRecordsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
