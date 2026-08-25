import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { caseNote } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const NoteSchema = z.object({ body: z.string().min(1).max(10_000) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = NoteSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const [created] = await db.insert(caseNote).values({
    caseId: id,
    authorUserId: user.id,
    body: parsed.data.body,
  }).returning()

  return NextResponse.json({ id: created!.id })
}
