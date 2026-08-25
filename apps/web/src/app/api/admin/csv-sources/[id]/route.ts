import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { csvSourceFolder } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().min(1).optional(),
  recursive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  const [updated] = await db.update(csvSourceFolder).set(parsed.data).where(eq(csvSourceFolder.id, id)).returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const action = 'enabled' in parsed.data
    ? (parsed.data.enabled ? 'csv_source_folder.enable' : 'csv_source_folder.disable')
    : 'csv_source_folder.update'

  await appendAuditEntry(db, {
    userId: user.id,
    action,
    targetType: 'csv_source_folder',
    targetId: id,
    metadata: parsed.data,
  })

  return NextResponse.json({ ok: true })
}

/**
 * Removes a folder and — via ON DELETE CASCADE — every file and indexed row
 * that came from it. No soft-delete/undo: the settings UI requires the
 * admin to type the folder's label back before this is called, given the
 * volume of PII a single delete can remove.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })

  const { id } = await params
  const [deleted] = await db.delete(csvSourceFolder).where(eq(csvSourceFolder.id, id)).returning()
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'csv_source_folder.delete',
    targetType: 'csv_source_folder',
    targetId: id,
    metadata: { path: deleted.path, label: deleted.label },
  })

  return NextResponse.json({ ok: true })
}
