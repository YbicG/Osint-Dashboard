import { describe, it, expect } from 'vitest'
import {
  createPivotBudgetState,
  evaluateCandidate,
  summarizeDecisions,
  DEFAULT_PIVOT_BUDGET_LIMITS,
  type PivotBudgetState,
} from '../pivot-budget'
import type { DerivedInput } from '@osint/connectors/pivot'

function derived(type: string, value: string, key = `${type}:${value}`): DerivedInput {
  return {
    input: { type, value } as unknown as DerivedInput['input'],
    viaPredicate: 'email_address',
    viaClaimId: 'c0000000-0000-0000-0000-000000000000',
    key,
    confidence: 0.8,
  }
}

describe('evaluateCandidate', () => {
  it('accepts a fresh candidate within budget and records it in state', () => {
    const state = createPivotBudgetState(['person_name:jane public'])
    const decision = evaluateCandidate(derived('email', 'jane@example.com'), state, 0, 3)
    expect(decision.accepted).toBe(true)
    expect(state.seen.has('email:jane@example.com')).toBe(true)
    expect(state.connectorRunsUsed).toBe(3)
    expect(state.perTypeCount.get('email')).toBe(1)
  })

  it('rejects a candidate at or beyond maxDepth (only wave-0 searches spawn children)', () => {
    const state = createPivotBudgetState([])
    const decision = evaluateCandidate(derived('email', 'jane@example.com'), state, 1, 1)
    expect(decision).toEqual({ candidate: expect.anything(), accepted: false, reason: 'max_depth' })
  })

  it('rejects a duplicate key already in the seen set (loop prevention)', () => {
    const state = createPivotBudgetState(['email:jane@example.com'])
    const decision = evaluateCandidate(derived('email', 'jane@example.com'), state, 0, 1)
    expect(decision.accepted).toBe(false)
    expect(decision.reason).toBe('duplicate')
  })

  it('the same identifier derived twice (e.g. from two predicates) only ever runs once', () => {
    const state = createPivotBudgetState([])
    const first = evaluateCandidate(derived('email', 'jane@example.com'), state, 0, 1)
    const second = evaluateCandidate(derived('email', 'jane@example.com'), state, 0, 1)
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('duplicate')
  })

  it('caps at maxPerPredicate per derived input type — the address-explosion guard', () => {
    const state = createPivotBudgetState([])
    const decisions = Array.from({ length: 50 }, (_, i) => evaluateCandidate(derived('address', `${i} Main St`), state, 0, 1))
    const summary = summarizeDecisions(decisions)
    expect(summary.accepted).toBe(3)
    expect(summary.rejectedByReason.predicate_capped).toBe(47)
  })

  it('first-N-win ordering: the cap keeps the first candidates evaluated, not the "best" ones', () => {
    const state = createPivotBudgetState([])
    const results = ['a', 'b', 'c', 'd'].map((v) => evaluateCandidate(derived('address', v), state, 0, 1, { ...DEFAULT_PIVOT_BUDGET_LIMITS, maxPerPredicate: 2 }))
    expect(results.map((r) => r.accepted)).toEqual([true, true, false, false])
  })

  it('rejects once the durable connector-run ceiling would be exceeded', () => {
    const state = createPivotBudgetState([], 118)
    const decision = evaluateCandidate(derived('domain', 'example.com'), state, 0, 5)
    expect(decision.accepted).toBe(false)
    expect(decision.reason).toBe('connector_budget_exhausted')
    // rejection must not mutate state — a rejected candidate consumes no budget
    expect(state.connectorRunsUsed).toBe(118)
  })

  it('accepts exactly up to the connector-run ceiling, not past it', () => {
    const state = createPivotBudgetState([], 115)
    const decision = evaluateCandidate(derived('domain', 'example.com'), state, 0, 5)
    expect(decision.accepted).toBe(true)
    expect(state.connectorRunsUsed).toBe(120)
  })

  it('independent guards: exhausting one guard does not affect another candidate type', () => {
    const state = createPivotBudgetState([])
    for (let i = 0; i < 3; i++) evaluateCandidate(derived('address', `${i} Main St`), state, 0, 1)
    const addressRejected = evaluateCandidate(derived('address', 'overflow'), state, 0, 1)
    const domainAccepted = evaluateCandidate(derived('domain', 'example.com'), state, 0, 1)
    expect(addressRejected.accepted).toBe(false)
    expect(domainAccepted.accepted).toBe(true)
  })
})

describe('summarizeDecisions', () => {
  it('reports rejections by reason so a pivot_summary event never silently drops counts', () => {
    const state: PivotBudgetState = createPivotBudgetState(['email:seen@example.com'])
    const decisions = [
      evaluateCandidate(derived('email', 'seen@example.com'), state, 0, 1), // duplicate
      evaluateCandidate(derived('domain', 'example.com'), state, 1, 1), // max_depth
      evaluateCandidate(derived('phone_e164', '+15125550134'), state, 0, 1), // accepted
    ]
    const summary = summarizeDecisions(decisions)
    expect(summary).toEqual({
      derived: 3,
      accepted: 1,
      rejectedByReason: { max_depth: 1, duplicate: 1, predicate_capped: 0, connector_budget_exhausted: 0 },
    })
  })
})
