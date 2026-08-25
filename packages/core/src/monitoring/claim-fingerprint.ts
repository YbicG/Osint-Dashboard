import { coerceClaimString } from '../normalize/claim-value'

/**
 * A stable fingerprint of "what a claim actually asserts," used for
 * diffing across collection runs (see apps/worker's monitoring tick, M9) and
 * for collapsing visually-identical claim variants in the UI. Deliberately
 * NOT used to suppress inserts — "source S still asserted this on date D"
 * is evidentiarily meaningful on its own, so a repeat observation always
 * gets its own claim row. This is purely a derived comparison key.
 *
 * Predicate-aware and whitelist-based rather than hashing the whole value
 * object: an embedded retrieval timestamp, request id, or other incidental
 * field must not make two logically-identical observations fingerprint
 * differently, which a naive "hash the whole JSON blob" approach would do.
 */
export function computeValueFingerprint(predicate: string, value: unknown): string {
  const whitelist = FINGERPRINT_KEYS[predicate]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalize(String(value))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (whitelist) {
      const parts = whitelist.map((key) => `${key}=${normalize(stringifyField(obj[key]))}`)
      return parts.join('|')
    }
    // No whitelist for this predicate: fall back to the same coercion used
    // for display, which is at least deterministic and ignores unrelated
    // incidental fields we don't recognize.
    const coerced = coerceClaimString(predicate, value)
    if (coerced !== null) return normalize(coerced)
  }
  // Last resort — stable but coarse; better than throwing.
  return normalize(JSON.stringify(value))
}

function stringifyField(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/** Which fields of a predicate's object value are semantically part of "what changed" — everything else (timestamps, request metadata, source-internal ids) is ignored. */
const FINGERPRINT_KEYS: Record<string, string[]> = {
  current_address: ['matchedAddress'],
  former_address: ['matchedAddress'],
  phone_number: ['e164'],
  email_address: ['value'],
  username_presence: ['platform', 'username', 'site'],
  social_profile: ['platform', 'url', 'username'],
  jurisdiction_fips: ['stateFips', 'countyFips', 'tractGeoid'],
  traffic_citation: ['summonsNumber'],
  crypto_balance: ['address', 'balance'],
}
