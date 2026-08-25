import { eq, and, isNull, inArray, desc, sql } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, claim as claimTable, resolutionCandidate, entityBlockingKey } from '@osint/db/schema'
import { scorePersonMatch, personBlockingKeys, applyMerge, coerceClaimString } from '@osint/core'

/** name-last:<soundex> alone (no DOB/phone/email co-signal) legitimately returns thousands of candidates for a common surname — cap and log rather than silently return a partial, misleading result. */
const MAX_CANDIDATES = 200

interface PersonFeatures {
  entityId: string
  fullName: string
  dobCandidates: string[] // every distinct date_of_birth value seen, most-corroborated first — see scoreAgainstDobCandidates
  phones: string[]
  emails: string[]
  addresses: string[]
  relatives: string[]
}

/**
 * Loads every non-retracted claim for a person entity and reduces it to the
 * feature set scorePersonMatch needs. Two precision bugs fixed here versus
 * the original:
 *
 * 1. `claims.find(...)?.value as string` on a jsonb column silently produced
 *    the literal string `"[object Object]"` for any connector emitting an
 *    object value (which several do), and that fabricated string then
 *    "matched" any other person whose object-valued claim degraded the same
 *    way. Replaced with `coerceClaimString`, which returns `null` instead of
 *    guessing when it can't recognize the shape.
 * 2. `full_name`/`date_of_birth` took the *first* row with no `ORDER BY` —
 *    with conflicting DOBs across sources (claim.ts's own doctrine calls
 *    this "the normal case"), the resolution outcome depended on row
 *    insertion order. `fullName` now prefers the highest-confidence,
 *    most-recent claim; DOB keeps every distinct value seen (see
 *    `dobCandidates`) so scoring can check all of them instead of picking
 *    one arbitrarily and possibly missing the one that actually matches.
 */
function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** Row shape shared by both single- and batch-load paths; kept `unknown`-free by piggybacking on the schema's inferred claim row type via `typeof claimTable.$inferSelect`. */
type ClaimRow = typeof claimTable.$inferSelect

function extractFeatures(entityId: string, displayLabel: string, claims: ClaimRow[]): PersonFeatures {
  const fullNameClaim = claims.find((c) => c.predicate === 'full_name')
  const fullName = (fullNameClaim && coerceClaimString('full_name', fullNameClaim.value)) ?? displayLabel

  const dobCandidates = dedupe(
    claims
      .filter((c) => c.predicate === 'date_of_birth')
      .map((c) => coerceClaimString('date_of_birth', c.value))
      .filter((v): v is string => v !== null),
  )

  const phones = dedupe(claims.filter((c) => c.predicate === 'phone_number').map((c) => coerceClaimString('phone_number', c.value)).filter((v): v is string => v !== null))
  const emails = dedupe(claims.filter((c) => c.predicate === 'email_address').map((c) => coerceClaimString('email_address', c.value)).filter((v): v is string => v !== null))
  const addresses = dedupe(
    claims
      .filter((c) => c.predicate === 'current_address' || c.predicate === 'former_address')
      .map((c) => coerceClaimString(c.predicate, c.value))
      .filter((v): v is string => v !== null),
  )
  const relatives = dedupe(claims.filter((c) => c.predicate === 'relative_of').map((c) => coerceClaimString('relative_of', c.value)).filter((v): v is string => v !== null))

  return { entityId, fullName, dobCandidates, phones, emails, addresses, relatives }
}

async function loadPersonFeatures(db: Database, entityId: string): Promise<PersonFeatures | null> {
  const [entityRow] = await db.select().from(entity).where(eq(entity.id, entityId))
  if (!entityRow || entityRow.type !== 'person') return null

  const claims = await db.select().from(claimTable).where(
    and(eq(claimTable.subjectEntityId, entityId), isNull(claimTable.retractedAt)),
  ).orderBy(desc(claimTable.confidence), desc(claimTable.collectedAt))

  return extractFeatures(entityId, entityRow.displayLabel, claims)
}

