import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Blockscout — the open-source EVM block explorer used by many chains'
 * canonical explorer instances. This connector targets the Ethereum mainnet
 * instance (eth.blockscout.com); the same API shape is reused across other
 * EVM chains by base-URL swap, per the plan, but shipping one verified chain
 * beats a multi-chain fan-out nobody has confirmed the response shape for.
 * Keyless, no auth. `coin_balance` is a wei string — an unused/never-funded
 * address returns `null`, which is meaningfully different from `"0"` (never
 * touched vs. drained to zero) and is preserved as such rather than coerced.
 */
const BLOCKSCOUT_BASE = 'https://eth.blockscout.com/api/v2/addresses'
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

interface BlockscoutAddress {
  hash: string
  coin_balance: string | null
  is_contract: boolean
  is_scam: boolean
  is_verified: boolean
  ens_domain_name: string | null
  exchange_rate: string | null
  has_token_transfers: boolean
  creation_transaction_hash: string | null
  creator_address_hash: string | null
  public_tags: { display_name?: string }[] | null
}

export const blockscoutEvmConnector = defineConnector({
  id: 'crypto.blockscout_evm',
  name: 'Blockscout EVM Address Lookup',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['crypto_wallet'],
  emits: ['crypto_balance'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Public open-source block explorer API, no auth. On-chain data is inherently public.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Covers Ethereum mainnet only — the same Blockscout API shape exists on other EVM chains\' explorer instances (Polygon, BSC, Arbitrum, etc.) but only the Ethereum instance has been live-verified here.',

  async *run(ctx) {
    if (ctx.input.type !== 'crypto_wallet') return
    if (!EVM_ADDRESS_PATTERN.test(ctx.input.value)) {
      ctx.log('Address does not match an EVM (0x-prefixed, 40 hex char) format — skipping (see crypto.mempool_space for Bitcoin)')
      return
    }

    const res = await ctx.fetch(`${BLOCKSCOUT_BASE}/${encodeURIComponent(ctx.input.value)}`)
    if (res.status === 422 || res.status === 404) {
      ctx.log('Blockscout did not recognize this as a valid EVM address')
      return
    }
    if (!res.ok) {
      ctx.log(`Blockscout lookup returned ${res.status}`)
      return
    }
    const data = (await res.json()) as BlockscoutAddress

    const balanceWei = data.coin_balance
    yield claim('crypto_balance', {
      chain: 'ethereum',
      address: data.hash,
      balanceWei,
      balanceEth: balanceWei !== null ? Number(BigInt(balanceWei)) / 1e18 : null,
      isContract: data.is_contract,
      isVerifiedContract: data.is_verified,
      isFlaggedScam: data.is_scam,
      ensName: data.ens_domain_name,
      hasTokenTransfers: data.has_token_transfers,
      publicTags: data.public_tags?.map((t) => t.display_name).filter(Boolean) ?? [],
    }, {
      confidence: 0.95,
      evidenceUrl: `https://eth.blockscout.com/address/${data.hash}`,
    })
  },
})
