import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * NHTSA vPIC (Vehicle Products Information Catalog) VIN decoder — free,
 * keyless, public U.S. DOT API. No documented rate limit; we throttle
 * conservatively anyway since it's a shared government resource.
 *
 * IMPORTANT shape note: the task brief for this connector described the
 * response as `{ Results: [{ Variable, Value, ValueId, VariableId }, ...] }`
 * — a long Variable/Value pair list. That shape is real, but it's what the
 * sibling endpoint `decodevin` (no "values") returns. The endpoint actually
 * specified here, `decodevinvalues`, was hit live on 2026-08-24 and instead
 * returns `{ Results: [{ Make, Model, ModelYear, ErrorCode, ErrorText, ... }] }`
 * — a single FLAT object per VIN with ~130 named keys, not a list to reduce.
 * This connector is written against the shape actually observed on the wire
 * (see src/fixtures/nhtsa-vin-decode-valid.json, a verbatim recorded
 * response for VIN 1HGCM82633A004352, NHTSA's own documented example VIN).
 *
 * Validity check: vPIC always returns HTTP 200 even for a garbage VIN — it
 * reports validity via `ErrorCode`. `"0"` means "decoded clean, check digit
 * correct"; anything else (can be a comma-separated list like `"1,3,14,400"`)
 * flags a problem such as a bad check digit, wrong length, or invalid
 * characters. We treat empty or "0" as valid, per the task brief's own
 * "not empty/0" rule, and otherwise skip emitting a claim.
 */
const NHTSA_DECODE_VIN_VALUES_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues'

/**
 * Only the fields we actually read are typed explicitly; the live response
 * carries ~130 more (batteries, ADAS flags, bus/trailer/motorcycle fields,
 * etc.) that are irrelevant to almost every VIN and are not worth modeling.
 */
interface NhtsaDecodeVinValuesResult {
  VIN?: string
  Make?: string
  Model?: string
  ModelYear?: string
  Manufacturer?: string
  VehicleType?: string
  PlantCountry?: string
  PlantCity?: string
  PlantState?: string
  BodyClass?: string
  DriveType?: string
  FuelTypePrimary?: string
  EngineCylinders?: string
  Trim?: string
  ErrorCode?: string
  ErrorText?: string
  [key: string]: string | undefined
}

interface NhtsaDecodeVinValuesResponse {
  Count?: number
  Message?: string
  SearchCriteria?: string
  Results?: NhtsaDecodeVinValuesResult[]
}

export const nhtsaVinConnector = defineConnector({
  id: 'federal.nhtsa_vin',
  name: 'NHTSA vPIC VIN Decoder',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['vin'],
  emits: ['vehicle_registration'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'Public NHTSA (U.S. DOT) vPIC API — free, keyless, no documented usage restriction; intended for public/commercial consumption. Decodes manufacturer-submitted vehicle specifications only, not DMV title/registration/ownership records.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'vin') return

    const vin = ctx.input.value.trim().toUpperCase()
    const url = `${NHTSA_DECODE_VIN_VALUES_URL}/${encodeURIComponent(vin)}?format=json`

    const res = await ctx.fetch(url)
    if (!res.ok) {
      ctx.log(`NHTSA vPIC returned ${res.status}`)
      return
    }
    const data = (await res.json()) as NhtsaDecodeVinValuesResponse
    const result = data.Results?.[0]
    if (!result) {
      ctx.log('NHTSA vPIC returned no Results for this VIN')
      return
    }

    const errorCode = (result.ErrorCode ?? '').trim()
    if (errorCode !== '' && errorCode !== '0') {
      ctx.log(`NHTSA vPIC flagged VIN ${vin} as invalid (ErrorCode ${errorCode}): ${result.ErrorText ?? 'no detail'}`)
      return
    }

    yield claim('vehicle_registration', {
      vin: result.VIN || vin,
      make: result.Make || null,
      model: result.Model || null,
      modelYear: result.ModelYear || null,
      manufacturerName: result.Manufacturer || null,
      vehicleType: result.VehicleType || null,
      plantCountry: result.PlantCountry || null,
      plantCity: result.PlantCity || null,
      plantState: result.PlantState || null,
      bodyClass: result.BodyClass || null,
      driveType: result.DriveType || null,
      fuelTypePrimary: result.FuelTypePrimary || null,
      engineCylinders: result.EngineCylinders || null,
      trim: result.Trim || null,
      errorText: result.ErrorText || null,
    }, {
      confidence: 0.95,
      rawSnippet: result.ErrorText ?? null,
      evidenceUrl: url,
    })
  },
})
