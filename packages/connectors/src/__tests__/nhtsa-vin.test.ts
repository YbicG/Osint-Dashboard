import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nhtsaVinConnector } from '../sources/federal/nhtsa-vin'

// Both fixtures are verbatim recordings of live NHTSA vPIC
// `decodevinvalues` responses, captured 2026-08-24.
const validFixture = readFileSync(fileURLToPath(new URL('../fixtures/nhtsa-vin-decode-valid.json', import.meta.url)), 'utf-8')
const invalidFixture = readFileSync(fileURLToPath(new URL('../fixtures/nhtsa-vin-decode-invalid.json', import.meta.url)), 'utf-8')

describe('nhtsaVinConnector', () => {
  it('parses a recorded clean decode into a vehicle_registration claim', async () => {
    const fakeFetch = (async () => new Response(validFixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'vin' as const, value: '1HGCM82633A004352' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of nhtsaVinConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('vehicle_registration')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.vin).toBe('1HGCM82633A004352')
    expect(value.make).toBe('HONDA')
    expect(value.model).toBe('Accord')
    expect(value.modelYear).toBe('2003')
    expect(value.manufacturerName).toBe('AMERICAN HONDA MOTOR CO., INC.')
    expect(value.vehicleType).toBe('PASSENGER CAR')
    expect(value.plantCountry).toBe('UNITED STATES (USA)')
  })

  it('does not emit a claim when NHTSA flags the VIN as invalid (bad check digit)', async () => {
    const fakeFetch = (async () => new Response(invalidFixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'vin' as const, value: '1FTFW1ET5BFC10312' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of nhtsaVinConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-VIN search inputs', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jane Doe' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nhtsaVinConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
