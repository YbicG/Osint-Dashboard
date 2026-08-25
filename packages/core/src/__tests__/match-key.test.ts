import { describe, it, expect } from 'vitest'
import { computeMatchKey } from '../normalize/match-key'

describe('computeMatchKey', () => {
  it('returns null for person and organization — never deduped by value alone', () => {
    expect(computeMatchKey('person', 'John Smith')).toBeNull()
    expect(computeMatchKey('organization', 'Acme Corp')).toBeNull()
  })

  it('normalizes addresses with the same normalizer used everywhere else addresses are compared', () => {
    // This is the actual defect being closed: previously,
    // resolve-subject.ts computed the input side with normalizeAddress()
    // but compared it against normalizeForMatch(displayLabel) on the
    // stored side — two different functions that disagree on real
    // addresses (street-suffix abbreviation), so every address search
    // minted a duplicate entity. computeMatchKey is now the only function
    // either side may call.
    const a = computeMatchKey('address', '123 Main Street, Austin, TX')
    const b = computeMatchKey('address', '123 main st austin tx')
    expect(a).toBe(b)
  })

  it('normalizes identifier types case- and punctuation-insensitively', () => {
    expect(computeMatchKey('email', 'John.Doe@Example.com')).toBe(computeMatchKey('email', 'johndoeexamplecom'))
  })

  it('produces distinct keys for distinct values of the same type', () => {
    expect(computeMatchKey('phone', '+15125550100')).not.toBe(computeMatchKey('phone', '+15125550199'))
  })
})
