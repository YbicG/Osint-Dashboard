import { NextRequest, NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { PURPOSE_CODES } from '@osint/contracts'
import { appendAuditEntry } from '@osint/core'
import { caseTable } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const CreateCaseSchema = z.object({
  title: z.string().min(1).max(200),
  purposeCode: z.enum(PURPOSE_CODES),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cases = await db.select().from(caseTable).orderBy(desc(caseTable.createdAt))
  return NextResponse.json({ cases })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = CreateCaseSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const [created] = await db.insert(caseTable).values({
    orgId: user.orgId,
    title: parsed.data.title,
    purposeCode: parsed.data.purposeCode,
    createdByUserId: user.id,
  }).returning()

  await appendAuditEntry(db, {
    userId: user.id, action: 'case.create', targetType: 'case', targetId: created!.id, purposeCode: parsed.data.purposeCode,
  })

  return NextResponse.json({ id: created!.id })
}
