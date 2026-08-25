import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/** ip-api.com free tier: no key, 45 req/min, non-commercial use (see their ToS — swap for ipapi.co/IPQualityScore with a paid key for commercial-scale volume). */
const IP_API_URL = 'http://ip-api.com/json/'

interface IpApiResponse {
  status: 'success' | 'fail'
  message?: string
  country?: string
  regionName?: string
  city?: string
  zip?: string
  lat?: number
  lon?: number
  isp?: string
  org?: string
  as?: string
  proxy?: boolean
  hosting?: boolean
}

export const ipGeolocationConnector = defineConnector({
  id: 'digital.ip_geolocation',
  name: 'IP Geolocation & Proxy Detection',
  category: 'digital',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['ip_address'],
  emits: ['geolocation'],
  rateLimitPerMinute: 40,
  robotsPolicy: 'honor',
  tosNote: 'ip-api.com free tier is non-commercial only — swap in a paid key (IPQUALITYSCORE_API_KEY) for commercial deployment.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'ip_address') return

    const res = await ctx.fetch(`${IP_API_URL}${encodeURIComponent(ctx.input.value)}?fields=status,message,country,regionName,city,zip,lat,lon,isp,org,as,proxy,hosting`)
    if (!res.ok) {
      ctx.log(`IP geolocation lookup returned ${res.status}`)
      return
    }
    const data = (await res.json()) as IpApiResponse
    if (data.status !== 'success') {
      ctx.log(`IP geolocation lookup failed: ${data.message ?? 'unknown error'}`)
      return
    }

    yield claim('geolocation', {
      ip: ctx.input.value,
      country: data.country,
      region: data.regionName,
      city: data.city,
      zip: data.zip,
      lat: data.lat,
      lon: data.lon,
      isp: data.isp,
      org: data.org,
      asn: data.as,
      isLikelyProxyOrVpn: Boolean(data.proxy || data.hosting),
    }, {
      confidence: 0.7, // IP geolocation is city-level at best, and VPN/hosting exit nodes routinely misattribute
      evidenceUrl: `http://ip-api.com/json/${ctx.input.value}`,
    })
  },
})
