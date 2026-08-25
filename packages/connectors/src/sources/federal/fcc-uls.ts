import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { parseName } from '@osint/core'

/**
 * FCC Universal Licensing System (ULS) — "By Name" License Search.
 *
 * The endpoint this connector was originally briefed against, the "License
 * View API" (https://data.fcc.gov/api/license-view/basicSearch/getLicenses),
 * is dead. Verified live 2026-08-24:
 *  - `data.fcc.gov/api/*` now 301-redirects into `www.fcc.gov`'s Drupal CMS.
 *  - The resolved `www.fcc.gov/api/license-view/basicSearch/getLicenses`
 *    path responds HTTP 200 with a Drupal "Page Not Found" article, not
 *    license JSON — the API was decommissioned, not just moved.
 *  - Even when it was alive, FCC's own docs describe it as covering only
 *    the "top ten" license holders in six enumerated spectrum bands (700
 *    MHz, 800 MHz Cellular, AWS, Broadband PCS, BRS, Education) — it was
 *    never a general person-name search over ULS, so it wouldn't have
 *    served this connector's purpose (amateur + commercial license lookup
 *    by name) even if it still worked.
 *
 * The real, current, free, no-key equivalent is the ULS License Search
 * webapp's "By Name" search, which covers every ULS radio service —
 * amateur (HA/HV), aircraft (AC), GMRS, commercial/restricted operator
 * permits, land mobile, etc. It is a 20+ year old JSP application, not a
 * JSON API: this connector POSTs the same search form a human uses and
 * parses the resulting HTML table, the same pattern OFAC's CSV-download
 * connector uses for a non-JSON source.
 *
 * Verified live 2026-08-24 with both curl and Node's fetch, which turned up
 * two load-bearing quirks:
 *  - `wireless2.fcc.gov` and `www.fcc.gov` sit behind Akamai, which returns
 *    a blanket 403 to curl's TLS fingerprint regardless of User-Agent —
 *    but Node's undici-based fetch (what `ctx.fetch` wraps) is NOT
 *    fingerprint-blocked. Confirmed the full search+detail flow below
 *    against the live site from a plain Node script, no browser/Playwright
 *    involved.
 *  - The search POST needs an Akamai bot-manager cookie (`ak_bmsc`) minted
 *    by first loading the search form. Skipping it doesn't error — the POST
 *    just silently re-renders the empty search form instead of results, a
 *    trap that would make this connector look "working" while emitting
 *    nothing.
 *  - Once a `licKey` is known (parsed out of a results-row link), the
 *    per-license detail page is plainly fetchable with no cookie or session
 *    at all: `license.jsp?licKey=NNNN`. That also makes it the right choice
 *    for a durable `evidenceUrl` — the row link itself embeds a
 *    servlet-rewritten `JSESSIONID` segment that expires with the session
 *    and would 404/dead-end for anyone revisiting it later.
 *
 * robots.txt on wireless2.fcc.gov only disallows a named bot ("PiplBot"),
 * no blanket `Disallow: /` for generic user agents, so a `robotsPolicy:
 * 'honor'` connector is not in conflict with it.
 */

const SEARCH_FORM_URL = 'https://wireless2.fcc.gov/UlsApp/UlsSearch/searchLicense.jsp'
const SEARCH_RESULTS_URL = 'https://wireless2.fcc.gov/UlsApp/UlsSearch/results.jsp'
const LICENSE_DETAIL_URL = 'https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp'

/** Bounds the extra per-license detail requests one search can trigger against a shared free .gov legacy app. */
const MAX_DETAIL_FETCHES = 5

interface UlsRow {
  licKey: string
  callSign: string
  licenseeName: string
  frn: string | null
  radioServiceCode: string
  status: string
  expirationDate: string | null
}

interface UlsDetail {
  radioService: string | null
  grantDate: string | null
  addressCity: string | null
  addressState: string | null
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
}

function cleanCell(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim()
}

