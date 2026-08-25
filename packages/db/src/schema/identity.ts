import { pgTable, uuid, timestamp, real, index, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { clusterStatusEnum } from './enums'
import { entity } from './entity'
import { appUser } from './org'

export const identityCluster = pgTable('identity_cluster', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: clusterStatusEnum('status').notNull().default('needs_review'),
  cohesionScore: real('cohesion_score').notNull(),
  // NOTE: no FK constraint here (would create a hard circular FK with `entity`).
  // primaryEntityId is validated at the application layer instead.
  primaryEntityId: uuid('primary_entity_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => appUser.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
})

/** Audit trail of every automatic and manual merge/split decision. */
export const mergeDecision = pgTable('merge_decision', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityAId: uuid('entity_a_id').notNull().references(() => entity.id),
  entityBId: uuid('entity_b_id').notNull().references(() => entity.id),
  action: text('action', { enum: ['merge', 'split'] }).notNull(),
  score: real('score'),
  matchedOn: text('matched_on').array(),
  decidedByUserId: uuid('decided_by_user_id').references(() => appUser.id), // null = automatic
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('merge_decision_entity_a_idx').on(t.entityAId),
  index('merge_decision_entity_b_idx').on(t.entityBId),
])

/**
 * Persistent queue of scored-but-not-auto-merged entity pairs (the
 * `needs_review` band from packages/core's scorePersonMatch — see
 * apps/worker/src/ingest/post-collection-resolve.ts). Without this table
 * those candidates were only ever counted, never surfaced anywhere for a
 * human to actually review — this is what an Entity Resolution admin queue
 * UI would query against. One row per pair; re-scoring the same pair
 * updates the existing row (via a unique index) rather than duplicating it,
 * since search re-runs will keep re-evaluating the same candidates.
 */
export const resolutionCandidateStatusEnum = ['pending', 'confirmed', 'rejected'] as const

export const resolutionCandidate = pgTable('resolution_candidate', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityAId: uuid('entity_a_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  entityBId: uuid('entity_b_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  score: real('score').notNull(),
  matchedOn: text('matched_on').array().notNull(),
  status: text('status', { enum: resolutionCandidateStatusEnum }).notNull().default('pending'),
  firstFlaggedAt: timestamp('first_flagged_at', { withTimezone: true }).notNull().defaultNow(),
  lastScoredAt: timestamp('last_scored_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => appUser.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
}, (t) => [
  index('resolution_candidate_status_idx').on(t.status),
  index('resolution_candidate_entity_a_idx').on(t.entityAId),
  index('resolution_candidate_entity_b_idx').on(t.entityBId),
  // Application code MUST normalize (entityAId, entityBId) ordering — e.g.
  // lexicographically smaller UUID first — before insert/upsert, or the
  // same pair discovered in the opposite order re-inserts as a duplicate
  // instead of updating lastScoredAt on the existing row.
  uniqueIndex('resolution_candidate_pair_idx').on(t.entityAId, t.entityBId),
])

