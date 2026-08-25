import type { Claim, SearchInput, Predicate } from '@osint/contracts'
import { coerceClaimString, normalizePhone } from '@osint/core'

/**
 * The pivot engine's derivation table. Pure, synchronous, no I/O — exported
 * via the `@osint/connectors/pivot` subpath so a client component can call
 * it (to decide whether to render a "pivot on this" affordance) without
 * pulling the connector registry or Playwright into the browser bundle.
 *
 * MUST be total and defensive: `ClaimValue` is `string | number | boolean |
 * Record<string, unknown>`, so every rule has to handle both the scalar and
 * the structured shape a real connector might emit for its predicate, and
 * anything unparseable returns `[]` rather than throwing. A single connector
 * emitting a malformed value must never be able to kill a search — see
 * apps/worker/src/ingest/run-search.ts, which calls this once per claim
 * produced in wave 1 and must keep going regardless of what comes back.
 */
export interface DerivedInput {
  input: SearchInput
  /** The predicate whose claim produced this pivot — becomes `derived_from_claim_id`'s sibling context in the child search_request row. */
  viaPredicate: Predicate
  /** The specific claim row that produced this pivot — the evidentiary payload behind an auto-pivot ("this search exists because claim X asserted phone Y"), written straight into the child search_request's derived_from_claim_id. */
  viaClaimId: string
  /** Normalized dedup/loop-prevention key: `${input.type}:${normalizedValue}`. */
  key: string
  /** Carried into the child search's provenance; NOT the same as the parent claim's own confidence — this is how much we trust the *derivation itself*. */
  confidence: number
}

// ---------------------------------------------------------------------------
// Explicitly NOT derived, on purpose — see M3 plan section "Pivot engine":
//
//   relative_of / spouse_of / associate_of / coworker_of / neighbor_of →
//   person_name. Relationship-name pivots are the fastest route to a
//   combinatorial explosion across an entire social graph, compounded by
//   false-positive name matches. Manual-expand only (see the
//   POST /api/entities/[id]/expand endpoint) — do not "helpfully" add this.
//
//   crypto_transaction counterparties → crypto_wallet. One BTC/ETH address
//   can have thousands of counterparties; deriving from them turns a single
//   wallet search into an unbounded graph crawl. Manual-expand only.
// ---------------------------------------------------------------------------

const EMAIL_LOCAL_PART_STOPLIST = new Set([
  'info', 'admin', 'support', 'noreply', 'no-reply', 'contact', 'sales',
  'hello', 'help', 'webmaster', 'postmaster', 'abuse', 'security', 'privacy',
  'billing', 'office', 'team', 'mail', 'inquiries', 'press', 'media',
])

const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^127\./, // loopback
  /^169\.254\./, // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (100.64.0.0/10)
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
]

function isPrivateOrLoopbackIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(ip))
}

/** Full state name (as returned by census-geocoder's `jurisdiction_fips` claim) → USPS 2-letter code. Doesn't exist anywhere else in the codebase. */
const STATE_NAME_TO_USPS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', 'american samoa': 'AS', guam: 'GU',
  'northern mariana islands': 'MP', 'u.s. virgin islands': 'VI', 'virgin islands': 'VI',
}

