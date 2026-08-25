import { describe, it, expect } from 'vitest'
import { nanpaGeographyConnector } from '../sources/digital/nanpa-geography'

describe('nanpaGeographyConnector', () => {
  it('resolves a known area code to its state with no network call', async () => {
    const ctx = {
      input: { type: 'phone_e164' as const, value: '+15125551234' }, // 512 -> TX
      fetch: (() => { throw new Error('should never fetch') }) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nanpaGeographyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.areaCode).toBe(512)
    expect(value.state).toBe('TX')
  })

  it('logs a coverage gap and yields nothing for an unrecognized area code', async () => {
    const messages: string[] = []
    const ctx = {
      input: { type: 'phone_e164' as const, value: '+15550000000' }, // 555 is not a real geographic area code
      fetch: (() => { throw new Error('should never fetch') }) as unknown as typeof fetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nanpaGeographyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/not in this table/i)
  })

  it('yields nothing for a non-NANP number', async () => {
    const ctx = {
      input: { type: 'phone_e164' as const, value: '+442071234567' }, // UK number
      fetch: (() => { throw new Error('should never fetch') }) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nanpaGeographyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-phone_e164 inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (() => { throw new Error('should never fetch') }) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of nanpaGeographyConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
