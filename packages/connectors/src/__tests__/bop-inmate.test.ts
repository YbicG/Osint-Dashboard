import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bopInmateConnector } from '../sources/federal/bop-inmate'

const fixtureJson = readFileSync(fileURLToPath(new URL('../fixtures/bop-inmate-smith.json', import.meta.url)), 'utf-8')

describe('bopInmateConnector', () => {
  it('yields incarceration_record claims for candidates clearing the name-match threshold', async () => {
    const fakeFetch = (async () => new Response(fixtureJson, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'John Lee Smith' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of bopInmateConnector.run(ctx)) claims.push(c)

    // Only the fixture's first record ("John Lee Smith") should clear an
    // 0.82 name-match threshold against "John Lee Smith" — the others
    // (John Wesley Smith, plain John Smith, etc.) score lower.
    expect(claims.length).toBeGreaterThan(0)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.matchedName).toBe('JOHN LEE SMITH')
    expect(value.inmateNumber).toBe('00123-871')
    expect(value.facilityName).toBe('Detroit')
  })

  it('logs a coverage gap and yields nothing when no record is found', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response(JSON.stringify({ InmateLocator: [] }), { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Zzyzx Qwerty Nonexistent' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of bopInmateConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/no bop federal custody record/i)
  })

  it('logs and yields nothing when a CAPTCHA is presented', async () => {
    const messages: string[] = []
    const fakeFetch = (async () => new Response(JSON.stringify({ Captcha: true }), { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'John Smith' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of bopInmateConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/captcha/i)
  })

  it('skips a search with no last name', async () => {
    const messages: string[] = []
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Madonna' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of bopInmateConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of bopInmateConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
