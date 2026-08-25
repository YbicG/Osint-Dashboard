import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { usaSpendingConnector } from '../sources/federal/usaspending'
import { ConnectorHttpError } from '../sdk/http'

const contractsFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/usaspending-contracts-sample.json', import.meta.url)),
  'utf-8',
)
const grantsFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/usaspending-grants-sample.json', import.meta.url)),
  'utf-8',
)

/** Recorded-response fake: inspects the outgoing award_type_codes to decide which fixture to hand back, since the connector fires one request per award-type group. */
function makeFakeFetch() {
  return (async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { filters: { award_type_codes: string[] } }
    const isContractCall = body.filters.award_type_codes.includes('A')
    return new Response(isContractCall ? contractsFixture : grantsFixture, { status: 200 })
  }) as unknown as typeof fetch
}

describe('usaSpendingConnector', () => {
  it('parses recorded contract and grant responses into government_contract claims', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Lockheed Martin' },
      fetch: makeFakeFetch(),
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of usaSpendingConnector.run(ctx)) claims.push(c)

    // 3 contract rows (fixture) + 3 grant rows (fixture) = 6 claims
    expect(claims).toHaveLength(6)
    expect(claims.every((c) => c.predicate === 'government_contract')).toBe(true)

    const contractClaims = claims.filter((c) => (c.value as Record<string, unknown>).awardCategory === 'contract')
    const grantClaims = claims.filter((c) => (c.value as Record<string, unknown>).awardCategory === 'grant')
    expect(contractClaims).toHaveLength(3)
    expect(grantClaims).toHaveLength(3)

    const firstContract = contractClaims[0]!.value as Record<string, unknown>
    expect(firstContract.recipientName).toBe('LOCKHEED MARTIN INTEGRATED SYSTEMS, LLC')
    expect(firstContract.awardType).toBe('DELIVERY ORDER') // read from "Contract Award Type"
    expect(firstContract.awardAmount).toBe(172023.84)
    expect(contractClaims[0]!.evidenceUrl).toBe('https://www.usaspending.gov/award/CONT_AWD_ZV49_9700_FA877104D0008_9700')

    const firstGrant = grantClaims[0]!.value as Record<string, unknown>
    expect(firstGrant.recipientName).toBe('HARVARD UNIVERSITY')
    expect(firstGrant.awardType).toBeNull() // this fixture row's "Award Type" is genuinely null upstream
    const secondGrant = grantClaims[1]!.value as Record<string, unknown>
    expect(secondGrant.awardType).toBe('PROJECT GRANT (B)') // read from "Award Type", not "Contract Award Type"
  })

  it('ignores non-person_name search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: makeFakeFetch(),
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of usaSpendingConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('logs and returns zero claims for a group that comes back with a client error, without throwing', async () => {
    const fakeFetch = (async () => new Response('{"detail":"bad request"}', { status: 400 })) as unknown as typeof fetch
    const logs: string[] = []
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Nobody Findable' },
      fetch: fakeFetch,
      log: (m: string) => logs.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of usaSpendingConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(logs.some((m) => m.includes('400'))).toBe(true)
  })

  it('propagates a blocked/rate-limited classification instead of swallowing it', async () => {
    const fakeFetch = (async () => {
      throw new ConnectorHttpError('Blocked with status 429', 'blocked', 429)
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Someone' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const run = async () => {
      const claims = []
      for await (const c of usaSpendingConnector.run(ctx)) claims.push(c)
      return claims
    }
    await expect(run()).rejects.toThrow(ConnectorHttpError)
  })
})
