import type { DerivedInput } from '@osint/connectors/pivot'

/**
 * Four independent guards against an auto-pivot run blowing up, per the M3
 * plan section "Pivot engine". This module is deliberately pure — no DB, no
 * network — so every guard is a plain unit test. The two guards that need
 * durable state across processes (`connector_budget_used`, a 24h duplicate
 * check against completed searches) are enforced by the *caller*
 * (apps/worker/src/ingest/run-search.ts) pre-seeding `PivotBudgetState`
 * before calling `evaluateCandidate`, not by this module reaching into a
 * database itself.
 */

export interface PivotBudgetLimits {
  /** Only spawn children from depth-0 (root) searches. Kept as a parameter so depth 2 is a config change, but ship at 1 — see plan. */
  maxDepth: number
  /** A durable ceiling on total connector runs across the whole pivot tree, enforced by the caller as a single-statement CAS against search_request.connector_budget_used. */
  maxConnectorRuns: number
  /** The address-explosion guard: at most this many derived searches of the same SearchInputType per parent search. */
  maxPerPredicate: number
}

export const DEFAULT_PIVOT_BUDGET_LIMITS: PivotBudgetLimits = {
  maxDepth: 1,
  maxConnectorRuns: 120,
  maxPerPredicate: 3,
}

export interface PivotBudgetState {
  /**
   * Normalized keys already searched or queued — loop prevention. A Set, not
   * a counter: the same identifier can legitimately be derived from three
   * different predicates and must still only run once. Seed with the
   * origin's own key AND, per the plan, any key with a completed search
   * within the last 24h (a duplicate-search dedup check the caller performs
   * against the DB before construction).
   */
  seen: Set<string>
  /** Connector runs already committed for this pivot tree (durable — read from search_request.connector_budget_used by the caller). */
  connectorRunsUsed: number
  /** Derived-input count so far, keyed by the derived SearchInput's own type. */
  perTypeCount: Map<string, number>
}

export function createPivotBudgetState(seedKeys: Iterable<string>, connectorRunsUsed = 0): PivotBudgetState {
  return {
    seen: new Set(seedKeys),
    connectorRunsUsed,
    perTypeCount: new Map(),
  }
}

export type PivotRejectionReason =
  | 'max_depth'
  | 'duplicate'
  | 'predicate_capped'
  | 'connector_budget_exhausted'

export interface PivotDecision {
  candidate: DerivedInput
  accepted: boolean
  reason?: PivotRejectionReason
}

/**
 * Evaluate one derived candidate against the budget, mutating `state` if
 * accepted. Call once per candidate, in order — order matters for
 * `maxPerPredicate` (first 3 win, not "best 3"; callers wanting best-3
 * should sort candidates by confidence before calling).
 *
 * `estimatedConnectorRuns` is the number of connector runs this child search
 * would actually consume (i.e. how many enabled connectors accept its
 * input type) — supplied by the caller, which has the registry; this module
 * stays connector-registry-agnostic on purpose.
 */
export function evaluateCandidate(
  candidate: DerivedInput,
  state: PivotBudgetState,
  currentDepth: number,
  estimatedConnectorRuns: number,
  limits: PivotBudgetLimits = DEFAULT_PIVOT_BUDGET_LIMITS,
): PivotDecision {
  if (currentDepth >= limits.maxDepth) {
    return { candidate, accepted: false, reason: 'max_depth' }
  }
  if (state.seen.has(candidate.key)) {
    return { candidate, accepted: false, reason: 'duplicate' }
  }
  const typeCount = state.perTypeCount.get(candidate.input.type) ?? 0
  if (typeCount >= limits.maxPerPredicate) {
    return { candidate, accepted: false, reason: 'predicate_capped' }
  }
  if (state.connectorRunsUsed + estimatedConnectorRuns > limits.maxConnectorRuns) {
    return { candidate, accepted: false, reason: 'connector_budget_exhausted' }
  }

  state.seen.add(candidate.key)
  state.perTypeCount.set(candidate.input.type, typeCount + 1)
  state.connectorRunsUsed += estimatedConnectorRuns
  return { candidate, accepted: true }
}

/** Aggregate a batch of decisions into the counts a `pivot_summary` event reports — rejections must be surfaced, never silently dropped. */
export interface PivotSummary {
  derived: number
  accepted: number
  rejectedByReason: Record<PivotRejectionReason, number>
}

export function summarizeDecisions(decisions: PivotDecision[]): PivotSummary {
  const rejectedByReason: Record<PivotRejectionReason, number> = {
    max_depth: 0,
    duplicate: 0,
    predicate_capped: 0,
    connector_budget_exhausted: 0,
  }
  let accepted = 0
  for (const d of decisions) {
    if (d.accepted) accepted++
    else rejectedByReason[d.reason!]++
  }
  return { derived: decisions.length, accepted, rejectedByReason }
}
