import { eq, and, ne, isNull, sql } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity, claim as claimTable, resolutionCandidate } from '@osint/db/schema'
import { scorePersonMatch, personBlockingKeys, applyMerge } from '@osint/core'

interface PersonFeatures {
  entityId: string
  fullName: string
  dob: string | null
  phones: string[]
  emails: string[]
  addresses: string[]
  relatives: string[]
}

async function loadPersonFeatures(db: Database, entityId: string): Promise<PersonFeatures | null> {
  const [entityRow] = await db.select().from(entity).where(eq(entity.id, entityId))
  if (!entityRow || entityRow.type !== 'person') return null

  const claims = await db.select().from(claimTable).where(
    and(eq(claimTable.subjectEntityId, entityId), isNull(claimTable.retractedAt)),
  )

  const fullName = claims.find((c) => c.predicate === 'full_name')?.value as string ?? entityRow.displayLabel
  const dob = claims.find((c) => c.predicate === 'date_of_birth')?.value as string | undefined ?? null
  const phones = claims.filter((c) => c.predicate === 'phone_number').map((c) => c.value as string)
  const emails = claims.filter((c) => c.predicate === 'email_address').map((c) => c.value as string)
  const addresses = claims
    .filter((c) => c.predicate === 'current_address' || c.predicate === 'former_address')
    .map((c) => c.value as string)
  const relatives = claims.filter((c) => c.predicate === 'relative_of').map((c) => c.value as string)

  return { entityId, fullName, dob, phones, emails, addresses, relatives }
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
 * Runs after a search's collection finishes: pulls together every claim
 * gathered for the primary entity (name, DOB, phones, emails, addresses,
 * relatives) and scores it against every other `person` entity sharing a
 * blocking key. `auto_merge` decisions call packages/core's applyMerge
 * immediately (decidedByUserId: null — logged as automatic, not audited to
 * a human); `needs_review` candidates are left for the merge-review queue
 * (apps/web's Entity Resolution admin view) rather than silently merged.
 */
export async function runPostCollectionResolution(db: Database, primaryEntityId: string): Promise<{ merged: number; flaggedForReview: number }> {
  const primary = await loadPersonFeatures(db, primaryEntityId)
  if (!primary) return { merged: 0, flaggedForReview: 0 }

  const blockingKeys = personBlockingKeys({
    fullName: primary.fullName,
    dobYear: primary.dob ? Number(primary.dob.slice(0, 4)) : null,
    phone: primary.phones[0] ?? null,
    email: primary.emails[0] ?? null,
  })
  if (blockingKeys.length === 0) return { merged: 0, flaggedForReview: 0 }

  const candidates = await db.select({ id: entity.id }).from(entity).where(
    and(eq(entity.type, 'person'), ne(entity.id, primaryEntityId)),
  )

  let merged = 0
  let flaggedForReview = 0

  for (const candidate of candidates) {
    const candidateFeatures = await loadPersonFeatures(db, candidate.id)
    if (!candidateFeatures) continue

    const candidateKeys = personBlockingKeys({
      fullName: candidateFeatures.fullName,
      dobYear: candidateFeatures.dob ? Number(candidateFeatures.dob.slice(0, 4)) : null,
      phone: candidateFeatures.phones[0] ?? null,
      email: candidateFeatures.emails[0] ?? null,
    })
    if (!blockingKeys.some((k) => candidateKeys.includes(k))) continue

    const result = scorePersonMatch({
      nameA: primary.fullName, nameB: candidateFeatures.fullName,
      dobA: primary.dob, dobB: candidateFeatures.dob,
      phonesA: primary.phones, phonesB: candidateFeatures.phones,
      emailsA: primary.emails, emailsB: candidateFeatures.emails,
      addressesA: primary.addresses, addressesB: candidateFeatures.addresses,
      relativeNamesA: primary.relatives, relativeNamesB: candidateFeatures.relatives,
    })

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

  return { merged, flaggedForReview }
}
