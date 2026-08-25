import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * RDAP (RFC 7480) — the modern, structured-JSON successor to WHOIS.
 * rdap.org bootstraps to the correct registry automatically; ICANN mandates
 * RDAP for all gTLD registries, so no per-TLD registry list is needed the
 * way legacy WHOIS required.
 */
const RDAP_BOOTSTRAP = 'https://rdap.org/domain'

interface RdapEntity {
  roles?: string[]
  vcardArray?: [string, unknown[]]
}

interface RdapResponse {
  ldhName?: string
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
  accepts: ['domain'],
  emits: ['domain_registration'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'IETF-standard public registration protocol; most registrant PII is redacted post-GDPR, but registrar/dates/nameservers/status remain public.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'domain') return

    const res = await ctx.fetch(`${RDAP_BOOTSTRAP}/${encodeURIComponent(ctx.input.value)}`)
    if (!res.ok) {
      ctx.log(`RDAP lookup returned ${res.status}`)
      return
    }
    const data = (await res.json()) as RdapResponse

    const registrar = data.entities?.find((e) => e.roles?.includes('registrar'))
    const registrant = data.entities?.find((e) => e.roles?.includes('registrant'))
    const createdEvent = data.events?.find((e) => e.eventAction === 'registration')
    const expiresEvent = data.events?.find((e) => e.eventAction === 'expiration')

    yield claim('domain_registration', {
      domain: data.ldhName ?? ctx.input.value,
      status: data.status ?? [],
      registrarName: registrar ? vcardField(registrar, 'fn') : null,
      registrantOrg: registrant ? vcardField(registrant, 'org') : null,
      registeredAt: createdEvent?.eventDate ?? null,
      expiresAt: expiresEvent?.eventDate ?? null,
      nameservers: data.nameservers?.map((ns) => ns.ldhName) ?? [],
    }, {
      confidence: 0.9,
      observedAt: createdEvent?.eventDate ? new Date(createdEvent.eventDate) : null,
      evidenceUrl: `https://rdap.org/domain/${ctx.input.value}`,
    })
  },
})
