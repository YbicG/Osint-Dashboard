import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { blockscoutEvmConnector } from '../sources/digital/blockscout-evm'

const fundedFixture = readFileSync(fileURLToPath(new URL('../fixtures/blockscout-vitalik-eth.json', import.meta.url)), 'utf-8')
const unusedFixture = readFileSync(fileURLToPath(new URL('../fixtures/blockscout-unused-address.json', import.meta.url)), 'utf-8')

describe('blockscoutEvmConnector', () => {
  it('yields a crypto_balance claim with wei/eth conversion for a real funded address', async () => {
    const fakeFetch = (async () => new Response(fundedFixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of blockscoutEvmConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.chain).toBe('ethereum')
    expect(value.ensName).toBe('vitalik.eth')
    expect(value.balanceWei).toBe('6642111565221340300')
    expect(value.balanceEth).toBeCloseTo(6.64211156522134, 5)
    expect(value.isContract).toBe(true)
  })

  it('preserves a null balance (never funded) rather than coercing to zero', async () => {
    const fakeFetch = (async () => new Response(unusedFixture, { status: 200 })) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '0x0000000000000000000000000000000000dEaD00' },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of blockscoutEvmConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.balanceWei).toBeNull()
    expect(value.balanceEth).toBeNull()
  })

  it('skips non-EVM address formats (e.g. Bitcoin)', async () => {
    const messages: string[] = []
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of blockscoutEvmConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/does not match an evm/i)
  })

  it('ignores non-crypto_wallet inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of blockscoutEvmConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
