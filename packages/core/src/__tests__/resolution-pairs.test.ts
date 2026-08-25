import { describe, it, expect } from 'vitest'
import { scorePersonMatch, type ResolutionFeatureSet } from '../resolution/score'
import fixtures from './fixtures/resolution-pairs.json'

interface Fixture {
  id: string
  label: 'same' | 'different'
  note: string
  features: ResolutionFeatureSet
}

const PAIRS = fixtures as Fixture[]

/**
 * Labeled entity-resolution pairs, scored against packages/core's
 * scorePersonMatch and checked against the confusion-matrix thresholds the
 * plan calls for. This is a starting corpus (22 pairs — 12 same-person, 10
 * different-person adversarial), not the eventual 150–300-pair target the
 * plan describes; each fixture carries a `note` documenting why it's in
 * the set (provenance/adversarial category) so the corpus can grow without
 * losing that context. What's non-negotiable regardless of corpus size:
 * zero false auto_merge on a labeled-different pair.
 */
describe('entity resolution — labeled pair fixtures', () => {
  const scored = PAIRS.map((p) => ({ ...p, result: scorePersonMatch(p.features) }))

  it('never auto-merges a labeled-different pair (hard zero — the one non-negotiable threshold)', () => {
    const falseAutoMerges = scored.filter((p) => p.label === 'different' && p.result.decision === 'auto_merge')
    if (falseAutoMerges.length > 0) {
      throw new Error(
        `False auto_merge on labeled-different pairs: ${falseAutoMerges.map((p) => `${p.id} (score=${p.result.score})`).join(', ')}`,
      )
    }
    expect(falseAutoMerges).toHaveLength(0)
  })

  it('auto_merge precision >= 0.98 (of everything the scorer auto-merges, almost all must actually be the same person)', () => {
    const autoMerged = scored.filter((p) => p.result.decision === 'auto_merge')
    const correct = autoMerged.filter((p) => p.label === 'same')
    const precision = autoMerged.length === 0 ? 1 : correct.length / autoMerged.length
    expect(precision).toBeGreaterThanOrEqual(0.98)
  })

  it('same-pair recall at auto_merge >= 0.60 (deliberately not higher — the needs_review queue is expected to catch the rest)', () => {
    const samePairs = scored.filter((p) => p.label === 'same')
    const autoMergedSame = samePairs.filter((p) => p.result.decision === 'auto_merge')
    const recall = autoMergedSame.length / samePairs.length
    expect(recall).toBeGreaterThanOrEqual(0.6)
  })

  it('no labeled-same pair is rejected outright — every real match should reach at least needs_review', () => {
    const rejectedSame = scored.filter((p) => p.label === 'same' && p.result.decision === 'reject')
    if (rejectedSame.length > 0) {
      throw new Error(`Labeled-same pairs scored as reject: ${rejectedSame.map((p) => p.id).join(', ')}`)
    }
    expect(rejectedSame).toHaveLength(0)
  })

  it.each(PAIRS.map((p) => [p.id, p] as const))('%s: decision is never auto_merge when labeled different', (_id, p) => {
    const result = scorePersonMatch(p.features)
    if (p.label === 'different') expect(result.decision).not.toBe('auto_merge')
  })
})

describe('scorePersonMatch — monotonicity properties', () => {
  const base: ResolutionFeatureSet = { nameA: 'Alex Turner', nameB: 'Alex Turner', dobA: '1992-01-01', dobB: '1992-01-01' }

  it('adding a shared phone never lowers the score', () => {
    const before = scorePersonMatch(base)
    const after = scorePersonMatch({ ...base, phonesA: ['+15125550199'], phonesB: ['+15125550199'] })
    expect(after.score).toBeGreaterThanOrEqual(before.score)
  })

  it('adding a shared email never lowers the score', () => {
    const before = scorePersonMatch(base)
    const after = scorePersonMatch({ ...base, emailsA: ['a@example.com'], emailsB: ['a@example.com'] })
    expect(after.score).toBeGreaterThanOrEqual(before.score)
  })

  it('adding a shared address never lowers the score', () => {
    const before = scorePersonMatch(base)
    const after = scorePersonMatch({ ...base, addressesA: ['1 A St, Town, ST'], addressesB: ['1 A St, Town, ST'] })
    expect(after.score).toBeGreaterThanOrEqual(before.score)
  })

  it('adding a shared relative never lowers the score', () => {
    const before = scorePersonMatch(base)
    const after = scorePersonMatch({ ...base, relativeNamesA: ['Jamie Turner'], relativeNamesB: ['Jamie Turner'] })
    expect(after.score).toBeGreaterThanOrEqual(before.score)
  })

  it('a non-overlapping phone on each side never raises the score', () => {
    const before = scorePersonMatch(base)
    const after = scorePersonMatch({ ...base, phonesA: ['+15125550100'], phonesB: ['+15125550200'] })
    expect(after.score).toBe(before.score)
  })
})