/**
 * One results-table row is a fixed 7-cell `<tr>`: row number, call sign
 * (linked to `license.jsp;JSESSIONID_...?licKey=NNNN`), licensee name, FRN,
 * radio service code, status, expiration date. Verified against a live
 * "Smith, John" search (487 matches, page 1 of 10 shown) — see
 * fixtures/fcc-uls-results-sample.html for the recorded response this was
 * built from.
 */
const ROW_RE =
  /<tr align="left" valign="top">\s*<td class="cell-pri-light" nowrap>\s*\d+<\/td>\s*<td class="cell-pri-light" nowrap>\s*(?:<a href=license\.jsp;JSESSIONID_ULSSEARCH=[^?]*\?licKey=(\d+)[^>]*>([^<]*)<\/a>|([^<]*))\s*<\/td>\s*<td class="cell-pri-light" nowrap>\s*([^<]*?)\s*<\/td>\s*<td class="cell-pri-light" nowrap>\s*([^<]*?)\s*<\/td>\s*<td class="cell-pri-light" nowrap>\s*([^<]*?)\s*<\/td>\s*<td class="cell-pri-light" nowrap>\s*([^<]*?)\s*<\/td>\s*<td class="cell-pri-light" nowrap>\s*([^<]*?)\s*<\/td>/g

function parseResultsTable(html: string): UlsRow[] {
  const rows: UlsRow[] = []
  for (const m of html.matchAll(ROW_RE)) {
    const callSign = cleanCell(m[2] ?? m[3] ?? '')
    // Rows with no resolvable licKey (e.g. lease-only rows) carry no
    // fetchable license record, so they're out of scope for this claim type.
    if (!m[1] || !callSign) continue
    const frn = cleanCell(m[5] ?? '')
    rows.push({
      licKey: m[1],
      callSign,
      licenseeName: cleanCell(m[4] ?? ''),
      frn: frn || null,
      radioServiceCode: cleanCell(m[6] ?? ''),
      status: cleanCell(m[7] ?? ''),
      expirationDate: cleanCell(m[8] ?? '') || null,
    })
  }
  return rows
}

