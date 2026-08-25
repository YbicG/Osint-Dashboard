import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fccUlsConnector } from '../sources/federal/fcc-uls'

const searchFormFixture = '<html><body><form name="licenseSearch"></form></body></html>'
const resultsFixture = readFileSync(fileURLToPath(new URL('../fixtures/fcc-uls-results-sample.html', import.meta.url)), 'utf-8')
const detailFixture = readFileSync(fileURLToPath(new URL('../fixtures/fcc-uls-detail-sample.html', import.meta.url)), 'utf-8')

/** Bare-minimum Response stand-in with a working `headers.getSetCookie()`, matching what Node's real fetch returns. */
function fakeResponse(body: string, init: { status?: number; setCookie?: string[] } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200 })
  const originalHeaders = res.headers
  const setCookieList = init.setCookie ?? []
  // Real Headers objects can't have getSetCookie added onto them directly,
  // so swap in a tiny stand-in that only needs to satisfy what the
  // connector actually calls: `.getSetCookie()`. Reads from
  // `originalHeaders` (captured once, above) rather than `res.headers` to
  // avoid this replacement object referencing itself.
  Object.defineProperty(res, 'headers', {
    value: { get: (k: string) => originalHeaders.get(k), getSetCookie: () => setCookieList },
  })
  return res
}

function buildFetch() {
  const calls: { url: string; init?: RequestInit }[] = []
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/searchLicense.jsp')) {
      return fakeResponse(searchFormFixture, { setCookie: ['ak_bmsc=test-cookie-value; Path=/; HttpOnly'] })
    }
    if (url.includes('/results.jsp')) {
      return fakeResponse(resultsFixture)
    }
    if (url.includes('/license.jsp')) {
      return fakeResponse(detailFixture)
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
  return { fakeFetch, calls }
}

describe('fccUlsConnector', () => {
  it('bootstraps a session, searches by name, and enriches results with license detail', async () => {
    const { fakeFetch, calls } = buildFetch()
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'John Smith' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of fccUlsConnector.run(ctx)) claims.push(c)

    // The recorded fixture has 10 result rows; MAX_DETAIL_FETCHES=5 enriches
    // the first 5, the rest still emit from the results table alone.
    expect(claims).toHaveLength(10)
    expect(claims.every((c) => c.predicate === 'professional_license')).toBe(true)

    const first = claims[0]!.value as Record<string, unknown>
    expect(first.callSign).toBe('1130M')
    expect(first.licenseeName).toBe('SMITH, JOHN C')
    expect(first.radioServiceCode).toBe('AC')
    expect(first.status).toBe('Expired')
    expect(first.expirationDate).toBe('05/30/2004')
    // Enriched from the detail-page fixture (licKey=15871).
    expect(first.radioService).toBe('AC - Aircraft')
    expect(first.grantDate).toBe('03/24/1994')
    expect(first.addressCity).toBe('OZARK')
    expect(first.addressState).toBe('AR')
    expect(claims[0]!.evidenceUrl).toBe('https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=15871')

    const last = claims[9]!.value as Record<string, unknown>
    expect(last.callSign).toBe('832RS')
    // Past MAX_DETAIL_FETCHES, so no per-license enrichment for this row.
    expect(last.radioService).toBeNull()
    expect(last.grantDate).toBeNull()

    // Verify the search POST carried the Akamai cookie minted from the
    // bootstrap GET, and the "Last, First" query built from the input name.
    const searchCall = calls.find((c) => c.url.includes('/results.jsp'))!
    expect(String(searchCall.init?.body)).toContain('Smith%2C+John')
    expect((searchCall.init?.headers as Record<string, string>).Cookie).toBe('ak_bmsc=test-cookie-value')

    // Bounded detail fan-out: exactly MAX_DETAIL_FETCHES=5 license.jsp calls.
    expect(calls.filter((c) => c.url.includes('/license.jsp')).length).toBe(5)
  })

  it('ignores non-person_name search inputs', async () => {
    const { fakeFetch } = buildFetch()
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of fccUlsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('skips a person_name input with no parseable last name', async () => {
    const { fakeFetch } = buildFetch()
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Cher' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of fccUlsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('returns no claims when the results page has zero matches', async () => {
    const fakeFetch = (async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/searchLicense.jsp')) return fakeResponse(searchFormFixture, { setCookie: [] })
      if (url.includes('/results.jsp')) return fakeResponse('<html><body>No results found</body></html>')
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwertyplace' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of fccUlsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
