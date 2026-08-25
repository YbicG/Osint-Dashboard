import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { githubEmailConnector } from '../sources/digital/github-email'

const eventsFixture = readFileSync(fileURLToPath(new URL('../fixtures/github-events-torvalds.json', import.meta.url)), 'utf-8')
const commitFixture = readFileSync(fileURLToPath(new URL('../fixtures/github-commit-torvalds.json', import.meta.url)), 'utf-8')

function fakeFetchFor(username: string) {
  return (async (input: string | URL) => {
    const url = input.toString()
    if (url === `https://api.github.com/users/${username}/events/public`) {
      return new Response(eventsFixture, { status: 200 })
    }
    if (url.startsWith('https://api.github.com/repos/torvalds/linux/commits/')) {
      return new Response(commitFixture, { status: 200 })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

describe('githubEmailConnector', () => {
  it('derives an email_address claim from real commit metadata via recent push events', async () => {
    const ctx = {
      input: { type: 'username' as const, value: 'torvalds' },
      fetch: fakeFetchFor('torvalds'),
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of githubEmailConnector.run(ctx)) claims.push(c)

    // All 5 fixture events point at commits our fake fetch resolves to the
    // same commit fixture, so dedup collapses them to a single claim.
    expect(claims).toHaveLength(1)
    expect(claims[0]!.value).toBe('torvalds@linux-foundation.org')
    expect(claims[0]!.evidenceUrl).toContain('torvalds/linux/commit/')
  })

  it('logs a coverage gap and yields nothing for a username with no public push activity', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'lurker-only' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of githubEmailConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no recent public push activity/i)
  })

  it('skips GitHub noreply privacy addresses', async () => {
    const noreplyCommit = JSON.stringify({
      sha: 'abc123',
      commit: { author: { name: 'Someone', email: '12345+someone@users.noreply.github.com', date: '2024-01-01T00:00:00Z' } },
    })
    const fakeFetch = (async (input: string | URL) => {
      const url = input.toString()
      if (url.endsWith('/events/public')) return new Response(eventsFixture, { status: 200 })
      return new Response(noreplyCommit, { status: 200 })
    }) as unknown as typeof fetch
    const messages: string[] = []
    const ctx = {
      input: { type: 'username' as const, value: 'privacy-conscious' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of githubEmailConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no identifying email/i)
  })

  it('logs a coverage gap for a non-existent username (404)', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'username' as const, value: 'definitely-not-a-real-github-user-xyz' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of githubEmailConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no github account/i)
  })

  it('ignores non-username inputs', async () => {
    const ctx = {
      input: { type: 'email' as const, value: 'x@example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of githubEmailConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