/** Matches the license detail page's repeated `<td>Label</td><td>Value</td>` layout. */
function extractLabeledCell(html: string, label: string): string | null {
  const re = new RegExp(`>${label}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
  const m = html.match(re)
  if (!m) return null
  return cleanCell(m[1]!) || null
}

/**
 * The address block under "Licensee Name" is free-form lines separated by
 * `<br>` — licensee name, optional PO box, optional street line(s), then
 * "City, ST" with the ZIP on the same visual line (per an HTML comment in
 * the page itself: fields are simply omitted when not available, so the
 * city/state line isn't reliably the last line if a trailing ATTN line is
 * present). Search from the end for the first line that looks like
 * "City, ST" rather than assuming a fixed position.
 */
function parseAddressCityState(html: string): { city: string | null; state: string | null } {
  const nameBlockMatch = html.match(/<b>Licensee Name<\/b><\/td>\s*<\/tr>\s*<tr>\s*<td[^>]*>([\s\S]*?)<\/td>/i)
  if (!nameBlockMatch) return { city: null, state: null }

  const lines = nameBlockMatch[1]!
    .split(/<br\s*\/?>/i)
    .map((line) => cleanCell(line))
    .filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    const cityStateMatch = lines[i]!.match(/^([A-Za-z .'-]+),\s*([A-Z]{2})\b/)
    if (cityStateMatch) return { city: cityStateMatch[1]!.trim(), state: cityStateMatch[2]! }
  }
  return { city: null, state: null }
}

function parseDetail(html: string): UlsDetail {
  const { city, state } = parseAddressCityState(html)
  return {
    radioService: extractLabeledCell(html, 'Radio Service'),
    grantDate: extractLabeledCell(html, 'Grant'),
    addressCity: city,
    addressState: state,
  }
}

export const fccUlsConnector = defineConnector({
  id: 'federal.fcc_uls',
  name: 'FCC Universal Licensing System (Amateur & Commercial License Search)',
  category: 'business_professional',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['professional_license'],
  // Each search issues 1 (session bootstrap) + 1 (search) + up to
  // MAX_DETAIL_FETCHES ctx.fetch calls sharing this one budget, so 20/min
  // caps this connector at roughly 2-3 full person searches per minute
  // against a legacy .gov app with no documented rate-limit guidance.
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'Public FCC licensee records (47 U.S.C./47 CFR) served by the ULS License Search webapp for anyone to browse — no login, key, or agreement required. Not a documented API: this connector parses the same HTML a human searcher would see, so a markup change upstream can silently break it.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const parsed = parseName(ctx.input.fullName)
    // ULS's "By Name" field expects "Last, First"; without a last name
    // there's no reliable way to build that query, so skip rather than guess.
    if (!parsed.last) return
    const searchValue = parsed.first ? `${parsed.last}, ${parsed.first}` : parsed.last

    // Step 1: load the search form to mint the Akamai bot-manager cookie
    // the results POST silently requires (see file header).
    const formRes = await ctx.fetch(SEARCH_FORM_URL)
    if (!formRes.ok) {
      ctx.log(`FCC ULS search form returned ${formRes.status}`)
      return
    }
    await formRes.text()
    const bootstrapCookies = typeof formRes.headers.getSetCookie === 'function' ? formRes.headers.getSetCookie() : []
    const cookieHeader = bootstrapCookies.map((c) => c.split(';')[0]!).join('; ')

    // Step 2: run the "By Name" search across every ULS radio service.
    // The select's posted value is fixed-width padded — this is exactly
    // what the live <select> element sends, not a typo.
    const body = new URLSearchParams({
      fiUlsSearchByType: 'uls_l_name                    ',
      fiUlsSearchByValue: searchValue,
      fiUlsExactMatchInd: 'N',
      hiddenForm: 'hiddenForm',
      jsValidated: 'false',
    })
    const resultsRes = await ctx.fetch(SEARCH_RESULTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: SEARCH_FORM_URL,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body.toString(),
    })
    if (!resultsRes.ok) {
      ctx.log(`FCC ULS search returned ${resultsRes.status}`)
      return
    }
    const resultsHtml = await resultsRes.text()
    const rows = parseResultsTable(resultsHtml)
    if (rows.length === 0) {
      ctx.log('FCC ULS: no license results parsed (zero matches, or the results page markup has changed)')
      return
    }

    // "By Name" is a "contains" match against the licensee-name field, same
    // caveat as the NPI/CourtListener name searches elsewhere in this
    // catalog — not confirmed identity, higher when both name parts matched.
    const baseConfidence = parsed.first ? 0.65 : 0.5

    let detailFetches = 0
    for (const row of rows) {
      let detail: UlsDetail = { radioService: null, grantDate: null, addressCity: null, addressState: null }
      if (detailFetches < MAX_DETAIL_FETCHES) {
        detailFetches++
        try {
          const detailRes = await ctx.fetch(`${LICENSE_DETAIL_URL}?licKey=${row.licKey}`)
          if (detailRes.ok) detail = parseDetail(await detailRes.text())
        } catch (err) {
          ctx.log(`FCC ULS: detail fetch failed for licKey=${row.licKey}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      yield claim('professional_license', {
        callSign: row.callSign,
        licenseeName: row.licenseeName,
        radioServiceCode: row.radioServiceCode,
        radioService: detail.radioService,
        status: row.status,
        grantDate: detail.grantDate,
        expirationDate: row.expirationDate,
        frn: row.frn,
        addressCity: detail.addressCity,
        addressState: detail.addressState,
      }, {
        confidence: baseConfidence,
        rawSnippet: `${row.callSign} — ${row.licenseeName} — ${detail.radioService ?? row.radioServiceCode} — ${row.status}`,
        evidenceUrl: `${LICENSE_DETAIL_URL}?licKey=${row.licKey}`,
      })
    }
  },
})
