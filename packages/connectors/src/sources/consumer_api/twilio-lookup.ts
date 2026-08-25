import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * Twilio Lookup v2 — line type, carrier, and (with the caller-name add-on,
 * US-only) a name associated with the number. Cheap consumer API (~$0.005-
 * 0.01/lookup), one of the two paid connectors named in the plan doc's
 * "cheap APIs" tier. Degrades to a no-op (not an error) when no credentials
 * are configured — every consumer_api connector in this codebase follows
 * that same "missing key = skip silently" contract.
 */
const LOOKUP_URL = 'https://lookups.twilio.com/v2/PhoneNumbers/'

interface TwilioLookupResponse {
  phone_number: string
  national_format: string
  valid: boolean
  line_type_intelligence?: { type: string | null; carrier_name: string | null }
  caller_name?: { caller_name: string | null; caller_type: string | null }
}

export const twilioLookupConnector = defineConnector({
  id: 'consumer_api.twilio_lookup',
  name: 'Twilio Lookup (line type, carrier, caller name)',
  category: 'consumer_api',
  costType: 'paid_api',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['phone_e164'],
  emits: ['phone_line_type', 'phone_carrier', 'full_name'],
  rateLimitPerMinute: 60,
  robotsPolicy: 'honor',
  tosNote: 'Twilio Acceptable Use Policy — Lookup is intended for identity verification/fraud prevention, not bulk marketing list-building.',
  requiresApiKey: 'TWILIO_AUTH_TOKEN',
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'phone_e164') return

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = ctx.apiKey('TWILIO_AUTH_TOKEN')
    if (!accountSid || !authToken) {
      ctx.log('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured — skipping (this is a coverage gap, not an error)')
      return
    }

    const url = new URL(`${LOOKUP_URL}${encodeURIComponent(ctx.input.value)}`)
    url.searchParams.set('Fields', 'line_type_intelligence,caller_name')

    const res = await ctx.fetch(url.toString(), {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
    })
    if (!res.ok) {
      ctx.log(`Twilio Lookup returned ${res.status}`)
      return
    }
    const data = (await res.json()) as TwilioLookupResponse
    if (!data.valid) return

    const lineType = data.line_type_intelligence
    if (lineType) {
      yield claim('phone_line_type', lineType.type ?? 'unknown', { confidence: 0.9 })
      if (lineType.carrier_name) yield claim('phone_carrier', lineType.carrier_name, { confidence: 0.9 })
    }
    if (data.caller_name?.caller_name) {
      yield claim('full_name', data.caller_name.caller_name, {
        confidence: data.caller_name.caller_type === 'CONSUMER' ? 0.75 : 0.6,
        rawSnippet: `CNAM lookup, type=${data.caller_name.caller_type}`,
      })
    }
  },
})
