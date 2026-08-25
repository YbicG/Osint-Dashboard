import { and, eq, or, sql } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, identityCluster, mergeDecision, edge } from '@osint/db/schema'
import { appendAuditEntry } from '../audit/hash-chain'

/**
 * Materializes (or refreshes) a `same_as` edge between two entities. Runs
 * on every merge — previously merges only set `entity.clusterId`, so the
 * link graph rendered a merged identity as two unconnected nodes even
 * though the dossier already treated them as one. Idempotent via
 * `edge_triple_uidx` (type, sourceEntityId, targetEntityId): re-merging an
 * already-merged pair (e.g. a search re-run) refreshes `lastObservedAt`
 * instead of erroring or duplicating.
 */
async function upsertSameAsEdge(db: Database, aId: string, bId: string, score: number | null) {
  const confidence = score ?? 1
  const now = new Date()
  await db.insert(edge).values({
    type: 'same_as',
    sourceEntityId: aId,
    targetEntityId: bId,
    confidence,
    firstObservedAt: now,
    lastObservedAt: now,
  }).onConflictDoUpdate({
    target: [edge.type, edge.sourceEntityId, edge.targetEntityId],
    set: { confidence: sql`greatest(${edge.confidence}, ${confidence})`, lastObservedAt: now },
  })
}

export interface ApplyMergeInput {
  entityAId: string
  entityBId: string
  score: number | null // null for a manual, non-scored merge
  matchedOn: string[]
  decidedByUserId: string | null // null = automatic
}

/**
 * Merges entity B into entity A's identity cluster (creating one if A has
 * none), records the decision for audit, and writes to the hash-chained
 * audit_log if a human made the call. Never deletes either entity row —
 * clusters are just a grouping, so a later split is always possible.
 */
export async function applyMerge(db: Database, input: ApplyMergeInput) {
  const [a] = await db.select().from(entity).where(eq(entity.id, input.entityAId))
  if (!a) throw new Error(`Unknown entity ${input.entityAId}`)

  let clusterId = a.clusterId
  if (!clusterId) {
    const [cluster] = await db.insert(identityCluster).values({
      status: input.decidedByUserId ? 'manually_confirmed' : 'auto_merged',
      cohesionScore: input.score ?? 1,
      primaryEntityId: input.entityAId,
      reviewedByUserId: input.decidedByUserId,
      reviewedAt: input.decidedByUserId ? new Date() : null,
    }).returning()
    clusterId = cluster!.id
    await db.update(entity).set({ clusterId, updatedAt: new Date() }).where(eq(entity.id, input.entityAId))
  }

  await db.update(entity).set({ clusterId, updatedAt: new Date() }).where(eq(entity.id, input.entityBId))
  await upsertSameAsEdge(db, input.entityAId, input.entityBId, input.score)

  await db.insert(mergeDecision).values({
    entityAId: input.entityAId,
    entityBId: input.entityBId,
    action: 'merge',
    score: input.score,
    matchedOn: input.matchedOn,
    decidedByUserId: input.decidedByUserId,
  })

  if (input.decidedByUserId) {
    await appendAuditEntry(db, {
      userId: input.decidedByUserId,
      action: 'entity.merge',
      targetType: 'identity_cluster',
      targetId: clusterId,
      metadata: { entityAId: input.entityAId, entityBId: input.entityBId, matchedOn: input.matchedOn },
    })
  }

  return { clusterId }
}

export interface ApplySplitInput {
  entityId: string
  decidedByUserId: string
  reason?: string
}

/** Manual split: pulls one entity out into its own fresh cluster. Always human-initiated, always audited. */
export async function applySplit(db: Database, input: ApplySplitInput) {
  const [newCluster] = await db.insert(identityCluster).values({
    status: 'manually_split',
    cohesionScore: 1,
    primaryEntityId: input.entityId,
    reviewedByUserId: input.decidedByUserId,
    reviewedAt: new Date(),
  }).returning()

  await db.update(entity).set({ clusterId: newCluster!.id, updatedAt: new Date() }).where(eq(entity.id, input.entityId))

  // A human just declared this entity does not belong in its former
  // cluster, so any `same_as` edge asserting it's the same identity as
  // another entity no longer holds — leaving those edges in place would
  // have the graph continue showing a link a reviewer explicitly rejected.
  await db.delete(edge).where(
    and(eq(edge.type, 'same_as'), or(eq(edge.sourceEntityId, input.entityId), eq(edge.targetEntityId, input.entityId))),
  )

  await db.insert(mergeDecision).values({
    entityAId: input.entityId,
    entityBId: input.entityId,
    action: 'split',
    decidedByUserId: input.decidedByUserId,
  })

  await appendAuditEntry(db, {
    userId: input.decidedByUserId,
    action: 'entity.split',
    targetType: 'entity',
    targetId: input.entityId,
    metadata: { reason: input.reason ?? null },
  })

  return { clusterId: newCluster!.id }
}
