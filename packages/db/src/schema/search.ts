import { pgTable, uuid, text, timestamp, jsonb, integer, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { appUser } from './org'
import { caseTable } from './case'
import { entity } from './entity'

/**
 * Where a search came from — one consistent story across every unattended
 * path (auto-pivot, manual expand, monitoring), per the M3 plan's
 * reconciliation section. Not a pg enum: kept as `text` for the same reason
 * `inputType` is, and validated at the Zod layer (see
 * packages/contracts/src/search.ts's SearchRequest.origin).
 */
export type SearchOrigin = 'user' | 'auto_pivot' | 'manual_expand' | 'monitoring'

export const searchRequest = pgTable('search_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => caseTable.id),
  subjectEntityId: uuid('subject_entity_id').references(() => entity.id),
  inputType: text('input_type').notNull(),
  inputPayload: jsonb('input_payload').notNull(),
  purposeCode: text('purpose_code').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // --- Pivot engine provenance (M3) ---
  /** Direct parent in the pivot tree; null for a root (user-initiated) search. */
  parentSearchId: uuid('parent_search_id').references((): AnyPgColumn => searchRequest.id),
  /** The tree's root search — denormalized off parentSearchId so "give me everything under this investigation" is one index seek, not a recursive CTE. Equals `id` for a root search. */
  rootSearchId: uuid('root_search_id').references((): AnyPgColumn => searchRequest.id),
  /** 0 for a root search; 1 for its direct pivot children. Ships capped at 1 — see pivot-budget.ts's maxDepth. */
  pivotDepth: integer('pivot_depth').notNull().default(0),
  origin: text('origin', { enum: ['user', 'auto_pivot', 'manual_expand', 'monitoring'] }).notNull().default('user'),
  /**
   * The evidentiary payload: "this search exists because claim X asserted
   * phone Y." Null for a root search. Deliberately NOT a DB-level FK to
   * claim.id — claim.ts imports source.ts (for the collectionRun FK), and
   * source.ts already imports this file (searchRequest is collection_run's
   * search_id target), so a real FK here would close
   * search -> claim -> source -> search into a require cycle TypeScript
   * can't infer through without every table in the loop losing type
   * inference. Enforced at the application layer instead (see
   * apps/worker/src/ingest/run-search.ts, which only ever writes a real
   * existing claim id here).
   */
  derivedFromClaimId: uuid('derived_from_claim_id'),
  /** Durable connector-run ceiling for this pivot tree, read/written by pivot-budget.ts's single-statement CAS. Only meaningful on the root row. */
  connectorBudget: integer('connector_budget').notNull().default(120),
  connectorBudgetUsed: integer('connector_budget_used').notNull().default(0),
}, (t) => [
  index('search_request_root_idx').on(t.rootSearchId),
  index('search_request_parent_idx').on(t.parentSearchId),
])
