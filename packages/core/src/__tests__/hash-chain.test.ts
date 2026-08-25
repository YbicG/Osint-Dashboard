import { describe, it, expect } from 'vitest'
import { canonicalize } from '../audit/hash-chain'

describe('canonicalize', () => {
  it('produces identical output for objects with nested keys in different insertion order', () => {
    // This is the actual defect: the old implementation used
    // `JSON.stringify(obj, Object.keys(obj).sort())` — a *replacer array*,
    // which only orders top-level properties. A nested `metadata` object
    // built with keys in a different order hashed differently even though
    // it's logically the same audit entry.
    const a = { metadata: { userId: '1', action: 'x', nested: { b: 2, a: 1 } } }
    const b = { metadata: { action: 'x', userId: '1', nested: { a: 1, b: 2 } } }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalize({ v: [1, 2, 3] })).not.toBe(canonicalize({ v: [3, 2, 1] }))
  })

  it('rejects undefined at the top level', () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError)
  })

  it('omits (rather than throws on) undefined nested values, but still differs from a present null', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }))
    expect(canonicalize({ a: null, b: 1 })).not.toBe(canonicalize({ b: 1 }))
  })

  it('is deterministic across repeated calls', () => {
    const obj = { z: 1, a: 2, m: { y: 1, x: 2 } }
    expect(canonicalize(obj)).toBe(canonicalize(obj))
  })
})
