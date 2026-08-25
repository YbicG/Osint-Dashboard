import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gitlabUserConnector } from '../sources/digital/gitlab-user'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/gitlab-sytses.json', import.meta.url)), 'utf-8')

describe('gitlabUserConnector', () => {
  it('yields a social_profile claim for a registered username', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'sytses' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of gitlabUserConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.platform).toBe('gitlab')
    expect(value.username).toBe('sytses')
    expect(value.fullName).toBe('Sid Sijbrandij')
    expect(value.profileUrl).toBe('https://gitlab.com/sytses')
    // public_email is an empty string in the live fixture (not disclosed) -> falls back to null, lower confidence
    expect(value.publicEmail).toBeNull()
    expect(claims[0]!.confidence).toBe(0.5)
  })

  it('logs a coverage gap and yields nothing for an empty result array', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'definitely-not-a-real-gitlab-user-xyz' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of gitlabUserConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no gitlab\.com account/i)
  })

  it('ignores non-username inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of gitlabUserConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
