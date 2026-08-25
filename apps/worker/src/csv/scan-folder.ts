import { promises as fs } from 'node:fs'
import path from 'node:path'
import { and, eq, lt } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { csvSourceFolder, csvSourceFile } from '@osint/db/schema'
import { appendAuditEntry } from '@osint/core'
import { getCsvIndexQueue } from '../queue/queues'

const CSV_EXTENSION = /\.csv$/i

/**
 * Discovers CSV files under one configured folder, diffs them against what
 * was seen last pass, and enqueues indexing for anything new or changed.
 * Never throws out of the job — an unreadable folder is a visible error
 * state (`lastScanStatus`), not a crashed worker, so the admin UI's poll can
 * show exactly what's wrong instead of a silent stall.
 */
export async function scanFolder(db: Database, folderId: string): Promise<void> {
  const [folder] = await db.select().from(csvSourceFolder).where(eq(csvSourceFolder.id, folderId))
  if (!folder || !folder.enabled) return

  await db.update(csvSourceFolder).set({ lastScanStatus: 'scanning', lastScanError: null }).where(eq(csvSourceFolder.id, folderId))
  const scanStartedAt = new Date()

  let entries: string[]
  try {
    const stat = await fs.stat(folder.path)
    if (!stat.isDirectory()) throw new Error(`${folder.path} is not a directory`)

    const dirents = await fs.readdir(folder.path, { recursive: folder.recursive, withFileTypes: true })
    entries = dirents
      .filter((d) => d.isFile() && CSV_EXTENSION.test(d.name))
      .map((d) => path.join(d.parentPath ?? folder.path, d.name))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(csvSourceFolder).set({ lastScanStatus: 'error', lastScanError: message, lastScanAt: new Date() }).where(eq(csvSourceFolder.id, folderId))
    return
  }

  for (const absolutePath of entries) {
    const relativePath = path.relative(folder.path, absolutePath)
    const stat = await fs.stat(absolutePath)
    const [existing] = await db.select().from(csvSourceFile)
      .where(and(eq(csvSourceFile.folderId, folderId), eq(csvSourceFile.relativePath, relativePath)))

    if (!existing) {
      const [inserted] = await db.insert(csvSourceFile).values({
        folderId,
        relativePath,
        absolutePath,
        fileSizeBytes: stat.size,
        fileMtimeMs: new Date(stat.mtimeMs),
        status: 'discovered',
        lastSeenAt: scanStartedAt,
      }).returning()
      await getCsvIndexQueue().add('index-file', { fileId: inserted!.id })
      continue
    }

    const changed = existing.fileSizeBytes !== stat.size || existing.fileMtimeMs.getTime() !== Math.floor(stat.mtimeMs)
    if (changed) {
      await db.update(csvSourceFile).set({
        fileSizeBytes: stat.size,
        fileMtimeMs: new Date(stat.mtimeMs),
        status: 'discovered',
        lastSeenAt: scanStartedAt,
      }).where(eq(csvSourceFile.id, existing.id))
      await getCsvIndexQueue().add('index-file', { fileId: existing.id })
    } else {
      await db.update(csvSourceFile).set({ lastSeenAt: scanStartedAt }).where(eq(csvSourceFile.id, existing.id))
    }
  }

  // Anything under this folder not touched this pass is gone from disk —
  // hard-delete it (cascades to its csv_record rows) so the search index
  // never outlives the source file's actual presence/authorization.
  const removed = await db.select({ id: csvSourceFile.id, relativePath: csvSourceFile.relativePath })
    .from(csvSourceFile)
    .where(and(eq(csvSourceFile.folderId, folderId), lt(csvSourceFile.lastSeenAt, scanStartedAt)))

  for (const file of removed) {
    await db.delete(csvSourceFile).where(eq(csvSourceFile.id, file.id))
    // Attributed to the folder's creator — a scan pass isn't necessarily
    // triggered by a specific interactive user (it also runs on folder
    // creation), so there's no other reliable "who" to attach here.
    await appendAuditEntry(db, {
      userId: folder.createdByUserId,
      action: 'csv_source_file.removed',
      targetType: 'csv_source_file',
      targetId: file.id,
      metadata: { folderId, relativePath: file.relativePath },
    })
  }

  await db.update(csvSourceFolder).set({ lastScanStatus: 'idle', lastScanAt: new Date() }).where(eq(csvSourceFolder.id, folderId))
}