/**
 * Batch equivalent of loadPersonFeatures for N candidate entities — exactly
 * 2 queries total (entities, claims), regardless of N, versus the original
 * 2 + 2N. This is the fix for the plan's stated "2 + 2N queries where N is
 * every person entity in the database": entities are already scoped by the
 * blocking-key seek before this runs, so N here is bounded by
 * MAX_CANDIDATES, not the table size — but even bounded, doing it in 2
 * queries instead of 2N keeps the query count independent of the cap.
 */
async function loadPersonFeaturesBatch(db: Database, entityIds: string[]): Promise<Map<string, PersonFeatures>> {
  const result = new Map<string, PersonFeatures>()
  if (entityIds.length === 0) return result

  const entityRows = await db.select().from(entity).where(
    and(inArray(entity.id, entityIds), eq(entity.type, 'person')),
  )
  const validIds = entityRows.map((e) => e.id)
  if (validIds.length === 0) return result

  const claims = await db.select().from(claimTable).where(
    and(inArray(claimTable.subjectEntityId, validIds), isNull(claimTable.retractedAt)),
  ).orderBy(desc(claimTable.confidence), desc(claimTable.collectedAt))

  const claimsByEntity = new Map<string, ClaimRow[]>()
  for (const c of claims) {
    const bucket = claimsByEntity.get(c.subjectEntityId)
    if (bucket) bucket.push(c)
    else claimsByEntity.set(c.subjectEntityId, [c])
  }

  for (const row of entityRows) {
    result.set(row.id, extractFeatures(row.id, row.displayLabel, claimsByEntity.get(row.id) ?? []))
  }
  return result
}

/**
 * scorePersonMatch takes a single `dobA`/`dobB` pair. With multiple
 * observed DOBs per side (conflicting sources), scores every A×B
 * combination and keeps the best result — this is what stops "the DOB
 * candidate that happens to be first in an unordered array" from
 * determining whether two real matches get flagged, when a different
 * pairing would have scored as an exact match.
 */
function scoreAgainstDobCandidates(primary: PersonFeatures, candidate: PersonFeatures) {
  const primaryDobs = primary.dobCandidates.length > 0 ? primary.dobCandidates : [null]
  const candidateDobs = candidate.dobCandidates.length > 0 ? candidate.dobCandidates : [null]

  let best: ReturnType<typeof scorePersonMatch> | null = null
  for (const dobA of primaryDobs) {
    for (const dobB of candidateDobs) {
      const result = scorePersonMatch({
        nameA: primary.fullName, nameB: candidate.fullName,
        dobA, dobB,
        phonesA: primary.phones, phonesB: candidate.phones,
        emailsA: primary.emails, emailsB: candidate.emails,
        addressesA: primary.addresses, addressesB: candidate.addresses,
        relativeNamesA: primary.relatives, relativeNamesB: candidate.relatives,
      })
      if (!best || result.score > best.score) best = result
    }
  }
  return best!
}

/**
 * Upserts one needs_review candidate pair, normalizing (entityAId,
 * entityBId) ordering first — the resolution_candidate table's unique index
 * is on that pair, so without normalizing, discovering the same two
 * entities in the opposite order would insert a duplicate row instead of
 * refreshing the existing one's score/lastScoredAt.
 */
async function upsertReviewCandidate(db: Database, params: { entityId1: string; entityId2: string; score: number; matchedOn: string[] }) {
  const [entityAId, entityBId] = [params.entityId1, params.entityId2].sort()

  await db.insert(resolutionCandidate)
    .values({ entityAId: entityAId!, entityBId: entityBId!, score: params.score, matchedOn: params.matchedOn })
    .onConflictDoUpdate({
      target: [resolutionCandidate.entityAId, resolutionCandidate.entityBId],
      set: { score: params.score, matchedOn: params.matchedOn, lastScoredAt: sql`now()` },
    })
}

