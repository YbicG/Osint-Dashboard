import { eq } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, claim as claimTable, edge, edgeClaim } from '@osint/db/schema'
import type { Predicate, EdgeType, EntityType } from '@osint/contracts'
import type { DraftClaim } from '@osint/connectors'
import { normalizeForMatch } from '@osint/core'

/** Which predicates materialize a graph edge, and which EdgeType they map to. Not every relationship-shaped predicate needs a row here — anything absent just stays a claim, findable via the dossier's Relationships tab without a graph edge. */
const PREDICATE_TO_EDGE_TYPE: Partial<Record<Predicate, EdgeType>> = {
  relative_of: 'relative',
  spouse_of: 'spouse',
  associate_of: 'associate',
  coworker_of: 'coworker',
  neighbor_of: 'neighbor',
  employee_of: 'employee_of',
  owner_of: 'owner_of',
  officer_of: 'officer_of',
  registered_agent_of: 'registered_agent_of',
}

export interface IngestParams {
  draft: DraftClaim
  primaryEntityId: string
  sourceId: string
  collectionRunId: string
}

async function findOrCreateRelatedEntity(db: Database, related: { type: EntityType; label: string }): Promise<string> {
  const existing = await db.select({ id: entity.id, displayLabel: entity.displayLabel })
    .from(entity)
    .where(eq(entity.type, related.type))
  const match = existing.find((e) => normalizeForMatch(e.displayLabel) === normalizeForMatch(related.label))
  if (match) return match.id

  const [created] = await db.insert(entity).values({ type: related.type, displayLabel: related.label }).returning()
  return created!.id
}

async function materializeEdge(db: Database, params: { predicate: Predicate; sourceEntityId: string; targetEntityId: string; claimId: string; confidence: number; observedAt: Date | null }) {
  const edgeType = PREDICATE_TO_EDGE_TYPE[params.predicate]
  if (!edgeType) return

  const existing = await db.select().from(edge).where(eq(edge.sourceEntityId, params.sourceEntityId))
  const match = existing.find((e) => e.type === edgeType && e.targetEntityId === params.targetEntityId)

  let edgeId: string
  if (match) {
    edgeId = match.id
    await db.update(edge).set({
      confidence: Math.max(match.confidence, params.confidence),
      lastObservedAt: params.observedAt ?? match.lastObservedAt,
    }).where(eq(edge.id, edgeId))
  } else {
    const [created] = await db.insert(edge).values({
      type: edgeType,
      sourceEntityId: params.sourceEntityId,
      targetEntityId: params.targetEntityId,
      confidence: params.confidence,
      firstObservedAt: params.observedAt,
      lastObservedAt: params.observedAt,
    }).returning()
    edgeId = created!.id
  }
  await db.insert(edgeClaim).values({ edgeId, claimId: params.claimId }).onConflictDoNothing()
}

/**
 * Turns one connector-emitted DraftClaim into real, addressable rows: the
 * related entity (if this is a relationship claim) is found-or-created
 * first, then the immutable Claim row is inserted, then a graph Edge is
 * materialized/updated if the predicate is edge-shaped. This is the only
 * write path from "connector output" into the claim/edge tables — keeping
 * it centralized here is what guarantees every claim has a source,
 * collection run, and (where applicable) a consistent edge.
 */
export async function ingestDraftClaim(db: Database, params: IngestParams): Promise<{ claimId: string }> {
  const { draft } = params
  let objectEntityId: string | null = null

  if (draft.relatedEntity) {
    objectEntityId = await findOrCreateRelatedEntity(db, draft.relatedEntity)
  }

  const [inserted] = await db.insert(claimTable).values({
    subjectEntityId: params.primaryEntityId,
    objectEntityId,
    predicate: draft.predicate,
    value: draft.value as object,
    sourceId: params.sourceId,
    collectionRunId: params.collectionRunId,
    observedAt: draft.observedAt ?? null,
    confidence: draft.confidence,
    rawSnippet: draft.rawSnippet ?? null,
    evidenceUrl: draft.evidenceUrl ?? null,
  }).returning()

  const claimId = inserted!.id

  if (objectEntityId) {
    await materializeEdge(db, {
      predicate: draft.predicate,
      sourceEntityId: params.primaryEntityId,
      targetEntityId: objectEntityId,
      claimId,
      confidence: draft.confidence,
      observedAt: draft.observedAt ?? null,
    })
  }

  return { claimId }
}
