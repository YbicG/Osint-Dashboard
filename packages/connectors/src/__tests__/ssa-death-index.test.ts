import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ssaDeathIndexConnector } from '../sources/federal/ssa-death-index'

/**
 * Fixture is a real, live-captured response from WikiTree's public
 * searchPerson API (https://api.wikitree.com/api.php?action=searchPerson&
 * FirstName=Franklin&LastName=Roosevelt&dateInclude=both&fields=...),
 * recorded 2026-08-25 — no API key or account was used to fetch it. See the
 * header comment in ../sources/federal/ssa-death-index.ts for the research
 * trail and the exact curl command.
 */
const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/wikitree-searchperson-roosevelt.json', import.meta.url)),
  'utf-8',
)

describe('ssaDeathIndexConnector', () => {
  it('is a real, enabled, no-key connector (not the old placeholder)', () => {
    expect(ssaDeathIndexConnector.enabledByDefault).toBe(true)
    expect(ssaDeathIndexConnector.requiresApiKey).toBeNull()
    expect(ssaDeathIndexConnector.costType).toBe('free')
    expect(ssaDeathIndexConnector.category).toBe('vital_genealogy')
    expect(ssaDeathIndexConnector.accepts).toEqual(['person_name'])
  })

  it('parses a recorded WikiTree response into a death_record + date_of_death claim for the real match', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch

    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Franklin Delano Roosevelt' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of ssaDeathIndexConnector.run(ctx)) claims.push(c)

    const deathRecords = claims.filter((c) => c.predicate === 'death_record')
    const deathDates = claims.filter((c) => c.predicate === 'date_of_death')

    // The fixture contains 5 matches: two living/undated profiles must be
    // filtered out (IsLiving:1, or no real DeathDate); the remaining ones all
    // carry the surname "Roosevelt" and a real death date, so both real FDR
    // record (Roosevelt-1) and the lower-similarity "Frank"/other Franklin
    // records can legitimately pass the name threshold — assert on the
    // specific FDR record rather than the total count.
    expect(deathRecords.length).toBeGreaterThanOrEqual(1)
    expect(deathDates.length).toBe(deathRecords.length)

    const fdr = deathRecords.find((c) => (c.value as Record<string, unknown>).wikiTreeId === 'Roosevelt-1')
    expect(fdr).toBeDefined()
    const value = fdr!.value as Record<string, unknown>
    expect(value.deathDate).toBe('1945-04-12')
    expect(value.birthDate).toBe('1882-01-30')
    expect(value.deathLocation).toBe('Warm Springs, Meriwether, Georgia, United States')
    expect(fdr!.evidenceUrl).toBe('https://www.wikitree.com/wiki/Roosevelt-1')
    expect(fdr!.confidence).toBeGreaterThan(0.5)
    expect(fdr!.confidence).toBeLessThanOrEqual(0.75)
    expect(fdr!.observedAt).toEqual(new Date('1945-04-12T00:00:00Z'))

    // The IsLiving:1 profile (Roosevelt-193, no dates at all) must never appear.
    expect(deathRecords.some((c) => (c.value as Record<string, unknown>).wikiTreeId === 'Roosevelt-193')).toBe(false)
  })

  it('does not match an unrelated name against the same fixture', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Unrelated' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ssaDeathIndexConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs and never calls fetch', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => {
        throw new Error('must not be called')
      }) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ssaDeathIndexConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('skips gracefully when no last name can be parsed out of the search name', async () => {
    const fakeFetch = (async () => {
      throw new Error('must not be called when there is no last name to search on')
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Cher' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ssaDeathIndexConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
