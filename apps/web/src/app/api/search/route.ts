import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { SearchInput, PURPOSE_CODES } from '@osint/contracts'
import { appendAuditEntry } from '@osint/core'
import { searchRequest } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'
import { getSearchExecutionQueue } from '@/server/queue'

const CreateSearchSchema = z.object({
  input: SearchInput,
  purposeCode: z.enum(PURPOSE_CODES),
  caseId: z.string().uuid().nullable().optional(),
})

/**
 * Creates a search and enqueues its execution. `purposeCode` is required on
 * every call, not optional — this is the FCRA/compliance gate from the plan
 * doc, enforced at the one chokepoint every search must pass through rather
 * than trusted to be set by the UI.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = CreateSearchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { input, purposeCode, caseId } = parsed.data

  const [created] = await db.insert(searchRequest).values({
    caseId: caseId ?? null,
    inputType: input.type,
    inputPayload: input,
    purposeCode,
    requestedByUserId: user.id,
  }).returning()

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'search.create',
    targetType: 'search_request',
    targetId: created!.id,
    purposeCode,
    metadata: { inputType: input.type },
  })

  await getSearchExecutionQueue().add('run-search', { searchId: created!.id })

  return NextResponse.json({ id: created!.id })
}