function stateNameToUsps(name: string | null | undefined): string | null {
  if (!name) return null
  const code = STATE_NAME_TO_USPS[name.trim().toLowerCase()]
  return code ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function firstString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function simpleInput(type: Exclude<SearchInput['type'], 'person_name' | 'address' | 'image_face'>, value: string, stateHint?: string): SearchInput {
  return { type, value, stateHint } as SearchInput
}

function makeKey(type: string, value: string): string {
  return `${type}:${value.trim().toLowerCase()}`
}

/**
 * The same normalized key shape `makeKey` produces, but from a `SearchInput`
 * itself — used both internally (to detect a derived input identical to the
 * search that's already running) and externally by
 * apps/worker/src/ingest/run-search.ts to seed a PivotBudgetState's `seen`
 * set from the origin search and from recent sibling searches.
 */
export function keyForInput(input: SearchInput): string {
  if (input.type === 'person_name') return makeKey(input.type, input.fullName)
  if (input.type === 'address') return makeKey(input.type, input.raw)
  if (input.type === 'image_face') return makeKey(input.type, input.imageSha256)
  return makeKey(input.type, input.value)
}

/**
 * Derive zero or more pivot search inputs from a single collected claim.
 * `origin` is the search that produced this claim — used only to avoid
 * deriving an input identical to the one already being searched (the
 * caller's `seen` set, seeded separately with the origin's own key, is what
 * actually prevents loops across the whole run; this function is pure).
 */
export function deriveInputs(claim: Claim, origin: SearchInput): DerivedInput[] {
  try {
    return deriveInputsUnsafe(claim, origin)
  } catch {
    // A malformed claim value must never be able to kill a search.
    return []
  }
}

function deriveInputsUnsafe(claim: Claim, origin: SearchInput): DerivedInput[] {
  const out: Omit<DerivedInput, 'viaClaimId'>[] = []
  const obj = asRecord(claim.value)

  switch (claim.predicate) {
    case 'email_address': {
      const email = coerceClaimString('email_address', claim.value)
      if (!email || !email.includes('@')) break
      out.push({ input: simpleInput('email', email), viaPredicate: claim.predicate, key: makeKey('email', email), confidence: claim.confidence })

      const localPart = email.split('@')[0]?.toLowerCase()
      if (localPart && !EMAIL_LOCAL_PART_STOPLIST.has(localPart)) {
        out.push({
          input: simpleInput('username', localPart),
          viaPredicate: claim.predicate,
          key: makeKey('username', localPart),
          confidence: claim.confidence * 0.7,
        })
      }
      break
    }

    case 'phone_number': {
      const raw = coerceClaimString('phone_number', claim.value)
      if (!raw) break
      // normalizePhone defaults to 'US' region, which is the only defaultCountry
      // it's meaningful to assume here — stateHint is a US state, not a
      // libphonenumber region/country code, so it's not passed through.
      const e164 = normalizePhone(raw)
      if (!e164) break
      out.push({ input: simpleInput('phone_e164', e164), viaPredicate: claim.predicate, key: makeKey('phone_e164', e164), confidence: claim.confidence })
      break
    }

    case 'current_address':
    case 'former_address':
    case 'mailing_address': {
      if (claim.confidence < 0.6) break
      const addr = coerceClaimString(claim.predicate, claim.value)
      if (!addr) break
      const state = firstString(obj, ['state', 'stateCode'])
      out.push({
        input: { type: 'address', raw: addr, stateHint: state && state.length === 2 ? state.toUpperCase() : undefined } as SearchInput,
        viaPredicate: claim.predicate,
        key: makeKey('address', addr),
        confidence: claim.confidence,
      })
      break
    }

    case 'domain_registration':
    case 'subdomain': {
      const domain = coerceClaimString(claim.predicate, claim.value) ?? firstString(obj, ['domain', 'subdomain'])
      if (!domain) break
      out.push({ input: simpleInput('domain', domain), viaPredicate: claim.predicate, key: makeKey('domain', domain), confidence: claim.confidence })
      break
    }

    case 'ip_address_seen':
    case 'dns_record': {
      const ips: string[] = []
      const single = firstString(obj, ['ip', 'ipAddress'])
      if (single) ips.push(single)
      const values = obj?.['values']
      if (Array.isArray(values)) {
        for (const v of values) {
          if (typeof v === 'string' && /^[\d.:a-fA-F]+$/.test(v)) ips.push(v)
        }
      }
      for (const ip of ips) {
        if (isPrivateOrLoopbackIp(ip)) continue
        out.push({ input: simpleInput('ip_address', ip), viaPredicate: claim.predicate, key: makeKey('ip_address', ip), confidence: claim.confidence })
      }
      break
    }

    case 'username_presence':
    case 'social_profile': {
      const username = firstString(obj, ['username', 'preferredUsername'])
      if (!username) break
      out.push({ input: simpleInput('username', username), viaPredicate: claim.predicate, key: makeKey('username', username), confidence: claim.confidence })
      break
    }

    case 'vehicle_registration': {
      const vin = firstString(obj, ['vin'])
      if (vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
        out.push({ input: simpleInput('vin', vin), viaPredicate: claim.predicate, key: makeKey('vin', vin), confidence: claim.confidence })
      }
      const plate = firstString(obj, ['plate', 'plateNumber', 'licensePlate'])
      const plateState = firstString(obj, ['plateState', 'registrationState', 'state'])
      if (plate) {
        out.push({
          input: simpleInput('license_plate', plate, plateState && plateState.length === 2 ? plateState.toUpperCase() : undefined),
          viaPredicate: claim.predicate,
          key: makeKey('license_plate', plate),
          confidence: claim.confidence,
        })
      }
      break
    }

    case 'court_case':
    case 'criminal_charge':
    case 'case_disposition':
    case 'civil_judgment':
    case 'bankruptcy_filing': {
      const docket = firstString(obj, ['docketNumber', 'caseNumber'])
      if (!docket) break // CourtListener frequently returns docketNumber: null — skip, don't spawn a search for "null"
      out.push({ input: simpleInput('docket_number', docket), viaPredicate: claim.predicate, key: makeKey('docket_number', docket), confidence: claim.confidence })
      break
    }

    case 'full_name': {
      if (claim.confidence < 0.75) break
      const name = coerceClaimString('full_name', claim.value)
      if (!name) break
      out.push({
        input: { type: 'person_name', fullName: name } as SearchInput,
        viaPredicate: claim.predicate,
        key: makeKey('person_name', name),
        confidence: claim.confidence,
      })
      break
    }

    case 'jurisdiction_fips': {
      // Re-scoping, not expansion: narrows a later address/portal search to
      // the county/state this address already resolved to — the origin's own
      // raw address text is reused, only the hints are added/tightened.
      const usps = stateNameToUsps(firstString(obj, ['stateName']))
      const county = firstString(obj, ['countyName'])
      if (!usps && !county) break
      const rawAddress = origin.type === 'address' ? origin.raw : firstString(obj, ['placeName'])
      if (!rawAddress) break
      out.push({
        input: { type: 'address', raw: rawAddress, stateHint: usps ?? undefined, countyHint: county ?? undefined } as SearchInput,
        viaPredicate: claim.predicate,
        key: makeKey('address', `${rawAddress}|${usps ?? ''}|${county ?? ''}`),
        confidence: claim.confidence,
      })
      break
    }

    default:
      break
  }

  // A claim never derives an input identical to the search that produced it.
  // (The broader cross-claim/cross-run loop guard lives in pivot-budget.ts's
  // `seen` set, seeded with this same key shape.)
  const originKey = keyForInput(origin)
  return out.filter((d) => d.key !== originKey).map((d) => ({ ...d, viaClaimId: claim.id }))
}
