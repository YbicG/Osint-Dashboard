import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/**
 * NYC Open Data's parking/camera violations dataset (Socrata), searchable
 * by plate — free, keyless (Socrata's public "no app token" tier is rate
 * limited but functional). This is close to the entirety of what's
 * legitimately, keylessly plate-searchable: real toll-violation portals
 * require a notice number *and* a PIN behind a CAPTCHA, salvage/auction
 * sites are VIN-keyed with ToS prohibiting automation, and FMCSA has no
 * live plate->carrier lookup. See `licensed_vendor.plate_lookup` for the
 * unwired DPPA-gated slot that covers registered-owner identity, which
 * this dataset intentionally does not attempt.
 */
const SOCRATA_URL = 'https://data.cityofnewyork.us/resource/nc67-uf89.json'

interface ViolationRow {
  plate: string
  state: string
  license_type?: string
  summons_number: string
  issue_date: string
  violation: string
  fine_amount?: string
  penalty_amount?: string
  payment_amount?: string
  amount_due?: string
}

export const nycOpenViolationsConnector = defineConnector({
  id: 'municipal.nyc_open_violations',
  name: 'NYC Open Data Parking & Camera Violations',
  category: 'courts_corrections',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'municipal',
  accepts: ['license_plate'],
  emits: ['traffic_citation'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'NYC Open Data — public dataset published under the NYC Open Data terms of use, no auth for the base tier.',
  requiresApiKey: null,
  enabledByDefault: true,
  coverageNote: 'Plate coverage is New York City only. No nationwide plate registry is legitimately, keylessly searchable — see the licensed-vendor slot for DPPA-permissible registered-owner lookups.',

  async *run(ctx) {
    if (ctx.input.type !== 'license_plate') return

    const url = new URL(SOCRATA_URL)
    url.searchParams.set('plate', ctx.input.value.toUpperCase())
    url.searchParams.set('$limit', '50')
    url.searchParams.set('$order', 'issue_date DESC')

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`NYC Open Data violations lookup returned ${res.status}`)
      return
    }
    const rows = (await res.json()) as ViolationRow[]

    for (const row of rows) {
      yield claim('traffic_citation', {
        jurisdiction: 'NYC',
        summonsNumber: row.summons_number,
        plate: row.plate,
        plateState: row.state,
        violation: row.violation,
        fineAmount: row.fine_amount ?? null,
        amountDue: row.amount_due ?? null,
      }, {
        confidence: 0.9,
        observedAt: row.issue_date ? new Date(row.issue_date) : null,
        rawSnippet: `${row.violation} — summons ${row.summons_number}`,
        evidenceUrl: `https://data.cityofnewyork.us/resource/nc67-uf89.json?plate=${encodeURIComponent(row.plate)}`,
      })
    }
  },
})
