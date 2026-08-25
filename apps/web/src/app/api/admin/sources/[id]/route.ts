import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { source } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const PatchSchema = z.object({ enabled: z.boolean() })

/**
 * Admin-only kill switch per source — e.g. a source starts getting the
 * whole org rate-limited, or a ToS concern comes up mid-investigation.
 * Every subsequent search filters this source out at plan time (see
 * apps/worker/src/ingest/run-search.ts's disabledConnectorIds check) —
 * disabling here takes effect on the very next search, no worker restart
 * needed. In-flight collection runs already underway are not interrupted.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const [updated] = await db.update(source).set({ enabled: parsed.data.enabled }).where(eq(source.id, id)).returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await appendAuditEntry(db, {
    userId: user.id,
    action: parsed.data.enabled ? 'source.enable' : 'source.disable',
    targetType: 'source',
    targetId: id,
    metadata: { connectorId: updated.connectorId },
  })

  return NextResponse.json({ ok: true })
}
