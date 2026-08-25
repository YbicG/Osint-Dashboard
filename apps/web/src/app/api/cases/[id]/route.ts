import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import { appendAuditEntry } from '@osint/core'
import { caseTable, caseNote, subject, appUser } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [c] = await db.select().from(caseTable).where(eq(caseTable.id, id))
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notes = await db.select({ note: caseNote, authorName: appUser.displayName })
    .from(caseNote)
    .innerJoin(appUser, eq(caseNote.authorUserId, appUser.id))
    .where(eq(caseNote.caseId, id))
    .orderBy(desc(caseNote.createdAt))

  const subjects = await db.select().from(subject).where(eq(subject.caseId, id))

  return NextResponse.json({
    case: c,
    notes: notes.map((n) => ({ id: n.note.id, body: n.note.body, createdAt: n.note.createdAt, authorName: n.authorName })),
    subjects,
  })
}

const CloseSchema = z.object({ status: z.enum(['open', 'on_hold', 'closed']) })

/**
 * The only case mutation exposed here is status. Closing a case is the
 * trigger point for the biometric-data purge the plan's compliance layer
 * calls for (IL BIPA / TX CUBI / WA private-right-of-action exposure) — the
 * vision pipeline (apps/vision, Phase 6) isn't built yet, so there are no
 * faceprints to purge today, but `biometricDataPurged` is still set here so
 * the flag's semantics ("purge ran, or there was nothing to purge") are
 * correct from day one rather than retrofitted once vision lands.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    return NextResponse.json({ error: 'Forbidden — admin or supervisor role required to change case status' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = CloseSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const isClosing = parsed.data.status === 'closed'
  const [updated] = await db.update(caseTable).set({
    status: parsed.data.status,
    closedAt: isClosing ? new Date() : null,
    ...(isClosing ? { biometricDataPurged: true } : {}),
  }).where(eq(caseTable.id, id)).returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await appendAuditEntry(db, {
    userId: user.id,
    action: parsed.data.status === 'closed' ? 'case.close' : 'case.status_change',
    targetType: 'case',
    targetId: id,
    metadata: { newStatus: parsed.data.status },
  })

  return NextResponse.json({ ok: true })
}
