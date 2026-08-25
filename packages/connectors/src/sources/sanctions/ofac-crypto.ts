import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { loadSdnList } from './_sdn-list'

/**
 * Scans the same OFAC SDN list ofac-sdn.ts already downloads for a
 * crypto_wallet search value — zero new network. OFAC's SDN export embeds
 * sanctioned digital-currency addresses directly in each entity's free-text
 * `remarks` column, formatted as `Digital Currency Address - <CODE>
 * <address>` (one segment per address, semicolon-separated alongside other
 * remarks). This has always been in the data ofac-sdn.ts downloads; nothing
 * ever scanned it for an address match — this connector is that scan.
 *
 * Match is exact-string (case-insensitive), not fuzzy — a crypto address
 * has no "close enough" the way a name does; either the SDN list names this
 * exact address or it doesn't.
 */
const DIGITAL_CURRENCY_REMARK_PATTERN = /Digital Currency Address\s*-\s*([A-Z0-9]+)\s+([A-Za-z0-9]+)/g

/** OFAC's short currency codes, mapped to the chain name used elsewhere in this codebase's claims (see mempool-space.ts's `chain: 'bitcoin'`). Codes with no mapping still yield a claim — just with the raw OFAC code as the chain label, rather than being silently dropped. */
const CHAIN_CODE_MAP: Record<string, string> = {
  XBT: 'bitcoin',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  LTC: 'litecoin',
  BCH: 'bitcoin_cash',
  BSV: 'bitcoin_sv',
  XMR: 'monero',
  DASH: 'dash',
  ZEC: 'zcash',
  XRP: 'ripple',
  USDT: 'tether',
}

export const ofacCryptoConnector = defineConnector({
  id: 'sanctions.ofac_crypto',
  name: 'OFAC SDN Digital Currency Addresses',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['crypto_wallet'],
  emits: ['sanctions_listing'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'U.S. government public-domain data (31 CFR Part 501) — no usage restriction.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'crypto_wallet') return
    const target = ctx.input.value.trim().toLowerCase()
    ctx.log('Downloading/loading cached OFAC SDN list to scan for this address...')
    const records = await loadSdnList(ctx.fetch)

    for (const record of records) {
      for (const match of record.remarks.matchAll(DIGITAL_CURRENCY_REMARK_PATTERN)) {
        const [, code, address] = match
        if (!address || address.toLowerCase() !== target) continue

        yield claim('sanctions_listing', {
          listName: 'OFAC SDN — Digital Currency Address',
          entityNumber: record.entNum,
          matchedName: record.name,
          sdnType: record.type,
          program: record.program,
          chain: CHAIN_CODE_MAP[code ?? ''] ?? (code ?? 'unknown').toLowerCase(),
          matchedAddress: address,
        }, {
          // Exact-string match on a sanctions list — the highest confidence this codebase assigns to any automated claim.
          confidence: 0.99,
          rawSnippet: `${record.name} | Digital Currency Address - ${code} ${address}`,
          evidenceUrl: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${record.entNum}`,
        })
      }
    }
  },
})
