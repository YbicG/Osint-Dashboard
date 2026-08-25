import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { finraBrokercheckConnector } from '../sources/federal/finra-brokercheck'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/brokercheck-john-smith.json', import.meta.url)), 'utf-8')

describe('finraBrokercheckConnector', () => {
  it('yields professional_license claims for candidates clearing the name-match threshold', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'John Morgan Smith' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of finraBrokercheckConnector.run(ctx)) claims.push(c)

    const licenseClaims = claims.filter((c) => c.predicate === 'professional_license')
    expect(licenseClaims.length).toBeGreaterThan(0)
    const value = licenseClaims[0]!.value as Record<string, unknown>
    expect(value.crdNumber).toBe('6808119')
    expect(value.currentFirm).toBe('VANGUARD MARKETING CORPORATION')
    expect(value.hasDisclosure).toBe(false)
  })

  it('yields an additional finra_disclosure claim when a candidate has a flagged disclosure', async () => {
    const disclosureFixture = JSON.stringify({
      hits: {
        hits: [{
          _source: {
            ind_source_id: '999999',
            ind_firstname: 'Jane',
            ind_lastname: 'Doe',
            ind_bc_disclosure_fl: 'Y',
            ind_current_employments: [],
          },
        }],
      },
    })
    const fakeFetch = (async () => new Response(disclosureFixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jane Doe' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of finraBrokercheckConnector.run(ctx)) claims.push(c)
    expect(claims.filter((c) => c.predicate === 'finra_disclosure')).toHaveLength(1)
  })

  it('logs a coverage gap and yields nothing when no broker is found', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Nonexistent' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of finraBrokercheckConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no finra-registered broker/i)
  })

  it('ignores non-person_name inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of finraBrokercheckConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
