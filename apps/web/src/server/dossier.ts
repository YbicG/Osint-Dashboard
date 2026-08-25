import { eq, or, isNull, and } from 'drizzle-orm'
import { entity, claim as claimTable, edge, source } from '@osint/db/schema'
import { db } from './db'

export interface DossierClaim {
  id: string
  predicate: string
  value: unknown
  confidence: number
  observedAt: Date | null
  collectedAt: Date
  rawSnippet: string | null
  evidenceUrl: string | null
  sourceName: string
  sourceCategory: string
  objectEntityId: string | null
}

export interface DossierData {
  entity: { id: string; type: string; displayLabel: string; clusterId: string | null }
  claims: DossierClaim[]
  edges: { id: string; type: string; sourceEntityId: string; targetEntityId: string; confidence: number }[]
  relatedEntities: { id: string; type: string; displayLabel: string }[]
}

/** Shared by the dossier page (SSR) and the /api/entities/[id] route (client-side refetch, exports) — one query path, one shape. */
export async function getDossierData(entityId: string): Promise<DossierData | null> {
  const [entityRow] = await db.select().from(entity).where(eq(entity.id, entityId))
  if (!entityRow) return null

  const claims = await db.select({ claim: claimTable, source })
    .from(claimTable)
    .innerJoin(source, eq(claimTable.sourceId, source.id))
    .where(and(eq(claimTable.subjectEntityId, entityId), isNull(claimTable.retractedAt)))

  const edges = await db.select().from(edge).where(or(eq(edge.sourceEntityId, entityId), eq(edge.targetEntityId, entityId)))

  const relatedEntityIds = [...new Set(edges.flatMap((e) => [e.sourceEntityId, e.targetEntityId]).filter((eid) => eid !== entityId))]
  const relatedEntities = relatedEntityIds.length
    ? await db.select({ id: entity.id, type: entity.type, displayLabel: entity.displayLabel }).from(entity)
      .where(or(...relatedEntityIds.map((eid) => eq(entity.id, eid))))
    : []

  return {
    entity: { id: entityRow.id, type: entityRow.type, displayLabel: entityRow.displayLabel, clusterId: entityRow.clusterId },
    claims: claims.map((c) => ({
      id: c.claim.id,
      predicate: c.claim.predicate,
      value: c.claim.value,
      confidence: c.claim.confidence,
      observedAt: c.claim.observedAt,
      collectedAt: c.claim.collectedAt,
      rawSnippet: c.claim.rawSnippet,
      evidenceUrl: c.claim.evidenceUrl,
      sourceName: c.source.name,
      sourceCategory: c.source.category,
      objectEntityId: c.claim.objectEntityId,
    })),
    edges,
    relatedEntities,
  }
}
