import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unConsolidatedConnector } from '../sources/sanctions/un-consolidated'

const fixtureXml = readFileSync(fileURLToPath(new URL('../fixtures/un-consolidated-sample.xml', import.meta.url)), 'utf-8')

describe('unConsolidatedConnector', () => {
  it('matches a four-part individual name against the recorded UN list sample', async () => {
    const fakeFetch = (async () => new Response(fixtureXml, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Qusay Saddam Hussein Al-Tikriti' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of unConsolidatedConnector.run(ctx)) claims.push(c)

    // The query also partially overlaps "SADDAM HUSSEIN AL-TIKRITI" (IQi.001),
    // which is a legitimate secondary hit, so find the exact-match record
    // rather than assuming array order.
    const exact = claims.find((c) => (c.value as Record<string, unknown>).referenceNumber === 'IQi.002')
    expect(exact).toBeDefined()
    expect(exact!.predicate).toBe('sanctions_listing')
    const value = exact!.value as Record<string, unknown>
    expect(value.listName).toBe('UN Consolidated')
    expect(value.matchedName).toBe('QUSAY SADDAM HUSSEIN AL-TIKRITI')
    expect(value.recordType).toBe('individual')
    expect(value.nameMatchScore).toBe(1)
  })

  it('matches via a populated alias, not just the primary name', async () => {
    const fakeFetch = (async () => new Response(fixtureXml, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Abu Ali' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of unConsolidatedConnector.run(ctx)) claims.push(c)

    expect(claims.length).toBeGreaterThanOrEqual(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.referenceNumber).toBe('IQi.001')
    expect(value.matchedName).toBe('Abu Ali')
    expect(value.primaryName).toBe('SADDAM HUSSEIN AL-TIKRITI')
  })

  it('matches an ENTITY block (organization name) as well as individuals', async () => {
    const fakeFetch = (async () => new Response(fixtureXml, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Allied Democratic Forces' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of unConsolidatedConnector.run(ctx)) claims.push(c)

    expect(claims.length).toBeGreaterThanOrEqual(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.recordType).toBe('entity')
    expect(value.referenceNumber).toBe('CDe.001')
  })

  it('does not match an unrelated name', async () => {
    const fakeFetch = (async () => new Response(fixtureXml, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Unrelated' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of unConsolidatedConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response(fixtureXml)) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of unConsolidatedConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
