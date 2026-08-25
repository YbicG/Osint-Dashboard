import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * mempool.space's public REST API — free, keyless Bitcoin address lookup
 * (balance, tx count, funded/spent totals). No auth, generous public rate
 * limit. Address-format validation is deliberately loose (regex, not a
 * full base58/bech32 checksum) — an invalid address just 404s from the API
 * and this connector logs a miss rather than duplicating validation logic
 * mempool.space already enforces server-side.
 */
const MEMPOOL_BASE = 'https://mempool.space/api/address'

interface MempoolAddressStats {
  funded_txo_count: number
  funded_txo_sum: number
  spent_txo_count: number
  spent_txo_sum: number
  tx_count: number
}

interface MempoolAddressResponse {
  address: string
  chain_stats: MempoolAddressStats
  mempool_stats: MempoolAddressStats
}

const BTC_ADDRESS_PATTERN = /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{20,60}$/

export const mempoolSpaceConnector = defineConnector({
  id: 'crypto.mempool_space',
  name: 'mempool.space Bitcoin Address Lookup',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['crypto_wallet'],
  emits: ['crypto_balance', 'crypto_transaction'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Public open-source block explorer API, no auth. On-chain data is inherently public.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'crypto_wallet') return
    if (!BTC_ADDRESS_PATTERN.test(ctx.input.value)) {
      ctx.log('Address does not match a Bitcoin address format — skipping (see crypto.blockscout_evm for EVM chains)')
      return
    }

    const res = await ctx.fetch(`${MEMPOOL_BASE}/${encodeURIComponent(ctx.input.value)}`)
    if (res.status === 400 || res.status === 404) {
      ctx.log('mempool.space did not recognize this as a valid Bitcoin address')
      return
    }
    if (!res.ok) {
      ctx.log(`mempool.space lookup returned ${res.status}`)
      return
    }
    const data = (await res.json()) as MempoolAddressResponse

    const fundedSats = data.chain_stats.funded_txo_sum
    const spentSats = data.chain_stats.spent_txo_sum
    const balanceSats = fundedSats - spentSats

    yield claim('crypto_balance', {
      chain: 'bitcoin',
      address: data.address,
      balanceSats,
      balanceBtc: balanceSats / 1e8,
      totalReceivedSats: fundedSats,
      totalSentSats: spentSats,
      txCount: data.chain_stats.tx_count,
    }, {
      confidence: 0.95,
      evidenceUrl: `https://mempool.space/address/${data.address}`,
    })
  },
})
