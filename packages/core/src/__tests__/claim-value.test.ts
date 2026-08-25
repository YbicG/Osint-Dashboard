import { describe, it, expect } from 'vitest'
import { coerceClaimString } from '../normalize/claim-value'

describe('coerceClaimString', () => {
  it('passes through a plain string value unchanged', () => {
    expect(coerceClaimString('full_name', 'Jane Doe')).toBe('Jane Doe')
  })

  it('stringifies numbers and booleans', () => {
    expect(coerceClaimString('some_predicate', 42)).toBe('42')
    expect(coerceClaimString('some_predicate', true)).toBe('true')
  })

  it('extracts the known key for an object-shaped address claim', () => {
    expect(coerceClaimString('current_address', { matchedAddress: '123 Main St, Austin, TX 78701', street: '123 Main St' })).toBe(
      '123 Main St, Austin, TX 78701',
    )
  })

  it('extracts the known key for an object-shaped username_presence claim', () => {
    expect(coerceClaimString('username_presence', { platform: 'github.com', username: 'janedoe' })).toBe('janedoe')
  })

  it('returns null for an object with none of the expected keys — the precision-bug fix', () => {
    // This is the exact failure mode from the original bug: `value as
    // string` on an unrecognized object used to silently become the
    // literal string "[object Object]" once passed through further string
    // handling. Returning null instead means callers can filter it out
    // instead of treating a stringified type name as real data.
    expect(coerceClaimString('current_address', { unexpectedShape: 'oops' })).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(coerceClaimString('full_name', '')).toBeNull()
  })

  it('falls back to the default key list for an unrecognized predicate', () => {
    expect(coerceClaimString('some_new_predicate', { value: 'fallback-hit' })).toBe('fallback-hit')
  })
})
