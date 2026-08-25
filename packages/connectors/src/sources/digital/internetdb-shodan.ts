import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Shodan's InternetDB — a free, keyless subset of full Shodan host data
 * (open ports, hostnames, CPEs, vuln IDs, tags) served from a separate
 * endpoint that carries no API-key requirement at all. This makes basic IP
 * scan coverage independent of whether SHODAN_API_KEY is configured (see
 * consumer_api/shodan.ts for the full paid-key connector, which returns
 * richer banners/geolocation this one does not).
 */
const INTERNETDB_URL = 'https://internetdb.shodan.io'

interface InternetDbResponse {
  ip: string
  ports: number[]
  hostnames: string[]
  cpes: string[]
  tags: string[]
  vulns: string[]
}

export const internetdbShodanConnector = defineConnector({
  id: 'digital.internetdb_shodan',
  name: 'Shodan InternetDB (keyless)',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['ip_address'],
  emits: ['ip_reputation'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Shodan explicitly publishes InternetDB as a free, keyless lookup for basic host data — no auth, no attribution required beyond fair use.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'A 404 here means Shodan has no scan data for this IP recently, not that the host is inactive — Shodan\'s scan coverage is not exhaustive or real-time.',

  async *run(ctx) {
    if (ctx.input.type !== 'ip_address') return

    const res = await ctx.fetch(`${INTERNETDB_URL}/${encodeURIComponent(ctx.input.value)}`)
    if (res.status === 404) {
      ctx.log(`No Shodan scan data available for ${ctx.input.value}`)
      return
    }
    if (!res.ok) {
      ctx.log(`InternetDB lookup returned HTTP ${res.status}`)
      return
    }
    const data = (await res.json()) as InternetDbResponse

    yield claim('ip_reputation', {
      ip: data.ip,
      openPorts: data.ports,
      hostnames: data.hostnames,
      cpes: data.cpes,
      tags: data.tags,
      vulnerabilities: data.vulns,
    }, {
      confidence: 0.8,
      evidenceUrl: `https://internetdb.shodan.io/${data.ip}`,
    })
  },
})
