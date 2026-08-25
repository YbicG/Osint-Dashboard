import { describe, it, expect } from 'vitest'
import { mempoolSpaceConnector } from '../sources/digital/mempool-space'

const SAMPLE_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

function fixture() {
  return JSON.stringify({
    address: SAMPLE_ADDRESS,
    chain_stats: { funded_txo_count: 3, funded_txo_sum: 150000000, spent_txo_count: 1, spent_txo_sum: 50000000, tx_count: 4 },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
  })
}

describe('mempoolSpaceConnector', () => {
  it('computes balance in sats and BTC from funded/spent totals', async () => {
    const fakeFetch = (async (input: string | URL) => {
      expect(String(input)).toBe(`https://mempool.space/api/address/${SAMPLE_ADDRESS}`)
      return new Response(fixture(), { status: 200 })
    }) as unknown as typeof fetch
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: SAMPLE_ADDRESS },
      fetch: fakeFetch,
      log: () => {},
      apiKey: () => null,
    }

    const claims = []
    for await (const c of mempoolSpaceConnector.run(ctx)) claims.push(c)

    expect(claims).toHaveLength(1)
    const value = claims[0]!.value as Record<string, unknown>
    expect(value.balanceSats).toBe(100000000)
    expect(value.balanceBtc).toBe(1)
    expect(value.txCount).toBe(4)
  })

  it('skips values that do not look like a Bitcoin address (e.g. EVM addresses)', async () => {
    const fakeFetch = (async () => new Response('{}')) as unknown as typeof fetch
    const messages: string[] = []
    const ctx = {
      input: { type: 'crypto_wallet' as const, value: '0x71C7656EC7ab88b098defB751B7401B5f6d8976' },
      fetch: fakeFetch,
      log: (m: string) => messages.push(m),
      apiKey: () => null,
    }
    const claims = []
    for await (const c of mempoolSpaceConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(messages[0]).toMatch(/does not match/i)
  })

  it('ignores non-crypto_wallet inputs', async () => {
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of mempoolSpaceConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })
})
