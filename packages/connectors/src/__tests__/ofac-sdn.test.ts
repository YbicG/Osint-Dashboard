import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ofacSdnConnector } from '../sources/sanctions/ofac-sdn'

const fixtureCsv = readFileSync(fileURLToPath(new URL('../fixtures/ofac-sdn-sample.csv', import.meta.url)), 'utf-8')

describe('ofacSdnConnector', () => {
  it('matches a name against the recorded SDN list sample', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Nicolas Maduro' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of ofacSdnConnector.run(ctx)) claims.push(c)

    expect(claims.length).toBeGreaterThanOrEqual(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.matchedName).toContain('MADURO')
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
    for await (const c of ofacSdnConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
