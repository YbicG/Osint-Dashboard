import { sql } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, claim as claimTable, edge, edgeClaim } from '@osint/db/schema'
import type { Predicate, EdgeType, EntityType } from '@osint/contracts'
import type { DraftClaim } from '@osint/connectors'
import { computeMatchKey, coerceClaimString, computeValueFingerprint } from '@osint/core'

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
  // Synthesized below (see synthesizeRelatedEntity) — these four predicates
  // never carry an explicit `relatedEntity` from a connector (they're
  // "about the subject," not "about a relationship"), but the identifier
  // they name is itself edge-worthy: two subjects sharing a phone/email/
  // address/username is exactly the kind of fact the graph exists to show,
  // and it falls out of every one of the 21+ connectors emitting these
  // predicates with zero connector-side changes.
  current_address: 'resides_at',
  former_address: 'resides_at',
  phone_number: 'uses_contact',
  email_address: 'uses_contact',
  username_presence: 'uses_username',
}

/** Entity type to mint for a synthesized related entity, keyed by predicate. */
const SYNTHESIZED_ENTITY_TYPE: Partial<Record<Predicate, EntityType>> = {
  current_address: 'address',
  former_address: 'address',
  phone_number: 'phone',
  email_address: 'email',
  username_presence: 'username',
}

export interface IngestParams {
  draft: DraftClaim
  primaryEntityId: string
  sourceId: string
  collectionRunId: string
}

/**
 * Finds or creates the entity a relationship-shaped claim points at.
 * Rewritten from a select-all-of-type + JS `.find()` scan (O(n) per claim,
 * n = every entity of that type ever seen) to a single index-backed upsert
 * via `computeMatchKey` + the `entity_type_match_key_uidx` partial unique
 * index — the same mechanism `findOrCreateSubjectEntity` uses for the
 * top-level search subject, now shared by every relationship/identifier
 * pivot discovered mid-ingest.
 */
async function findOrCreateRelatedEntity(db: Database, related: { type: EntityType; label: string }): Promise<string> {
  const matchKey = computeMatchKey(related.type, related.label)

  if (matchKey === null) {
    // person/organization: never deduped by value — every occurrence is a
    // fresh entity, resolved later by packages/core's scorePersonMatch.
    const [created] = await db.insert(entity).values({ type: related.type, displayLabel: related.label }).returning()
    return created!.id
  }

  const inserted = await db
    .insert(entity)
    .values({ type: related.type, displayLabel: related.label, matchKey })
    .onConflictDoNothing({ target: [entity.type, entity.matchKey], where: sql`${entity.matchKey} is not null` })
    .returning({ id: entity.id })

  if (inserted[0]) return inserted[0].id

  const [existing] = await db
    .select({ id: entity.id })
    .from(entity)
    .where(sql`${entity.type} = ${related.type} and ${entity.matchKey} = ${matchKey}`)
  if (!existing) {
    throw new Error(`findOrCreateRelatedEntity: conflict on (${related.type}, ${matchKey}) but no row found on fallback select`)
  }
  return existing.id
}

/**
 * Materializes/refreshes one graph edge in a single upsert statement.
 * Rewritten from select-all-edges-from-this-source + JS `.find()` (another
 * O(n) scan, n = every edge this entity has ever had) to `ON CONFLICT
 * (type, source_entity_id, target_entity_id) DO UPDATE`, backed by the new
 * `edge_triple_uidx`. `GREATEST` on confidence and observedAt is expressed
 * in SQL so the read-modify-write race the old version had (two concurrent
 * ingests both reading the same "existing max," each writing a value that
 * loses the other's update) can't happen — Postgres serializes the two
 * `ON CONFLICT` upserts and each one's `GREATEST` sees the other's committed value.
 */
async function materializeEdge(db: Database, params: { predicate: Predicate; sourceEntityId: string; targetEntityId: string; claimId: string; confidence: number; observedAt: Date | null }) {
  const edgeType = PREDICATE_TO_EDGE_TYPE[params.predicate]
  if (!edgeType) return

  const [row] = await db.insert(edge).values({
    type: edgeType,
    sourceEntityId: params.sourceEntityId,
    targetEntityId: params.targetEntityId,
    confidence: params.confidence,
    firstObservedAt: params.observedAt,
    lastObservedAt: params.observedAt,
  }).onConflictDoUpdate({
    target: [edge.type, edge.sourceEntityId, edge.targetEntityId],
    set: {
      confidence: sql`greatest(${edge.confidence}, ${params.confidence})`,
      lastObservedAt: sql`greatest(coalesce(${edge.lastObservedAt}, to_timestamp(0)), coalesce(${params.observedAt}, to_timestamp(0)))`,
    },
  }).returning({ id: edge.id })

  await db.insert(edgeClaim).values({ edgeId: row!.id, claimId: params.claimId }).onConflictDoNothing()
}

/**
 * When a connector emits one of the four unambiguous scalar-identifier
 * predicates without an explicit `relatedEntity` (the normal case — a
 * connector reporting "this subject's current address is X" isn't asserting
 * a relationship, just a fact about the subject), synthesize the related
 * identifier entity from the claim's own value. This is what turns "these
 * two people share a phone number" from unanswerable into a materialized
 * edge, across every existing and future connector that emits these four
 * predicates, with zero connector-side changes.
 *
 * Deliberately scoped to these four — NOT relationship predicates
 * (`relative_of` et al., which always carry an explicit `relatedEntity`
 * naming a *person*, not an identifier) and not every identifier-shaped
 * predicate in existence (e.g. `jurisdiction_fips` names a place, not a
 * reusable cross-subject identifier worth an edge).
 */
function synthesizeRelatedEntity(predicate: Predicate, value: unknown): { type: EntityType; label: string } | null {
  const entityType = SYNTHESIZED_ENTITY_TYPE[predicate]
  if (!entityType) return null
  const label = coerceClaimString(predicate, value)
  if (label === null) return null
  return { type: entityType, label }
}

/**
 * Turns one connector-emitted DraftClaim into real, addressable rows: the
 * related entity (explicit or synthesized) is found-or-created first, then
 * the immutable Claim row is inserted, then a graph Edge is
 * materialized/updated if the predicate is edge-shaped. This is the only
 * write path from "connector output" into the claim/edge tables — keeping
 * it centralized here is what guarantees every claim has a source,
 * collection run, and (where applicable) a consistent edge.
 */
export async function ingestDraftClaim(db: Database, params: IngestParams): Promise<{ claimId: string }> {
  const { draft } = params
  let objectEntityId: string | null = null

  const related = draft.relatedEntity ?? synthesizeRelatedEntity(draft.predicate, draft.value)
  if (related) {
    objectEntityId = await findOrCreateRelatedEntity(db, related)
  }

  const [inserted] = await db.insert(claimTable).values({
    subjectEntityId: params.primaryEntityId,
    objectEntityId,
    predicate: draft.predicate,
    value: draft.value as object,
    valueFingerprint: computeValueFingerprint(draft.predicate, draft.value),
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
