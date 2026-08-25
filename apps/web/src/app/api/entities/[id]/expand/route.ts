import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { PURPOSE_CODES } from '@osint/contracts'
import type { SearchInput, Claim as ClaimType } from '@osint/contracts'
import { appendAuditEntry } from '@osint/core'
import { claim as claimTable, collectionRun, searchRequest } from '@osint/db/schema'
import { deriveInputs } from '@osint/connectors/pivot'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'
import { getSearchExecutionQueue } from '@/server/queue'

const ExpandSchema = z.object({
  claimId: z.string().uuid(),
  purposeCode: z.enum(PURPOSE_CODES),
  caseId: z.string().uuid().nullable().optional(),
})

/**
 * "One manual click legitimately buys one more hop." Per the M3 plan:
 * derive candidate searches from one specific claim, run them through the
 * same pivot budget guards as auto-pivot (with a fresh budget rather than
 * inheriting whatever a prior auto-pivot tree had already spent), and
 * enqueue each as a real, audited search_request — never bypassing the
 * purpose-code gate by inheriting a stale one from the search that
 * originally produced the claim.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: entityId } = await params
  const body = await req.json().catch(() => null)
  const parsed = ExpandSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { claimId, purposeCode, caseId } = parsed.data

  const [claimRow] = await db.select().from(claimTable).where(eq(claimTable.id, claimId))
  if (!claimRow) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })

  // The authorization check the plan calls out explicitly: without this, an
  // arbitrary claim id lets a caller expand a claim belonging to an entity
  // they have no business investigating, using this entity's route as cover.
  if (claimRow.subjectEntityId !== entityId) {
    return NextResponse.json({ error: 'Claim does not belong to this entity' }, { status: 403 })
  }

  // Reconstruct the search this claim actually came from, to give
  // deriveInputs a real `origin` (its loop-prevention check and the
  // jurisdiction_fips re-scoping rule both read from it). Falls back to a
  // harmless placeholder if the chain is somehow missing — deriveInputs is
  // total/defensive and a placeholder origin just means the "don't re-derive
  // my own input" check never fires, not a crash.
  const [producingRun] = await db.select({ searchId: collectionRun.searchId }).from(collectionRun).where(eq(collectionRun.id, claimRow.collectionRunId))
  let originInput: SearchInput = { type: 'username', value: '__manual_expand_no_origin__' }
  let originSearch: typeof searchRequest.$inferSelect | undefined
  if (producingRun) {
    const [search] = await db.select().from(searchRequest).where(eq(searchRequest.id, producingRun.searchId))
    if (search) {
      originSearch = search
      originInput = { type: search.inputType, ...(search.inputPayload as object) } as SearchInput
    }
  }

  const claimForDerivation: ClaimType = {
    id: claimRow.id,
    subjectEntityId: claimRow.subjectEntityId,
    objectEntityId: claimRow.objectEntityId,
    predicate: claimRow.predicate as ClaimType['predicate'],
    value: claimRow.value as ClaimType['value'],
    sourceId: claimRow.sourceId,
    collectionRunId: claimRow.collectionRunId,
    observedAt: claimRow.observedAt,
    collectedAt: claimRow.collectedAt,
    confidence: claimRow.confidence,
    rawSnippet: claimRow.rawSnippet,
    evidenceUrl: claimRow.evidenceUrl,
    screenshotSha256: claimRow.screenshotSha256,
    retractedAt: claimRow.retractedAt,
    retractedReason: claimRow.retractedReason,
  }

  const candidates = deriveInputs(claimForDerivation, originInput)
  if (candidates.length === 0) {
    return NextResponse.json({ children: [], message: 'No pivot could be derived from this claim.' })
  }

  const created: { id: string; inputType: string }[] = []
  for (const candidate of candidates) {
    const [child] = await db.insert(searchRequest).values({
      caseId: caseId ?? originSearch?.caseId ?? null,
      subjectEntityId: entityId,
      inputType: candidate.input.type,
      inputPayload: candidate.input,
      purposeCode,
      requestedByUserId: user.id,
      parentSearchId: originSearch?.id ?? null,
      rootSearchId: null, // a fresh tree, not a continuation of whatever budget the originating search had already spent
      pivotDepth: 0,
      origin: 'manual_expand',
      derivedFromClaimId: claimId,
      connectorBudget: 120,
      connectorBudgetUsed: 0,
    }).returning({ id: searchRequest.id, inputType: searchRequest.inputType })
    created.push(child!)

    await getSearchExecutionQueue().add('run-search', { searchId: child!.id })
  }

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'search.expand',
    targetType: 'entity',
    targetId: entityId,
    purposeCode,
    metadata: { claimId, derivedInputTypes: created.map((c) => c.inputType) },
  })

  return NextResponse.json({ children: created })
}
