import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dnsEmailDeliverabilityConnector } from '../sources/digital/dns-email-deliverability'

const mxFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-gmail-mx.json', import.meta.url)), 'utf-8')
const txtFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-gmail-txt.json', import.meta.url)), 'utf-8')
const dmarcFixture = readFileSync(fileURLToPath(new URL('../fixtures/doh-gmail-dmarc.json', import.meta.url)), 'utf-8')

function fakeFetchFor(domain: string) {
  return (async (input: string | URL) => {
    const url = new URL(input.toString())
    const name = url.searchParams.get('name')
    const type = url.searchParams.get('type')
    if (name === domain && type === 'MX') return new Response(mxFixture, { status: 200 })
    if (name === domain && type === 'TXT') return new Response(txtFixture, { status: 200 })
    if (name === `_dmarc.${domain}` && type === 'TXT') return new Response(dmarcFixture, { status: 200 })
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

describe('dnsEmailDeliverabilityConnector', () => {
  it('yields a deliverability claim with MX/SPF/DMARC parsed from real DoH responses', async () => {
    const ctx = {
      input: { type: 'email' as const, value: 'someone@gmail.com' },
      fetch: fakeFetchFor('gmail.com'),
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsEmailDeliverabilityConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.hasMx).toBe(true)
    expect((value.mxRecords as string[]).length).toBe(5)
    expect(value.hasDmarc).toBe(true)
    expect(value.dmarcPolicy).toBe('none')
  })

  it('logs a warning and lowers confidence when a domain has no MX records', async () => {
    const messages: string[] = []
    const emptyDns = JSON.stringify({ Status: 0 })
    const fakeFetch = (async () => new Response(emptyDns, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'email' as const, value: 'nobody@parked-domain-example.test' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsEmailDeliverabilityConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
    expect((claims[0]!.value as Record<string, unknown>).hasMx).toBe(false)
    expect(claims[0]!.confidence).toBe(0.5)
    expect(messages[0]).toMatch(/no mx records/i)
  })

  it('ignores non-email inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of dnsEmailDeliverabilityConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
