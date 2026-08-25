import { describe, it, expect } from 'vitest'
import { courtListenerConnector } from '../sources/federal/courtlistener'

function fixture() {
  return JSON.stringify({
    count: 1,
    results: [
      {
        caseName: 'Doe v. Roe',
        court: 'ca5',
        dateFiled: '2022-01-10',
        docketNumber: '5:22-cv-00123',
        absolute_url: '/docket/12345/doe-v-roe/',
        status: 'Open',
      },
    ],
  })
}

describe('courtListenerConnector', () => {
  it('accepts docket_number and searches by docket_number param at high confidence', async () => {
    const fakeFetch = (async (input: string | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('docket_number')).toBe('5:22-cv-00123')
      expect(url.searchParams.get('party_name')).toBeNull()
      return new Response(fixture(), { status: 200 })
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'docket_number' as const, value: '5:22-cv-00123' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of courtListenerConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
    expect(claims[0]!.confidence).toBe(0.9)
  })

  it('still accepts person_name and searches by party_name at lower confidence', async () => {
    const fakeFetch = (async (input: string | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('party_name')).toBe('Jane Doe')
      return new Response(fixture(), { status: 200 })
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jane Doe' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of courtListenerConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
    expect(claims[0]!.confidence).toBe(0.65)
  })

  it('ignores unrelated input types', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of courtListenerConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
