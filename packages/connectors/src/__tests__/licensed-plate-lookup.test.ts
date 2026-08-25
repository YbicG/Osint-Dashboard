import { describe, it, expect } from 'vitest'
import { licensedPlateLookupConnector } from '../sources/courts/licensed-plate-lookup'

describe('licensedPlateLookupConnector', () => {
  it('is disabled by default', () => {
    expect(licensedPlateLookupConnector.enabledByDefault).toBe(false)
  })

  it('never yields a claim, even with a key present — no vendor is implemented', async () => {
    const ctx = {
      input: { type: 'license_plate' as const, value: 'ABC1234' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => 'fake-key',
    }
    const claims = []
    for await (const c of licensedPlateLookupConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('logs a coverage-gap message when no key is configured', async () => {
    const messages: string[] = []
    const ctx = {
      input: { type: 'license_plate' as const, value: 'ABC1234' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of licensedPlateLookupConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/DPPA-permissible-use vendor configured/)
  })
})
