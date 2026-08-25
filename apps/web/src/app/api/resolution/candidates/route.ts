import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { resolutionCandidate, entity } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'
import { alias } from 'drizzle-orm/pg-core'

/**
 * Lists pending entity-resolution review candidates — pairs the scorer
 * flagged as "probably the same person" but not confident enough to
 * auto-merge (see apps/worker/src/ingest/post-collection-resolve.ts). Only
 * supervisors/admins act on these; analysts can see them but the UI gates
 * the decide action by role.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entityA = alias(entity, 'entity_a')
  const entityB = alias(entity, 'entity_b')

  const rows = await db.select({
    candidate: resolutionCandidate,
    entityA: { id: entityA.id, displayLabel: entityA.displayLabel },
    entityB: { id: entityB.id, displayLabel: entityB.displayLabel },
  })
    .from(resolutionCandidate)
    .innerJoin(entityA, eq(resolutionCandidate.entityAId, entityA.id))
    .innerJoin(entityB, eq(resolutionCandidate.entityBId, entityB.id))
    .where(eq(resolutionCandidate.status, 'pending'))
    .orderBy(desc(resolutionCandidate.score))

  return NextResponse.json({
    candidates: rows.map((r) => ({
      id: r.candidate.id,
      score: r.candidate.score,
      matchedOn: r.candidate.matchedOn,
      firstFlaggedAt: r.candidate.firstFlaggedAt,
      lastScoredAt: r.candidate.lastScoredAt,
      entityA: r.entityA,
      entityB: r.entityB,
    })),
  })
}
