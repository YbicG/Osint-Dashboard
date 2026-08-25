import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { applyMerge } from '@osint/core'
import { resolutionCandidate } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const DecideSchema = z.object({ action: z.enum(['confirm', 'reject']) })

/**
 * Acts on one review-queue candidate. Gated to admin/supervisor — an
 * analyst can see the queue (GET .../candidates) but merging identities is
 * consequential enough (it changes what a future search returns) to
 * reserve for a more senior role, same reasoning as case.close in the plan.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    return NextResponse.json({ error: 'Forbidden — admin or supervisor role required' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = DecideSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const [candidate] = await db.select().from(resolutionCandidate).where(eq(resolutionCandidate.id, id))
  if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (candidate.status !== 'pending') return NextResponse.json({ error: `Already ${candidate.status}` }, { status: 409 })

  if (parsed.data.action === 'confirm') {
    await applyMerge(db, {
      entityAId: candidate.entityAId,
      entityBId: candidate.entityBId,
      score: candidate.score,
      matchedOn: candidate.matchedOn,
      decidedByUserId: user.id, // human decision — applyMerge writes this to the hash-chained audit log
    })
  }

  await db.update(resolutionCandidate).set({
    status: parsed.data.action === 'confirm' ? 'confirmed' : 'rejected',
    reviewedByUserId: user.id,
    reviewedAt: new Date(),
  }).where(eq(resolutionCandidate.id, id))

  return NextResponse.json({ ok: true })
}
