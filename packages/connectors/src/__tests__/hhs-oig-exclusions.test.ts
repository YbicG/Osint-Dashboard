import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hhsOigExclusionsConnector } from '../sources/federal/hhs-oig-exclusions'

const fixtureCsv = readFileSync(fileURLToPath(new URL('../fixtures/hhs-oig-leie-sample.csv', import.meta.url)), 'utf-8')

describe('hhsOigExclusionsConnector', () => {
  it('matches a name against the recorded LEIE sample', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Jeffrey Fraser' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of hhsOigExclusionsConnector.run(ctx)) claims.push(c)

    expect(claims.length).toBeGreaterThanOrEqual(1)
    expect(claims[0]!.predicate).toBe('exclusion_listing')
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.matchedName).toContain('FRASER')
    expect(value.listName).toBe('HHS-OIG LEIE')
    expect(value.waiverState).toBe('NC')
  })

  it('matches on first+last name even when the query omits the middle name', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Lisa Aase' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of hhsOigExclusionsConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.matchedName).toContain('AASE')
    expect(value.specialty).toBe('NURSE/NURSES AIDE')
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
    for await (const c of hhsOigExclusionsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores business-only rows (no individual name) and non-person search inputs', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      // "1 BEST CARE, INC" is a business-only row in the fixture — should never surface for a person_name search.
      input: { type: 'person_name' as const, fullName: '1 Best Care Inc' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of hhsOigExclusionsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)

    const domainCtx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const domainClaims = []
    for await (const c of hhsOigExclusionsConnector.run(domainCtx)) domainClaims.push(c)
    expect(domainClaims).toHaveLength(0)
  })
})
