import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hackernewsConnector } from '../sources/digital/hackernews'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/hackernews-pg.json', import.meta.url)), 'utf-8')

describe('hackernewsConnector', () => {
  it('yields a social_profile claim for a registered username', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'pg' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of hackernewsConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.platform).toBe('hackernews')
    expect(value.username).toBe('pg')
    expect(value.karma).toBe(157316)
    expect(value.about).toBe('Bug fixer.')
  })

  it('logs a coverage gap and yields nothing for an unregistered username (literal "null" body)', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response('null', { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'definitely-not-a-real-hn-user-xyz' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of hackernewsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no hacker news account/i)
  })

  it('ignores non-username inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of hackernewsConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
