import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ukHmtConnector } from '../sources/sanctions/uk-hmt'

// Trimmed real excerpt of https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv
// (captured live 2026-08-24) — the "Report Date" banner row, the real header
// row, two rows of the HAJI KHAIRULLAH HAJI SATTAR MONEY EXCHANGE entity
// (Unique ID AFG0001), one row for Alexander Bastrykin (GHR0011), and both
// name rows for the PUTIN, Vladimir Vladimirovich individual record
// (Unique ID RUS0251).
const fixtureCsv = readFileSync(fileURLToPath(new URL('../fixtures/uk-hmt-sample.csv', import.meta.url)), 'utf-8')

describe('ukHmtConnector', () => {
  it('matches a listed individual and collapses their multiple name rows into one claim', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Vladimir Putin' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of ukHmtConnector.run(ctx)) claims.push(c)

    // RUS0251 has two rows (Primary Name + Primary Name Variation) in the
    // fixture; grouping by Unique ID means exactly one claim comes out.
    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('sanctions_listing')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.listName).toBe('UK OFSI')
    expect(value.uniqueId).toBe('RUS0251')
    expect(String(value.matchedName).toLowerCase()).toContain('putin')
    expect(value.designationType).toBe('Individual')
    expect(value.regimeName).toBe('The Russia (Sanctions) (EU Exit) Regulations 2019')
    expect(claims[0]!.observedAt).toEqual(new Date(Date.UTC(2022, 1, 25)))
  })

  it('matches a listed entity using the Name 6 (full name) column', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Haji Khairullah Haji Sattar Money Exchange' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of ukHmtConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.uniqueId).toBe('AFG0001')
    expect(value.designationType).toBe('Entity')
  })

  it('does not match an unrelated name', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Unrelated' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ukHmtConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ukHmtConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
