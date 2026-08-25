import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * The primary domain -> IP pivot producer. A -> ip_address_seen claims are
 * what let the pivot engine (M3) turn a domain search into an IP-address
 * investigation of the actual hosting infrastructure. NS records go out as
 * a `dns_record` claim too — hosting-provider fingerprinting from
 * nameservers is a real, if softer, signal (e.g. Cloudflare-fronted vs.
 * self-hosted).
 */
const DOH_URL = 'https://cloudflare-dns.com/dns-query'

interface DohAnswer {
  name: string
  type: number
  TTL: number
  data: string
}

interface DohResponse {
  Status: number
  Answer?: DohAnswer[]
}

type RecordType = 'A' | 'AAAA' | 'NS'

async function dohQuery(fetchFn: typeof fetch, name: string, type: RecordType): Promise<DohResponse> {
  const url = new URL(DOH_URL)
  url.searchParams.set('name', name)
  url.searchParams.set('type', type)
  const res = await fetchFn(url.toString(), { headers: { accept: 'application/dns-json' } })
  if (!res.ok) return { Status: -1 }
  return (await res.json()) as DohResponse
}

export const dnsRecordsConnector = defineConnector({
  id: 'digital.dns_records',
  name: 'DNS Records (A/AAAA/NS)',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['domain'],
  emits: ['dns_record', 'ip_address_seen'],
  rateLimitPerMinute: 120,
  robotsPolicy: 'honor',
  tosNote: 'Cloudflare\'s public DoH resolver; no key, no documented rate limit for reasonable volume.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'A domain fronted by a CDN/reverse-proxy (Cloudflare, etc.) will resolve to the CDN\'s edge IP, not the origin server — this is expected and does not mean the lookup failed.',

  async *run(ctx) {
    if (ctx.input.type !== 'domain') return
    const domain = ctx.input.value

    const [a, aaaa, ns] = await Promise.all([
      dohQuery(ctx.fetch, domain, 'A'),
      dohQuery(ctx.fetch, domain, 'AAAA'),
      dohQuery(ctx.fetch, domain, 'NS'),
    ])

    if (a.Status === -1 && aaaa.Status === -1 && ns.Status === -1) {
      ctx.log(`DNS-over-HTTPS lookup failed for domain ${domain}`)
      return
    }

    const ipv4s = (a.Answer ?? []).map((r) => r.data)
    const ipv6s = (aaaa.Answer ?? []).map((r) => r.data)
    const nameservers = (ns.Answer ?? []).map((r) => r.data.replace(/\.$/, ''))

    if (ipv4s.length === 0 && ipv6s.length === 0) {
      ctx.log(`Domain ${domain} has no A/AAAA records`)
    }

    for (const ip of [...ipv4s, ...ipv6s]) {
      yield claim('ip_address_seen', {
        domain,
        ip,
        note: 'Resolved via public DNS; may be a CDN/reverse-proxy edge address rather than the origin host.',
      }, {
        confidence: 0.6,
        evidenceUrl: null,
      })
    }

    if (nameservers.length > 0) {
      yield claim('dns_record', {
        domain,
        recordType: 'NS',
        values: nameservers,
      }, {
        confidence: 0.85,
        evidenceUrl: null,
      })
    }
  },
})
