import { describe, it, expect } from 'vitest'
import { computeValueFingerprint } from '../monitoring/claim-fingerprint'

describe('computeValueFingerprint', () => {
  it('is stable across insertion order of the whitelisted keys', () => {
    const a = computeValueFingerprint('username_presence', { platform: 'github.com', username: 'janedoe', site: 'GitHub' })
    const b = computeValueFingerprint('username_presence', { site: 'GitHub', username: 'janedoe', platform: 'github.com' })
    expect(a).toBe(b)
  })

  it('ignores fields outside the whitelist — an incidental retrieval timestamp must not change the fingerprint', () => {
    const a = computeValueFingerprint('current_address', { matchedAddress: '123 Main St', retrievedAt: '2026-01-01T00:00:00Z' })
    const b = computeValueFingerprint('current_address', { matchedAddress: '123 Main St', retrievedAt: '2026-06-01T00:00:00Z' })
    expect(a).toBe(b)
  })

  it('changes when a whitelisted field actually differs', () => {
    const a = computeValueFingerprint('current_address', { matchedAddress: '123 Main St' })
    const b = computeValueFingerprint('current_address', { matchedAddress: '456 Oak Ave' })
    expect(a).not.toBe(b)
  })

  it('is case- and whitespace-insensitive', () => {
    const a = computeValueFingerprint('email_address', { value: '  Jane@Example.com ' })
    const b = computeValueFingerprint('email_address', { value: 'jane@example.com' })
    expect(a).toBe(b)
  })

  it('falls back to coerceClaimString for a predicate with no whitelist entry', () => {
    const a = computeValueFingerprint('username_presence_unlisted', { username: 'someone' })
    // No whitelist for this made-up predicate — coerceClaimString's default
    // key fallback list doesn't include "username", so this should fall
    // all the way through to the JSON.stringify last resort, which is at
    // least deterministic for a fixed key order.
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('scalar values fingerprint directly', () => {
    expect(computeValueFingerprint('some_predicate', 'Hello')).toBe('hello')
    expect(computeValueFingerprint('some_predicate', 42)).toBe('42')
  })
})
