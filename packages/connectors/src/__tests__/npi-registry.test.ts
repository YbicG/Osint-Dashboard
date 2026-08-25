import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { npiRegistryConnector } from '../sources/federal/npi-registry'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/npi-registry-example.json', import.meta.url)), 'utf-8')

describe('npiRegistryConnector', () => {
  it('parses a recorded NPI Registry response into a professional_license claim, picking the primary taxonomy and LOCATION address', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jackelyn Kelley' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of npiRegistryConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('professional_license')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.npi).toBe('1063837144')
    expect(value.providerType).toBe('Individual')
    expect(value.name).toBe('JACKELYN RAE KELLEY')
    // Fixture's taxonomies array lists "Counselor" (primary: false) before
    // "Social Worker, Clinical" (primary: true) — must pick the flagged one,
    // not taxonomies[0].
    expect(value.specialty).toBe('Social Worker, Clinical')
    expect(value.taxonomyCode).toBe('1041C0700X')
    // Fixture's addresses array lists MAILING (Pittsburg, CA) before LOCATION
    // (San Francisco, CA) — must pick the practice LOCATION, not addresses[0].
    expect(value.practiceCity).toBe('SAN FRANCISCO')
    expect(value.practiceState).toBe('CA')
    expect(value.enumerationDate).toBe('2014-02-26')
    expect(claims[0]!.confidence).toBe(0.75)
  })

  it('logs and yields nothing when the registry rejects the query (HTTP 200 with an Errors body)', async () => {
    const errorBody = JSON.stringify({ Errors: [{ description: 'No valid search criteria provided', field: 'generic', number: '04' }] })
    const fakeFetch = (async () => new Response(errorBody, { status: 200 })) as unknown as typeof fetch

    const messages: string[] = []
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jackelyn Kelley' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }

    const claims = []
    for await (const c of npiRegistryConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages.some((m) => m.includes('No valid search criteria provided'))).toBe(true)
  })

  it('returns no results without erroring when result_count is 0', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ result_count: 0, results: [] }), { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwertyunmatched' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of npiRegistryConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of npiRegistryConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
