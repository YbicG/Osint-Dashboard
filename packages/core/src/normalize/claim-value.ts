/**
 * Extracts a single display/comparison string out of a claim's jsonb
 * `value` column, which is `string | number | boolean | Record<string,
 * unknown>` depending on which connector produced it (see connectors'
 * `DraftClaim.value`). Predicate-aware: known predicates check a small
 * ordered list of the actual key names connectors use today (e.g.
 * census-geocoder's `matchedAddress`, gravatar's `username`) — an unknown
 * shape returns `null` rather than guessing.
 *
 * This replaces the precision bug in the original `post-collection-
 * resolve.ts`: `claims.find(...)?.value as string` on a jsonb column that
 * actually holds an object silently produced the literal string
 * `"[object Object]"` after normalization, which happily "matched" every
 * other person whose address claim happened to also be an unparsed object.
 */
export function coerceClaimString(predicate: string, value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of OBJECT_VALUE_KEYS[predicate] ?? DEFAULT_OBJECT_VALUE_KEYS) {
      const v = obj[key]
      if (typeof v === 'string' && v.length > 0) return v
    }
  }
  return null
}

/** Ordered candidate key names, most-specific first, per predicate. */
const OBJECT_VALUE_KEYS: Record<string, string[]> = {
  current_address: ['matchedAddress', 'full', 'raw', 'address'],
  former_address: ['matchedAddress', 'full', 'raw', 'address'],
  phone_number: ['e164', 'value', 'number', 'phone'],
  email_address: ['value', 'email', 'address'],
  username_presence: ['username'],
  full_name: ['fullName', 'value', 'name'],
  date_of_birth: ['value', 'date', 'dob'],
  relative_of: ['relatedEntityLabel', 'name', 'value'],
}

/** Fallback list tried for a predicate with no entry above — covers the common shapes without pretending to know every connector's exact field name. */
const DEFAULT_OBJECT_VALUE_KEYS = ['value', 'label', 'name']
