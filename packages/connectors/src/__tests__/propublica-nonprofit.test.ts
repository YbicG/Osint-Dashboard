import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { propublicaNonprofitConnector } from '../sources/federal/propublica-nonprofit'

const searchFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/propublica-nonprofit-search.json', import.meta.url)),
  'utf-8',
)
const orgFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/propublica-nonprofit-organization.json', import.meta.url)),
  'utf-8',
)

// Real shape captured live from the API on 2026-08-24: a zero-match search
// comes back as HTTP 404 with a well-formed empty-results JSON body.
const ZERO_RESULTS_BODY = JSON.stringify({
  total_results: 0,
  organizations: [],
  num_pages: 0,
  cur_page: 0,
  page_offset: 0,
  per_page: 25,
  search_query: 'Zzyzxqwertyunrelatednonprofitxyz123',
  selected_state: null,
  selected_ntee: null,
  selected_code: null,
  api_version: 2,
})

function makeFetch(): typeof fetch {
  return (async (input: string | URL) => {
    const url = input.toString()
    if (url.includes('/search.json')) {
      return new Response(searchFixture, { status: 200 })
    }
    if (url.includes('/organizations/731395241.json')) {
      return new Response(orgFixture, { status: 200 })
    }
    // Any other org's revenue-detail lookup (e.g. the second name match) --
    // simulate a miss so the graceful-degradation path gets exercised too.
    return new Response('Not Found', { status: 404 })
  }) as unknown as typeof fetch
}

describe('propublicaNonprofitConnector', () => {
  it('keeps only literal name-substring matches from a noisy real search response, and enriches revenue where it can', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'John Smith' },
      fetch: makeFetch(),
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of propublicaNonprofitConnector.run(ctx)) claims.push(c)

    // The real fixture has 25 orgs the API's fuzzy search considered
    // "matches" (things like "Knights Of Columbus" and "Crow Farm
    // Foundation"), and 3 literally contain "John Smith" in their name or
    // sub_name: the Zink and Hal foundations below, plus a PTA chapter
    // named after a "Capt John Smith Elem" school (matches via sub_name).
    expect(claims).toHaveLength(3)
    expect(claims.every((c) => c.predicate === 'nonprofit_filing')).toBe(true)
    expect(claims.every((c) => c.confidence === 0.5)).toBe(true)

    const zink = claims.find((c) => (c.value as Record<string, unknown>).orgName === 'John Smith Zink Foundation')
    expect(zink).toBeDefined()
    const zinkValue = zink!.value as Record<string, unknown>
    expect(zinkValue.ein).toBe('73-1395241')
    expect(zinkValue.state).toBe('OK')
    expect(zinkValue.nteeCode).toBe('Z99')
    expect(zinkValue.mostRecentTotalRevenue).toBe(89335)
    expect(zinkValue.mostRecentFilingYear).toBe(2023)
    expect(zink!.evidenceUrl).toBe('https://projects.propublica.org/nonprofits/organizations/731395241')

    const hal = claims.find(
      (c) => (c.value as Record<string, unknown>).orgName === 'Hal And John Smith Fam Foundation Inc',
    )
    expect(hal).toBeDefined()
    // Its detail lookup 404s in this test double -- must degrade gracefully
    // (still emit the base claim) rather than throwing or dropping the hit.
    const halValue = hal!.value as Record<string, unknown>
    expect(halValue.mostRecentTotalRevenue).toBeNull()
    expect(halValue.mostRecentFilingYear).toBeNull()

    // The third literal match — a PTA chapter named after a school, matched
    // via sub_name rather than the org's own name. Its detail lookup also
    // 404s in this test double, so it should degrade the same way as "Hal".
    const pta = claims.find(
      (c) => (c.value as Record<string, unknown>).orgName === 'Virginia Congress Of Parents And Teachers',
    )
    expect(pta).toBeDefined()
    const ptaValue = pta!.value as Record<string, unknown>
    expect(ptaValue.mostRecentTotalRevenue).toBeNull()

    // Confirms the noise was actually excluded, not just under-counted.
    const names = claims.map((c) => (c.value as Record<string, unknown>).orgName)
    expect(names).not.toContain('Knights Of Columbus')
    expect(names).not.toContain('Crow Farm Foundation')
  })

  it('treats the documented zero-match 404 response as no hits, not a fetch error', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzxqwertyunrelatednonprofitxyz123' },
      fetch: (async () => new Response(ZERO_RESULTS_BODY, { status: 404 })) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of propublicaNonprofitConnector.run(ctx)) claims.push(c)
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
    for await (const c of propublicaNonprofitConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
