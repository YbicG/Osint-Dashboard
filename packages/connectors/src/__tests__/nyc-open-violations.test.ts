import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nycOpenViolationsConnector } from '../sources/courts/nyc-open-violations'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/nyc-open-violations-example.json', import.meta.url)), 'utf-8')

describe('nycOpenViolationsConnector', () => {
  it('emits one traffic_citation claim per violation row', async () => {
    const fakeFetch = (async (input: string | URL) => {
      expect(String(input)).toContain('plate=ABC1234')
      return new Response(fixture, { status: 200 })
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'license_plate' as const, value: 'abc1234' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of nycOpenViolationsConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(2)
    expect(claims.every((c) => c.predicate === 'traffic_citation')).toBe(true)
    const first = claims[0]!.value as Record<string, unknown>
    expect(first.summonsNumber).toBe('1234567890')
    expect(first.violation).toBe('NO PARKING-STREET CLEANING')
  })

  it('ignores non-license_plate inputs', async () => {
    const ctx = {
      input: { type: 'vin' as const, value: '1HGCM82633A004352' },
      fetch: (async () => new Response('[]')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nycOpenViolationsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
