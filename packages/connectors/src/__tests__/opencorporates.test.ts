import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openCorporatesConnector } from '../sources/consumer_api/opencorporates'
import { ConnectorHttpError } from '../sdk/http'

// Real, vendor-published documentation example (verbatim field values from
// knowledge.opencorporates.com/knowledge-base/searching-for-an-officer/):
// officer Christopher Taggart, director of OpenCorporates Holding Ltd
// (UK company 11268479). See header comment in opencorporates.ts for why
// this is transcribed from OpenCorporates' own docs rather than a fresh
// authenticated capture (no OPENCORPORATES_API_KEY was available).
const officersFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/opencorporates-officers-search.json', import.meta.url)),
  'utf-8',
)

// Real vendor-documented "OpenCorporates Ltd" (UK 07444723) entry plus one
// synthetic filler company ("Jane Cooper Consulting LLC") added purely to
// exercise the name-substring fallback filter — same real+synthetic-filler
// pattern already used in fixtures/ofac-sdn-sample.csv.
const companiesFallbackFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/opencorporates-companies-search-fallback.json', import.meta.url)),
  'utf-8',
)

function baseCtx(fetchImpl: typeof fetch, apiKey: string | null = 'test-token') {
  return {
    input: { type: 'person_name' as const, fullName: 'Christopher Taggart' },
    fetch: fetchImpl,
    log: () => {},
    apiKey: () => apiKey,
  }
}

describe('openCorporatesConnector', () => {
  it('skips entirely when no API key is configured (anonymous tier is dead, verified live)', async () => {
    const ctx = baseCtx((async () => new Response('{}')) as unknown as typeof fetch, null)
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => 'test-token',
    }
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('emits business_officer + business_registration from a matched officers/search hit, carrying the api_token', async () => {
    let officersUrl: string | null = null
    const fakeFetch = (async (input: string | URL) => {
      officersUrl = input.toString()
      return new Response(officersFixture, { status: 200 })
    }) as unknown as typeof fetch

    const ctx = baseCtx(fakeFetch)
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)

    expect(officersUrl).toContain('officers/search')
    expect(officersUrl).toContain('api_token=test-token')
    expect(officersUrl).toContain('q=Christopher')

    expect(claims).toHaveLength(2)

    const officerClaim = claims.find((c) => c.predicate === 'business_officer')!
    expect(officerClaim).toBeDefined()
    const officerValue = officerClaim.value as Record<string, unknown>
    expect(officerValue.officerName).toBe('CHRISTOPHER TAGGART')
    expect(officerValue.position).toBe('director')
    expect(officerValue.companyName).toBe('OPENCORPORATES HOLDING LTD')
    expect(officerValue.companyNumber).toBe('11268479')
    expect(officerValue.jurisdictionCode).toBe('gb')
    expect(officerClaim.confidence).toBeGreaterThan(0.85)
    expect(officerClaim.evidenceUrl).toBe('https://opencorporates.com/officers/280995341')

    const registrationClaim = claims.find((c) => c.predicate === 'business_registration')!
    expect(registrationClaim).toBeDefined()
    const regValue = registrationClaim.value as Record<string, unknown>
    expect(regValue.companyName).toBe('OPENCORPORATES HOLDING LTD')
    expect(regValue.companyNumber).toBe('11268479')
    // Not present on the officers/search company sub-object — verified
    // against OpenCorporates' own documented shape.
    expect(regValue.incorporationDate).toBeNull()
    expect(regValue.status).toBeNull()
  })

  it('filters out officer name matches below the similarity threshold', async () => {
    const fakeFetch = (async () => new Response(officersFixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Unrelated' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => 'test-token',
    }
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('logs and returns (does not throw) when the configured token is rejected with 401', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid Api Token. Please check your OpenCorporates account' } }), {
        status: 401,
      })) as unknown as typeof fetch
    const logs: string[] = []
    const ctx = {
      ...baseCtx(fakeFetch),
      log: (m: string) => logs.push(m),
    }
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(logs.some((m) => m.includes('401'))).toBe(true)
  })

  it('falls back to company-name-substring search (ProPublica-style, confidence 0.5) when officers/search is blocked, logging and continuing rather than throwing', async () => {
    const fakeFetch = (async (input: string | URL) => {
      const url = input.toString()
      if (url.includes('officers/search')) {
        // Simulates what the real createConnectorFetch wrapper throws for
        // a 429/403 from the live endpoint (see sdk/http.ts) — this is the
        // "log and continue on 401/403/429 rather than throwing" contract.
        throw new ConnectorHttpError('Blocked with status 429', 'blocked', 429)
      }
      if (url.includes('companies/search')) {
        return new Response(companiesFallbackFixture, { status: 200 })
      }
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch

    const logs: string[] = []
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jane Cooper' },
      fetch: fakeFetch,
      log: (m: string) => logs.push(m),
      apiKey: () => 'test-token',
    }
    const claims = []
    for await (const c of openCorporatesConnector.run(ctx)) claims.push(c)

    expect(logs.some((m) => m.includes('blocked'))).toBe(true)
    expect(claims).toHaveLength(1)
    expect(claims[0]!.predicate).toBe('business_registration')
    expect(claims[0]!.confidence).toBe(0.5)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.companyName).toBe('JANE COOPER CONSULTING LLC')
    expect(value.incorporationDate).toBe('2019-06-01')
    expect(value.status).toBe('Active')

    // The real, unrelated "OPENCORPORATES LTD" entry must be excluded —
    // proves the substring filter actually filters, not just under-counts.
    const names = claims.map((c) => (c.value as Record<string, unknown>).companyName)
    expect(names).not.toContain('OPENCORPORATES LTD')
  })
})