/**
 * Persists this entity's current blocking keys to `entity_blocking_key`,
 * replacing whatever was there before (a person's name/DOB/phone/email can
 * change between runs as new claims arrive). This is what makes candidate
 * generation an index seek instead of a full-table scan — every person
 * entity's keys are kept current as of its own last resolution pass.
 */
async function persistBlockingKeys(db: Database, entityId: string, keys: string[]) {
  await db.delete(entityBlockingKey).where(eq(entityBlockingKey.entityId, entityId))
  if (keys.length === 0) return
  await db.insert(entityBlockingKey).values(
    keys.map((key) => ({ entityId, key, keyKind: key.split(':')[0]! })),
  ).onConflictDoNothing()
}

/**
 * Runs after a search's collection finishes: pulls together every claim
 * gathered for the primary entity (name, DOB, phones, emails, addresses,
 * relatives) and scores it against every other `person` entity sharing a
 * blocking key. `auto_merge` decisions call packages/core's applyMerge
 * immediately (decidedByUserId: null — logged as automatic, not audited to
 * a human); `needs_review` candidates are left for the merge-review queue
 * (apps/web's Entity Resolution admin view) rather than silently merged.
 *
 * Candidate generation is an index seek against `entity_blocking_key`
 * (`WHERE key = ANY(...)`), not a full scan of every `person` entity in the
 * database followed by JS-side blocking — the original version loaded
 * every person row on every single search, which inverted the entire point
 * of blocking. Capped at MAX_CANDIDATES, logged when hit rather than
 * silently truncated.
 */
export async function runPostCollectionResolution(db: Database, primaryEntityId: string): Promise<{ merged: number; flaggedForReview: number; candidatesCapped: boolean }> {
  const primary = await loadPersonFeatures(db, primaryEntityId)
  if (!primary) return { merged: 0, flaggedForReview: 0, candidatesCapped: false }

  const blockingKeys = personBlockingKeys({
    fullName: primary.fullName,
    dobYear: primary.dobCandidates[0] ? Number(primary.dobCandidates[0].slice(0, 4)) : null,
    phone: primary.phones[0] ?? null,
    email: primary.emails[0] ?? null,
  })

  await persistBlockingKeys(db, primaryEntityId, blockingKeys)
  if (blockingKeys.length === 0) return { merged: 0, flaggedForReview: 0, candidatesCapped: false }

  const matchingRows = await db
    .select({ entityId: entityBlockingKey.entityId })
    .from(entityBlockingKey)
    .where(inArray(entityBlockingKey.key, blockingKeys))

  const candidateIds = dedupe(matchingRows.map((r) => r.entityId)).filter((id) => id !== primaryEntityId)
  const candidatesCapped = candidateIds.length > MAX_CANDIDATES
  const scopedIds = candidatesCapped ? candidateIds.slice(0, MAX_CANDIDATES) : candidateIds

  let merged = 0
  let flaggedForReview = 0

  if (scopedIds.length > 0) {
    // Batch-loaded (2 queries total, independent of N) rather than one
    // query per candidate — see loadPersonFeaturesBatch's doc comment. This
    // also implicitly confirms each candidate is still a `person` entity: a
    // blocking-key row can outlive a merge that reparented its entity, and
    // such rows simply won't appear in the returned map.
    const featuresById = await loadPersonFeaturesBatch(db, scopedIds.filter((id) => id !== primaryEntityId))

    for (const candidateFeatures of featuresById.values()) {
      const result = scoreAgainstDobCandidates(primary, candidateFeatures)

      if (result.decision === 'auto_merge') {
        await applyMerge(db, {
          entityAId: candidateFeatures.entityId,
          entityBId: primary.entityId,
          score: result.score,
          matchedOn: result.matchedOn,
          decidedByUserId: null,
        })
        merged++
      } else if (result.decision === 'needs_review') {
        await upsertReviewCandidate(db, {
          entityId1: primary.entityId,
          entityId2: candidateFeatures.entityId,
          score: result.score,
          matchedOn: result.matchedOn,
        })
        flaggedForReview++
      }
    }
  }

  return { merged, flaggedForReview, candidatesCapped }
}
