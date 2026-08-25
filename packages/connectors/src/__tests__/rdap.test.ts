import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rdapConnector } from '../sources/digital/rdap'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/rdap-example.json', import.meta.url)), 'utf-8')
const ipFixture = readFileSync(fileURLToPath(new URL('../fixtures/rdap-ip-example.json', import.meta.url)), 'utf-8')

describe('rdapConnector', () => {
  it('parses a recorded RDAP response into a domain_registration claim', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of rdapConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('domain_registration')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.domain).toBe('EXAMPLE.COM')
    expect(value.registrarName).toBe('Example Registrar Inc.')
    expect(value.registeredAt).toBe('1995-08-14T04:00:00Z')
  })

  it('parses a recorded RDAP IP-network response into an ip_reputation claim', async () => {
    const fakeFetch = (async () => new Response(ipFixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'ip_address' as const, value: '93.184.216.34' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of rdapConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('ip_reputation')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.handle).toBe('NET-93-184-216-0-1')
    expect(value.networkName).toBe('EXAMPLE-NET')
    expect(value.registrantOrg).toBe('Example Organization')
    expect(value.country).toBe('US')
  })

  it('ignores non-domain search inputs', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jane Doe' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of rdapConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
