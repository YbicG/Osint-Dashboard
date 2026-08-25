import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sql, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { csvSourceFolder, csvSourceFile } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'
import { getCsvScanQueue } from '@/server/queue'

/**
 * Folder list + per-folder aggregates (file/row/error counts) for the CSV
 * Sources settings tab, each with its discovered files embedded so an admin
 * can see per-file status/columns/errors without a drill-down page. Open to
 * any authenticated role (read-only); only POST/PATCH/DELETE are admin-gated
 * (see [id]/route.ts) — matches the admin/sources precedent where source
 * health is viewable more broadly than it's editable.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const folders = await db.select({
    id: csvSourceFolder.id,
    path: csvSourceFolder.path,
    label: csvSourceFolder.label,
    recursive: csvSourceFolder.recursive,
    enabled: csvSourceFolder.enabled,
    createdAt: csvSourceFolder.createdAt,
    lastScanAt: csvSourceFolder.lastScanAt,
    lastScanStatus: csvSourceFolder.lastScanStatus,
    lastScanError: csvSourceFolder.lastScanError,
    fileCount: sql<number>`count(${csvSourceFile.id})`.mapWith(Number),
    indexedFileCount: sql<number>`count(*) filter (where ${csvSourceFile.status} = 'indexed')`.mapWith(Number),
    errorFileCount: sql<number>`count(*) filter (where ${csvSourceFile.status} = 'error')`.mapWith(Number),
    totalRows: sql<number>`coalesce(sum(${csvSourceFile.rowCount}), 0)`.mapWith(Number),
    totalErrorRows: sql<number>`coalesce(sum(${csvSourceFile.errorRowCount}), 0)`.mapWith(Number),
  })
    .from(csvSourceFolder)
    .leftJoin(csvSourceFile, eq(csvSourceFile.folderId, csvSourceFolder.id))
    .groupBy(csvSourceFolder.id)
    .orderBy(desc(csvSourceFolder.createdAt))

  const files = await db.select().from(csvSourceFile)
  const filesByFolder = new Map<string, typeof files>()
  for (const file of files) {
    const list = filesByFolder.get(file.folderId) ?? []
    list.push(file)
    filesByFolder.set(file.folderId, list)
  }

  return NextResponse.json({
    folders: folders.map((folder) => ({ ...folder, files: filesByFolder.get(folder.id) ?? [] })),
  })
}

const CreateFolderSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  recursive: z.boolean().optional().default(false),
})

/**
 * Registers a new source folder. Any absolute path on the server's
 * filesystem is allowed — no root-containment check — since this is an
 * admin-only, already-trusted action, not something exposed to analysts.
 * Still validated as an existing, readable directory before it's accepted,
 * so a typo doesn't silently sit there forever failing scans.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = CreateFolderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const absolutePath = path.resolve(parsed.data.path)
  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `${absolutePath} is not a directory` }, { status: 400 })
    }
    await fs.access(absolutePath, fs.constants.R_OK)
  } catch {
    return NextResponse.json({ error: `Cannot read directory: ${absolutePath}` }, { status: 400 })
  }

  let created: typeof csvSourceFolder.$inferSelect
  try {
    const [row] = await db.insert(csvSourceFolder).values({
      path: absolutePath,
      label: parsed.data.label,
      recursive: parsed.data.recursive,
      createdByUserId: user.id,
    }).returning()
    created = row!
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A folder with this path is already configured' }, { status: 409 })
    }
    throw err
  }

  await appendAuditEntry(db, {
    userId: user.id,
    action: 'csv_source_folder.create',
    targetType: 'csv_source_folder',
    targetId: created.id,
    metadata: { path: absolutePath, label: parsed.data.label, recursive: parsed.data.recursive },
  })

  await getCsvScanQueue().add('scan-folder', { folderId: created.id })

  return NextResponse.json({ id: created.id })
}
