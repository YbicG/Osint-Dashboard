import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * US Census Bureau Geocoder — free, keyless, no rate-limit key required.
 * Given a free-text address it returns parsed components, lat/lon, AND
 * GEOIDs for state/county/tract/block/place/congressional-district. Those
 * GEOIDs are the connector that makes jurisdiction-scoped fan-out possible
 * — a later pivot stage can turn "123 Main St" into "Travis County, TX"
 * and narrow which county portals/state registries to query, instead of
 * sweeping every jurisdiction in the country.
 */
const GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'

interface CensusGeography {
  STATE?: string
  COUNTY?: string
  NAME?: string
  GEOID?: string
  BASENAME?: string
}

interface CensusAddressMatch {
  matchedAddress: string
  coordinates: { x: number; y: number }
  addressComponents: {
    zip?: string
    city?: string
    state?: string
    streetName?: string
    preType?: string
    suffixType?: string
  }
  geographies?: Record<string, CensusGeography[]>
}

interface CensusResponse {
  result: {
    addressMatches: CensusAddressMatch[]
  }
}

export const censusGeocoderConnector = defineConnector({
  id: 'federal.census_geocoder',
  name: 'US Census Bureau Geocoder',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['address'],
  emits: ['jurisdiction_fips', 'current_address'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Public federal geocoding service, no auth, no usage restriction beyond reasonable request volume.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'address') return

    const url = new URL(GEOCODER_URL)
    url.searchParams.set('address', ctx.input.raw)
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('vintage', 'Current_Current')
    url.searchParams.set('format', 'json')

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`Census geocoder returned ${res.status}`)
      return
    }
    const data = (await res.json()) as CensusResponse
    const match = data.result?.addressMatches?.[0]
    if (!match) {
      ctx.log('Census geocoder found no address match')
      return
    }

    const tracts = match.geographies?.['Census Tracts']?.[0]
    const counties = match.geographies?.['Counties']?.[0]
    const states = match.geographies?.['States']?.[0]
    const places = match.geographies?.['Incorporated Places']?.[0]
    const districts = match.geographies?.['119th Congressional Districts']?.[0]

    yield claim('current_address', {
      matchedAddress: match.matchedAddress,
      street: match.addressComponents.streetName ?? null,
      city: match.addressComponents.city ?? null,
      state: match.addressComponents.state ?? null,
      zip: match.addressComponents.zip ?? null,
      latitude: match.coordinates.y,
      longitude: match.coordinates.x,
    }, {
      confidence: 0.9,
      evidenceUrl: `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(ctx.input.raw)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`,
    })

    yield claim('jurisdiction_fips', {
      stateFips: states?.STATE ?? null,
      stateName: states?.NAME ?? null,
      countyFips: counties?.GEOID ?? null,
      countyName: counties?.NAME ?? null,
      tractGeoid: tracts?.GEOID ?? null,
      placeName: places?.NAME ?? null,
      congressionalDistrict: districts?.NAME ?? null,
    }, {
      confidence: 0.9,
      rawSnippet: `${counties?.NAME ?? 'unknown county'}, ${states?.NAME ?? 'unknown state'}`,
    })
  },
})
