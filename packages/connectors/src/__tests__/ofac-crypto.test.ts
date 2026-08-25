import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ofacCryptoConnector } from '../sources/sanctions/ofac-crypto'

const fixtureCsv = readFileSync(fileURLToPath(new URL('../fixtures/ofac-sdn-sample.csv', import.meta.url)), 'utf-8')

describe('ofacCryptoConnector', () => {
  it('matches a Bitcoin address embedded in an SDN remarks column', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ofacCryptoConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.chain).toBe('bitcoin')
    expect(value.matchedName).toBe('EXAMPLE CRYPTO SANCTIONED ENTITY')
  })

  it('matches an EVM address in the same remarks column, mapped to the ethereum chain label', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '0x71C7656EC7ab88b098defB751B7401B5f6d8976' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ofacCryptoConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    expect((claims[0]!.value as Record<string, unknown>).chain).toBe('ethereum')
  })

  it('is case-insensitive on the address match', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '0X71C7656EC7AB88B098DEFB751B7401B5F6D8976' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ofacCryptoConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
  })

  it('yields nothing for an address not on the list', async () => {
    const fakeFetch = (async () => new Response(fixtureCsv, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ofacCryptoConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-crypto_wallet inputs', async () => {
    const ctx = {
      input: { type: 'person_name' as const, fullName: 'Nicolas Maduro' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of ofacCryptoConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
