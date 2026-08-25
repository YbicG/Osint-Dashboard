import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { parseName } from '@osint/core'

/**
 * NPPES NPI Registry API v2.1 — CMS's public lookup for every National
 * Provider Identifier (NPI) issued to a U.S. healthcare provider or
 * organization (45 CFR Part 162). No API key. Verified live 2026-08-24:
 * https://npiregistry.cms.hhs.gov/api/?version=2.1&last_name=Kelley&first_name=Jackelyn&limit=1
 *
 * Two quirks confirmed against the live endpoint that the parser below
 * accounts for:
 *  - Errors come back as HTTP 200 with an `Errors` array in the body (e.g.
 *    "No valid search criteria provided"), never a 4xx/5xx status.
 *  - Name matching is a loose "starts with" search (per CMS docs), not an
 *    exact match — like CourtListener's party-name search, this can surface
 *    same/similar-named people who are not the search subject, so results
 *    are scored at moderate confidence, not treated as confirmed identity.
 */
const NPI_REGISTRY_URL = 'https://npiregistry.cms.hhs.gov/api/'
const RESULT_LIMIT = 20

interface NpiAddress {
  address_purpose?: string
  address_1?: string
  city?: string
  state?: string
  postal_code?: string
}

interface NpiTaxonomy {
  code?: string
  desc?: string
  license?: string | null
  primary?: boolean
  state?: string | null
}

interface NpiBasic {
  first_name?: string
  last_name?: string
  middle_name?: string
  organization_name?: string
  credential?: string
  sole_proprietor?: string
  status?: string
  enumeration_date?: string
  last_updated?: string
}

interface NpiResult {
  number: string
  enumeration_type: 'NPI-1' | 'NPI-2'
  basic: NpiBasic
  addresses?: NpiAddress[]
  taxonomies?: NpiTaxonomy[]
}

interface NpiRegistryResponse {
  result_count?: number
  results?: NpiResult[]
  Errors?: { description: string; field: string; number: string }[]
}

function practiceAddress(addresses: NpiAddress[] | undefined): NpiAddress | null {
  if (!addresses || addresses.length === 0) return null
  return addresses.find((a) => a.address_purpose === 'LOCATION') ?? addresses[0]!
}

function primaryTaxonomy(taxonomies: NpiTaxonomy[] | undefined): NpiTaxonomy | null {
  if (!taxonomies || taxonomies.length === 0) return null
  return taxonomies.find((t) => t.primary) ?? taxonomies[0]!
}

export const npiRegistryConnector = defineConnector({
  id: 'federal.npi_registry',
  name: 'NPPES NPI Registry (Healthcare Provider Lookup)',
  category: 'business_professional',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['professional_license'],
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'Public CMS/HHS registry mandated by HIPAA (45 CFR Part 162) — NPI data is designated disclosable at enumeration and served for free public lookup, no key or agreement required.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const parsed = parseName(ctx.input.fullName)
    if (!parsed.first && !parsed.last) return

    const url = new URL(NPI_REGISTRY_URL)
    url.searchParams.set('version', '2.1')
    if (parsed.first) url.searchParams.set('first_name', parsed.first)
    if (parsed.last) url.searchParams.set('last_name', parsed.last)
    url.searchParams.set('limit', String(RESULT_LIMIT))

    // The API always answers HTTP 200 (even on bad input) so ctx.fetch's
    // 4xx/5xx classification won't fire here — errors must be read from body.
    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`NPI Registry returned ${res.status}`)
      return
    }
    const data = (await res.json()) as NpiRegistryResponse
    if (data.Errors && data.Errors.length > 0) {
      ctx.log(`NPI Registry rejected the query: ${data.Errors.map((e) => e.description).join('; ')}`)
      return
    }

    // Both name parts present narrows the "starts with" search enough to
    // treat matches as reasonably confident; a single name part alone (e.g.
    // a one-word search subject) is a much broader match, so score it lower.
    const confidence = parsed.first && parsed.last ? 0.75 : 0.55

    for (const result of data.results ?? []) {
      const providerType = result.enumeration_type === 'NPI-2' ? 'Organization' : 'Individual'
      const displayName = providerType === 'Organization'
        ? (result.basic.organization_name ?? null)
        : [result.basic.first_name, result.basic.middle_name, result.basic.last_name].filter(Boolean).join(' ') || null

      const taxonomy = primaryTaxonomy(result.taxonomies)
      const address = practiceAddress(result.addresses)

      yield claim('professional_license', {
        npi: result.number,
        providerType,
        name: displayName,
        credential: result.basic.credential ?? null,
        status: result.basic.status === 'A' ? 'Active' : result.basic.status === 'I' ? 'Inactive' : (result.basic.status ?? null),
        taxonomyCode: taxonomy?.code ?? null,
        specialty: taxonomy?.desc ?? null,
        licenseNumber: taxonomy?.license ?? null,
        licenseState: taxonomy?.state ?? null,
        practiceCity: address?.city ?? null,
        practiceState: address?.state ?? null,
        enumerationDate: result.basic.enumeration_date ?? null,
      }, {
        confidence,
        observedAt: result.basic.enumeration_date ? new Date(result.basic.enumeration_date) : null,
        rawSnippet: `${displayName ?? 'Unknown'} — NPI ${result.number} — ${taxonomy?.desc ?? 'no taxonomy'} (${providerType})`,
        evidenceUrl: url.toString(),
      })
    }
  },
})
