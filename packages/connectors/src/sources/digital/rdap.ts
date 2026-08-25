import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * RDAP (RFC 7480) — the modern, structured-JSON successor to WHOIS.
 * rdap.org bootstraps to the correct registry automatically for both
 * domains and IP allocations (RIRs — ARIN/RIPE/APNIC/LACNIC/AFRINIC — all
 * speak RDAP too), so one connector covers both without a per-registry list.
 */
const RDAP_DOMAIN_BOOTSTRAP = 'https://rdap.org/domain'
const RDAP_IP_BOOTSTRAP = 'https://rdap.org/ip'

interface RdapEntity {
  roles?: string[]
  vcardArray?: [string, unknown[]]
}

interface RdapResponse {
  ldhName?: string
  handle?: string
  name?: string
  startAddress?: string
  endAddress?: string
  country?: string
  status?: string[]
  events?: { eventAction: string; eventDate: string }[]
  entities?: RdapEntity[]
  nameservers?: { ldhName: string }[]
}

function vcardField(entity: RdapEntity, field: string): string | null {
  const arr = entity.vcardArray?.[1] as unknown[] | undefined
  if (!Array.isArray(arr)) return null
  for (const item of arr) {
    if (Array.isArray(item) && item[0] === field) return String(item[3] ?? '')
  }
  return null
}

export const rdapConnector = defineConnector({
  id: 'digital.rdap',
  name: 'RDAP Domain Registration Lookup',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['domain', 'ip_address'],
  emits: ['domain_registration', 'ip_reputation'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'IETF-standard public registration protocol; most registrant PII is redacted post-GDPR, but registrar/dates/nameservers/status remain public. IP allocation records (RIR ownership) carry no personal-data redaction.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type === 'domain') {
      yield* runDomainLookup(ctx.input.value, ctx)
    } else if (ctx.input.type === 'ip_address') {
      yield* runIpLookup(ctx.input.value, ctx)
    }
  },
})

async function* runDomainLookup(domain: string, ctx: { fetch: typeof fetch; log: (msg: string) => void }) {
  const res = await ctx.fetch(`${RDAP_DOMAIN_BOOTSTRAP}/${encodeURIComponent(domain)}`)
  if (!res.ok) {
    ctx.log(`RDAP domain lookup returned ${res.status}`)
    return
  }
  const data = (await res.json()) as RdapResponse

  const registrar = data.entities?.find((e) => e.roles?.includes('registrar'))
  const registrant = data.entities?.find((e) => e.roles?.includes('registrant'))
  const createdEvent = data.events?.find((e) => e.eventAction === 'registration')
  const expiresEvent = data.events?.find((e) => e.eventAction === 'expiration')

  yield claim('domain_registration', {
    domain: data.ldhName ?? domain,
    status: data.status ?? [],
    registrarName: registrar ? vcardField(registrar, 'fn') : null,
    registrantOrg: registrant ? vcardField(registrant, 'org') : null,
    registeredAt: createdEvent?.eventDate ?? null,
    expiresAt: expiresEvent?.eventDate ?? null,
    nameservers: data.nameservers?.map((ns) => ns.ldhName) ?? [],
  }, {
    confidence: 0.9,
    observedAt: createdEvent?.eventDate ? new Date(createdEvent.eventDate) : null,
    evidenceUrl: `https://rdap.org/domain/${domain}`,
  })
}

async function* runIpLookup(ip: string, ctx: { fetch: typeof fetch; log: (msg: string) => void }) {
  const res = await ctx.fetch(`${RDAP_IP_BOOTSTRAP}/${encodeURIComponent(ip)}`)
  if (!res.ok) {
    ctx.log(`RDAP IP lookup returned ${res.status}`)
    return
  }
  const data = (await res.json()) as RdapResponse

  const registrant = data.entities?.find((e) => e.roles?.includes('registrant') || e.roles?.includes('administrative'))

  yield claim('ip_reputation', {
    handle: data.handle ?? null,
    networkName: data.name ?? null,
    startAddress: data.startAddress ?? null,
    endAddress: data.endAddress ?? null,
    country: data.country ?? null,
    registrantOrg: registrant ? vcardField(registrant, 'org') : null,
    status: data.status ?? [],
  }, {
    confidence: 0.85,
    evidenceUrl: `https://rdap.org/ip/${ip}`,
  })
}
