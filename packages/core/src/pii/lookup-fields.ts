/**
 * Maps a CSV file's headers onto a small set of canonical, structured
 * "lookup fields" (ssn, name, dob, phone, ...) so apps/worker/src/csv/index-file.ts
 * can extract and normalize them into packages/db/src/schema/csv-search.ts's
 * typed csv_record columns at index time. This is the structured-search
 * counterpart to sensitive-columns.ts's masking detection — same
 * normalize-the-header-then-match approach, different purpose (which values
 * to pull out and index, not which to hide).
 *
 * Matching is exact-equality on the normalized header, not a loose regex:
 * for `dob` specifically, a loose "contains dob" pattern (which
 * sensitive-columns.ts deliberately DOES use, for masking) would also catch
 * alternate-DOB columns like "alt1DOB" and pick one arbitrarily as THE dob
 * lookup field. Exact alias lists avoid that.
 */
import { normalizeHeader } from './sensitive-columns'

export const LOOKUP_FIELDS = ['ssn', 'firstName', 'lastName', 'dob', 'phone', 'zip', 'city', 'state', 'address'] as const
export type LookupField = (typeof LOOKUP_FIELDS)[number]

const LOOKUP_FIELD_ALIASES: Record<LookupField, string[]> = {
  ssn: ['ssn', 'social_security_number', 'social_security_no', 'ssn_number', 'socialsecuritynumber'],
  firstName: ['firstname', 'first_name', 'fname', 'given_name', 'givenname'],
  lastName: ['lastname', 'last_name', 'lname', 'surname', 'family_name', 'familyname'],
  dob: ['dob', 'date_of_birth', 'birth_date', 'birthdate', 'dateofbirth'],
  phone: ['phone', 'phone1', 'phone_number', 'phonenumber', 'telephone', 'mobile', 'mobile_phone', 'cell_phone', 'cellphone'],
  zip: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postalcode'],
  city: ['city'],
  state: ['state', 'st'],
  address: ['address', 'address1', 'street_address', 'streetaddress', 'addr'],
}

/**
 * Returns, for each canonical field found, the ORIGINAL (unnormalized)
 * header name to read that field's value from — so callers can look values
 * up in a `Record<string, string | null>` row keyed by real headers.
 * First matching header wins per field; a field with no matching header is
 * simply absent from the result (that row's column for it stays null).
 */
export function detectLookupFieldMapping(headers: string[]): Partial<Record<LookupField, string>> {
  const mapping: Partial<Record<LookupField, string>> = {}
  for (const header of headers) {
    const normalized = normalizeHeader(header)
    for (const field of LOOKUP_FIELDS) {
      if (mapping[field]) continue
      if (LOOKUP_FIELD_ALIASES[field].includes(normalized)) {
        mapping[field] = header
      }
    }
  }
  return mapping
}

/** MM/DD/YYYY or M/D/YYYY -> YYYY-MM-DD (sortable, prefix-by-year-searchable). Anything else is left as-is, lowercased, so it's still searchable exactly, just not guaranteed prefix-friendly. */
function normalizeDob(raw: string): string {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match && match[1] && match[2] && match[3]) {
    const [, m, d, y] = match
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return raw.toLowerCase()
}

/**
 * Normalizes one extracted value for storage/matching, per field type:
 * digits-only for identifiers that are conventionally written with
 * separators (ssn, phone, zip -- a "555-12-1234" source value and a
 * "555121234" one should match the same query), lowercased/trimmed for
 * free-text fields (names/city/state/address), and date-normalized for dob.
 * Returns null for missing/empty input so absent data stays NULL rather
 * than becoming an empty-string false match.
 */
export function normalizeLookupValue(field: LookupField, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  switch (field) {
    case 'ssn':
    case 'phone':
      return trimmed.replace(/\D/g, '') || null
    case 'zip':
      return trimmed.replace(/[^0-9A-Za-z-]/g, '') || null
    case 'dob':
      return normalizeDob(trimmed)
    case 'firstName':
    case 'lastName':
    case 'city':
    case 'state':
    case 'address':
      return trimmed.toLowerCase()
  }
}
