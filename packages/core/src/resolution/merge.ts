import { eq, or } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, identityCluster, mergeDecision } from '@osint/db/schema'
import { appendAuditEntry } from '../audit/hash-chain'

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
