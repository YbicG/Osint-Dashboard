import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gravatarConnector } from '../sources/digital/gravatar'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/gravatar-example.json', import.meta.url)), 'utf-8')

function buildCtx(inputType: 'email' | 'username', value: string, fakeFetch: typeof fetch) {
  return {
    input: { type: inputType, value } as never,
    fetch: fakeFetch,
    log: () => {},
    apiKey: () => null,
  }
}

describe('gravatarConnector', () => {
  it('parses a profile into a social_profile claim plus one username_presence claim per verified linked account', async () => {
    const fakeFetch = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch
    const ctx = buildCtx('email', 'jane.doe@example.com', fakeFetch)

    const claims = []
    for await (const c of gravatarConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(3)
    expect(claims[0]!.predicate).toBe('social_profile')
    const profile = claims[0]!.value as Record<string, unknown>
    expect(profile.preferredUsername).toBe('janedoe')
    expect(profile.location).toBe('Austin, TX')

    const linked = claims.slice(1)
    expect(linked.every((c) => c.predicate === 'username_presence')).toBe(true)
    const platforms = linked.map((c) => (c.value as Record<string, unknown>).platform)
    expect(platforms).toContain('github.com')
    expect(platforms).toContain('x.com')
    expect(linked[0]!.confidence).toBe(0.85) // verified: true
  })

  it('works from a username input too (profile-by-slug)', async () => {
    const fakeFetch = (async (input: string | URL) => {
      expect(String(input)).toBe('https://www.gravatar.com/janedoe.json')
      return new Response(fixture, { status: 200 })
    }) as unknown as typeof fetch
    const ctx = buildCtx('username', 'janedoe', fakeFetch)

    const claims = []
    for await (const c of gravatarConnector.run(ctx)) claims.push(c)
    expect(claims.length).toBeGreaterThan(0)
  })

  it('logs and yields nothing on a 404 (no registered profile)', async () => {
    const fakeFetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    const messages: string[] = []
    const ctx = {
      input: { type: 'email' as const, value: 'nobody@example.com' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of gravatarConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no gravatar profile/i)
  })

  it('ignores non-email/username inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of gravatarConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
