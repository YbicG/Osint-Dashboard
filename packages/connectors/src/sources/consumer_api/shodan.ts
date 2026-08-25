import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Shodan Host Lookup — internet-wide scan data (open ports, banner-grabbed
 * service/version fingerprints, and CVEs Shodan has matched against those
 * fingerprints via CPE) for a single IP. This is exposure/attack-surface
 * intelligence, not plain geolocation — it overlaps with digital.ip_geolocation
 * (ip-api.com) only in that both key off an IP, but the claim shape here is
 * deliberately distinct (ports/services/vulns/org/isp) rather than
 * lat/lon/city/proxy-flag, so the two connectors are complementary, not
 * duplicative.
 *
 * Requires a paid Shodan API key (https://developer.shodan.io/api, all plans
 * are metered and rate-limited to 1 req/sec). No key -> skip silently, same
 * "missing key = coverage gap, not an error" contract as twilio-lookup.ts.
 *
 * Endpoint verified live 2026-08-24: GET https://api.shodan.io/shodan/host/{ip}
 * without a key returns HTTP 401 (confirming the key requirement); a
 * previously-cached response for a real, publicly-scannable host
 * (scanme.nmap.org, 45.33.32.156 — the Nmap project's dedicated public test
 * target) was captured and trimmed into fixtures/shodan-host-example.json to
 * confirm the response shape below, including that top-level `vulns` is a
 * flat array of CVE-id strings (not the nested {cve: {cvss, summary, ...}}
 * object shape some older third-party writeups describe).
 */
const SHODAN_HOST_URL = 'https://api.shodan.io/shodan/host/'

interface ShodanBanner {
  port: number
  transport?: string
  product?: string
  version?: string
  cpe?: string[]
  timestamp?: string
  _shodan?: { module?: string }
}

interface ShodanHostResponse {
  ip_str: string
  org?: string | null
  isp?: string | null
  asn?: string | null
  city?: string | null
  country_name?: string | null
  hostnames?: string[]
  domains?: string[]
  ports?: number[]
  tags?: string[]
  os?: string | null
  last_update?: string
  vulns?: string[]
  data?: ShodanBanner[]
  error?: string
}

/** Shodan's `last_update` is UTC but the string carries no `Z`/offset — append one so `Date` doesn't treat it as local time. */
function parseShodanTimestamp(ts: string | undefined): Date | null {
  if (!ts) return null
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export const shodanConnector = defineConnector({
  id: 'digital.shodan',
  name: 'Shodan Host Lookup (exposed ports, services, vulns)',
  category: 'consumer_api',
  costType: 'paid_api',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['ip_address'],
  emits: ['geolocation'],
  rateLimitPerMinute: 30, // Shodan hard-caps every plan at 1 req/sec (60/min) platform-wide; stay well under that shared ceiling
  robotsPolicy: 'honor',
  tosNote: 'Shodan API Terms of Service — metered/paid per-query on all tiers, 1 req/sec rate limit enforced account-wide; intended for security research and asset/exposure monitoring, not bulk re-publishing of raw banner data.',
  requiresApiKey: 'SHODAN_API_KEY',
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'ip_address') return

    const apiKey = ctx.apiKey('SHODAN_API_KEY')
    if (!apiKey) {
      ctx.log('SHODAN_API_KEY not configured — skipping (this is a coverage gap, not an error)')
      return
    }

    const url = new URL(`${SHODAN_HOST_URL}${encodeURIComponent(ctx.input.value)}`)
    url.searchParams.set('key', apiKey)

    const res = await ctx.fetch(url.toString())
    if (res.status === 404) {
      ctx.log(`Shodan has no data for ${ctx.input.value}`)
      return
    }
    if (!res.ok) {
      ctx.log(`Shodan host lookup returned ${res.status}`)
      return
    }

    const data = (await res.json()) as ShodanHostResponse
    if (data.error) {
      ctx.log(`Shodan host lookup error: ${data.error}`)
      return
    }

    const services = (data.data ?? []).map((b) => ({
      port: b.port,
      transport: b.transport ?? null,
      product: b.product ?? null,
      version: b.version ?? null,
      module: b._shodan?.module ?? null,
      cpe: b.cpe ?? [],
    }))

    yield claim('geolocation', {
      ip: data.ip_str ?? ctx.input.value,
      org: data.org ?? null,
      isp: data.isp ?? null,
      asn: data.asn ?? null,
      openPorts: data.ports ?? [],
      services,
      vulnCves: data.vulns ?? [],
      hostnames: data.hostnames ?? [],
      domains: data.domains ?? [],
      tags: data.tags ?? [],
      lastScanAt: data.last_update ?? null,
    }, {
      confidence: 0.85, // direct scan/banner data, but banners can be stale or spoofed
      observedAt: parseShodanTimestamp(data.last_update),
      evidenceUrl: `https://www.shodan.io/host/${data.ip_str ?? ctx.input.value}`,
    })
  },
})
