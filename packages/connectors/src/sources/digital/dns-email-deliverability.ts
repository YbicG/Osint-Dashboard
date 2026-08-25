import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Cloudflare's DNS-over-HTTPS JSON API — keyless, no rate-limit headers seen
 * in practice, and structured JSON instead of parsing `dig` output. Given an
 * email address, this resolves the domain's MX records plus its SPF/DMARC
 * TXT posture, which speaks to whether the domain actually receives mail
 * (vs. a throwaway/parked domain) and how well it defends against spoofing —
 * both useful investigative signal on an email address with no other hits.
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

async function dohQuery(fetchFn: typeof fetch, name: string, type: 'MX' | 'TXT'): Promise<DohResponse> {
  const url = new URL(DOH_URL)
  url.searchParams.set('name', name)
  url.searchParams.set('type', type)
  const res = await fetchFn(url.toString(), { headers: { accept: 'application/dns-json' } })
  if (!res.ok) return { Status: -1 }
  return (await res.json()) as DohResponse
}

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at === -1) return null
  return email.slice(at + 1).toLowerCase()
}

export const dnsEmailDeliverabilityConnector = defineConnector({
  id: 'digital.dns_email_deliverability',
  name: 'Email Domain Deliverability (DNS)',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['email'],
  emits: ['email_deliverability'],
  rateLimitPerMinute: 120,
  robotsPolicy: 'honor',
  tosNote: 'Cloudflare publishes cloudflare-dns.com/dns-query as a public DoH resolver for exactly this kind of programmatic use; no key, no documented rate limit for reasonable volume.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Reports the sending domain\'s mail infrastructure and anti-spoofing posture, not whether this specific mailbox exists or is active — a domain with clean MX/SPF/DMARC can still have a bounced or abandoned individual address.',

  async *run(ctx) {
    if (ctx.input.type !== 'email') return
    const domain = extractDomain(ctx.input.value)
    if (!domain) {
      ctx.log('Could not extract a domain from the email address')
      return
    }

    const [mx, spf, dmarc] = await Promise.all([
      dohQuery(ctx.fetch, domain, 'MX'),
      dohQuery(ctx.fetch, domain, 'TXT'),
      dohQuery(ctx.fetch, `_dmarc.${domain}`, 'TXT'),
    ])

    if (mx.Status === -1 && spf.Status === -1 && dmarc.Status === -1) {
      ctx.log(`DNS-over-HTTPS lookup failed for domain ${domain}`)
      return
    }

    const mxRecords = (mx.Answer ?? []).map((a) => a.data)
    const spfRecord = (spf.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, '')).find((d) => d.startsWith('v=spf1'))
    const dmarcRecord = (dmarc.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, '')).find((d) => d.startsWith('v=DMARC1'))

    const hasMx = mxRecords.length > 0
    if (!hasMx) {
      ctx.log(`Domain ${domain} has no MX records — likely cannot receive mail`)
    }

    yield claim('email_deliverability', {
      domain,
      hasMx,
      mxRecords,
      hasSpf: Boolean(spfRecord),
      spfRecord: spfRecord ?? null,
      hasDmarc: Boolean(dmarcRecord),
      dmarcRecord: dmarcRecord ?? null,
      dmarcPolicy: dmarcRecord?.match(/p=(\w+)/)?.[1] ?? null,
    }, {
      confidence: hasMx ? 0.7 : 0.5,
      evidenceUrl: null,
    })
  },
})
