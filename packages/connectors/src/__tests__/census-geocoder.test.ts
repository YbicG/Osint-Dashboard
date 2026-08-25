import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { censusGeocoderConnector } from '../sources/federal/census-geocoder'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/census-geocoder-example.json', import.meta.url)), 'utf-8')

describe('censusGeocoderConnector', () => {
  it('emits both a current_address claim and a jurisdiction_fips claim', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'address' as const, raw: '1600 Pennsylvania Ave NW, Washington, DC' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of censusGeocoderConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(2)
    expect(claims[0]!.predicate).toBe('current_address')
    const addr = claims[0]!.value as Record<string, unknown>
    expect(addr.city).toBe('WASHINGTON')
    expect(addr.state).toBe('DC')
    expect(addr.latitude).toBeCloseTo(38.898754)

    expect(claims[1]!.predicate).toBe('jurisdiction_fips')
    const fips = claims[1]!.value as Record<string, unknown>
    expect(fips.stateFips).toBe('11')
    expect(fips.countyFips).toBe('11001')
    expect(fips.countyName).toBe('District of Columbia')
  })

  it('logs and yields nothing when the geocoder finds no match', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 })) as unknown as typeof fetch
    const messages: string[] = []
    const ctx = {
      input: { type: 'address' as const, raw: 'not a real address at all' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of censusGeocoderConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no address match/i)
  })

  it('ignores non-address inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of censusGeocoderConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
