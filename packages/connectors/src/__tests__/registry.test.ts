import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Predicate, SEARCHABLE_INPUT_TYPES } from '@osint/contracts'
import { CONNECTOR_REGISTRY, planConnectors } from '../registry/index'

const PREDICATE_SET = new Set<string>(Predicate.options)

/**
 * Types the coverage assertion below does not (yet) expect any connector
 * for. Every entry here is a milestone away from being deleted, not a
 * permanent exemption — deleting an entry with no corresponding connector
 * addition is exactly the "shrink the allow-list" motion described in
 * docs/PLAN.md's M2 verification section.
 */
const EXPECTED_ZERO_COVERAGE: Set<string> = new Set([])

const envExample = readFileSync(
  fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
  'utf-8',
)
const ENV_EXAMPLE_VARS = new Set(
  Array.from(envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)).map((m) => m[1]),
)

describe('CONNECTOR_REGISTRY', () => {
  it('has unique, correctly-shaped connector ids', () => {
    const ids = CONNECTOR_REGISTRY.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/)
    }
  })

  it('only emits predicates that exist in the Predicate enum', () => {
    for (const c of CONNECTOR_REGISTRY) {
      for (const p of c.emits) {
        expect(PREDICATE_SET.has(p), `${c.id} declares emits "${p}", not a real Predicate`).toBe(true)
      }
    }
  })

  it('every requiresApiKey env var is documented in .env.example, and vice versa for connector-declared vars', () => {
    const declaredVars = new Set(
      CONNECTOR_REGISTRY.map((c) => c.requiresApiKey).filter((v): v is string => v !== null),
    )
    for (const v of declaredVars) {
      expect(ENV_EXAMPLE_VARS.has(v), `${v} is required by a connector but missing from .env.example`).toBe(true)
    }
  })

  it('has at least one enabled connector for every searchable input type not in the allow-list', () => {
    for (const type of SEARCHABLE_INPUT_TYPES) {
      if (EXPECTED_ZERO_COVERAGE.has(type)) continue
      const coverage = CONNECTOR_REGISTRY.filter((c) => c.enabledByDefault && c.accepts.includes(type))
      expect(coverage.length, `no enabled connector accepts "${type}"`).toBeGreaterThan(0)
    }
  })

  it('keeps per-connector rate limits conservative unless explicitly justified', () => {
    const ALLOW_HIGH_RATE = new Set(['federal.nhtsa_vin']) // e.g. a fully public, high-throughput federal API
    for (const c of CONNECTOR_REGISTRY) {
      if (ALLOW_HIGH_RATE.has(c.id)) continue
      expect(c.rateLimitPerMinute, `${c.id} sets an unusually high rateLimitPerMinute`).toBeLessThanOrEqual(120)
    }
  })

  it('requires a tosNote whenever robotsPolicy is overridden', () => {
    for (const c of CONNECTOR_REGISTRY) {
      if (c.robotsPolicy === 'override') {
        expect(c.tosNote, `${c.id} overrides robots policy but has no tosNote`).not.toBeNull()
      }
    }
  })
})

describe('planConnectors', () => {
  it('only returns connectors whose accepts includes the input type', () => {
    const plan = planConnectors({ type: 'domain', value: 'example.com' })
    expect(plan.length).toBeGreaterThan(0)
    expect(plan.every((c) => c.accepts.includes('domain'))).toBe(true)
  })

  it('excludes disabled-by-default connectors unless includeDisabled is set', () => {
    const withoutDisabled = planConnectors({ type: 'license_plate', value: 'ABC1234' })
    expect(withoutDisabled.some((c) => c.id === 'licensed_vendor.plate_lookup')).toBe(false)

    const withDisabled = planConnectors({ type: 'license_plate', value: 'ABC1234' }, { includeDisabled: true })
    expect(withDisabled.some((c) => c.id === 'licensed_vendor.plate_lookup')).toBe(true)
  })

  it('returns an empty plan for an input type nothing in the registry accepts', () => {
    // image_face is intentionally its own workflow, not fanned out to the
    // general connector registry (see docs/PLAN.md's scope correction).
    const plan = planConnectors({ type: 'image_face', imageSha256: 'a'.repeat(64) })
    expect(plan).toEqual([])
  })
})
