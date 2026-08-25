import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { subject } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const SubjectSchema = z.object({
  label: z.string().min(1).max(200),
  entityId: z.string().uuid().nullable().optional(),
  monitoringEnabled: z.boolean().optional(),
  monitoringIntervalHours: z.number().int().positive().nullable().optional(),
})

/**
 * Adds a subject to a case. `entityId` is optional — a subject can be added
 * by a plain label before it's ever been searched/resolved (e.g. "the
 * landlord mentioned in the police report"), and linked to a real entity
 * later once a search resolves who that is.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = SubjectSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const [created] = await db.insert(subject).values({
    caseId: id,
    entityId: parsed.data.entityId ?? null,
    label: parsed.data.label,
    addedByUserId: user.id,
    monitoringEnabled: parsed.data.monitoringEnabled ?? false,
    monitoringIntervalHours: parsed.data.monitoringIntervalHours ?? null,
  }).returning()

  return NextResponse.json({ id: created!.id })
}
