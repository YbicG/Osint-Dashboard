import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/** crt.sh — public Certificate Transparency log search, no key. Surfaces subdomains and historical certs, useful for mapping an org's/person's infrastructure footprint. */
const CRT_SH_URL = 'https://crt.sh/'

interface CrtShEntry {
  id: number
  name_value: string
  not_before: string
  issuer_name: string
}

export const certificateTransparencyConnector = defineConnector({
  id: 'digital.certificate_transparency',
  name: 'Certificate Transparency (crt.sh)',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['domain'],
  emits: ['domain_certificate'],
  rateLimitPerMinute: 20, // crt.sh is a shared community resource — deliberately conservative
  robotsPolicy: 'honor',
  tosNote: 'Public CT log aggregator run by Sectigo; no auth, be a good citizen with request volume.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'domain') return

    const url = new URL(CRT_SH_URL)
    url.searchParams.set('q', `%.${ctx.input.value}`)
    url.searchParams.set('output', 'json')

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`crt.sh returned ${res.status}`)
      return
    }
    const text = await res.text()
    if (!text.trim()) return
    const entries = JSON.parse(text) as CrtShEntry[]

    const seenSubdomains = new Set<string>()
    for (const entry of entries) {
      for (const name of entry.name_value.split('\n')) {
        const clean = name.trim().toLowerCase()
        if (!clean || seenSubdomains.has(clean)) continue
        seenSubdomains.add(clean)
        yield claim('domain_certificate', {
          subdomain: clean,
          issuer: entry.issuer_name,
          certId: entry.id,
        }, {
          confidence: 0.9,
          observedAt: entry.not_before ? new Date(entry.not_before) : null,
          evidenceUrl: `https://crt.sh/?id=${entry.id}`,
        })
      }
    }
  },
})
