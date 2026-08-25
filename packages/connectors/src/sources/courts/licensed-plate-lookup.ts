import { defineConnector } from '../../sdk/index'

/**
 * Unwired slot for a DPPA §2721 permissible-use registered-owner lookup
 * (e.g. a licensed vendor with an approved permissible-use certification on
 * file). Deliberately never emits a claim — this is documentation-as-code
 * plus a coverage note for the dossier's Sources tab, not a working
 * integration. Locked decision from planning: build the legally-available
 * plate sources (see municipal.nyc_open_violations) plus this explicit,
 * disabled slot — do NOT build paid plate->VIN/owner decode APIs without a
 * verified permissible-use basis, which is a legal-authorization problem
 * this codebase cannot solve on a user's behalf.
 */
export const licensedPlateLookupConnector = defineConnector({
  id: 'licensed_vendor.plate_lookup',
  name: 'Licensed Vendor Plate-to-Owner Lookup (DPPA-gated, not configured)',
  category: 'licensed_vendor',
  costType: 'licensed',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['license_plate'],
  emits: ['vehicle_registration'],
  rateLimitPerMinute: 10,
  robotsPolicy: 'honor',
  tosNote: 'Driver\'s Privacy Protection Act (18 U.S.C. § 2721) permits registered-owner disclosure only for an enumerated permissible use, certified in advance with the state DMV or a DPPA-compliant vendor. This platform ships no vendor credential and makes no permissible-use determination on the operator\'s behalf.',
  requiresApiKey: 'LICENSED_PLATE_VENDOR_API_KEY',
  enabledByDefault: false,
  coverageNote: 'Registered-owner identity for a plate requires a DPPA-permissible-use vendor credential, which is not configured. Enabling this connector requires the operating organization to certify its own permissible use and supply LICENSED_PLATE_VENDOR_API_KEY.',

  // eslint-disable-next-line require-yield -- documentation slot; intentionally never yields (see doc comment above)
  async *run(ctx) {
    if (ctx.input.type !== 'license_plate') return
    const key = ctx.apiKey('LICENSED_PLATE_VENDOR_API_KEY')
    if (!key) {
      ctx.log('No DPPA-permissible-use vendor configured — registered-owner identity for this plate is not available. See coverageNote.')
      return
    }
    // Intentionally no implementation beyond the key check: wiring a real
    // vendor here means adopting *that* vendor's DPPA certification flow,
    // which is out of this codebase's scope to design generically.
    ctx.log('Licensed plate vendor key present but no vendor integration is implemented yet.')
  },
})
