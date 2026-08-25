import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { parse } from 'csv-parse'
import { eq } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { csvSourceFile, csvRecord } from '@osint/db/schema'
import { detectSensitiveColumns } from '@osint/core'
import { detectDelimiter } from './detect-delimiter'

const BATCH_SIZE = 500

/** Reads just the first line of a file to sniff its delimiter, without pulling the whole file into memory. */
async function readFirstLine(filePath: string): Promise<string> {
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }) })
  try {
    for await (const line of rl) return line
    return ''
  } finally {
    rl.close()
  }
}

/**
 * Streams one CSV file into `csv_record`, batching inserts so memory stays
 * bounded regardless of file size (Node's stream backpressure throttles
 * reading — the file is never buffered whole). Malformed individual rows
 * are skipped and counted rather than aborting the job; a hard stream error
 * keeps whatever was already flushed and marks the file `error` rather than
 * rolling back prior progress.
 */
export async function indexCsvFile(db: Database, fileId: string): Promise<void> {
  const [file] = await db.select().from(csvSourceFile).where(eq(csvSourceFile.id, fileId))
  if (!file) return

  await db.delete(csvRecord).where(eq(csvRecord.fileId, fileId))
  await db.update(csvSourceFile).set({ status: 'indexing', rowCount: 0, errorRowCount: 0, errorMessage: null }).where(eq(csvSourceFile.id, fileId))

  const firstLine = await readFirstLine(file.absolutePath)
  const delimiter = detectDelimiter(firstLine)

  let columns: string[] = []
  let sensitiveColumns: string[] = []
  let rowNumber = 0
  let indexedCount = 0
  let errorCount = 0
  let batch: Array<typeof csvRecord.$inferInsert> = []

  async function flush() {
    if (batch.length === 0) return
    await db.insert(csvRecord).values(batch)
    indexedCount += batch.length
    await db.update(csvSourceFile).set({ rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
    batch = []
  }

  const parser = createReadStream(file.absolutePath, { encoding: 'utf8' }).pipe(
    parse({
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter,
    }),
  )

  try {
    for await (const row of parser as AsyncIterable<Record<string, string | null>>) {
      rowNumber++
      try {
        if (columns.length === 0) {
          columns = Object.keys(row)
          sensitiveColumns = detectSensitiveColumns(columns)
          await db.update(csvSourceFile).set({ columns, sensitiveColumns, delimiter }).where(eq(csvSourceFile.id, fileId))
        }

        const searchText = Object.values(row)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(' ')
          .toLowerCase()

        batch.push({ fileId, folderId: file.folderId, rowNumber, data: row, searchText })
        if (batch.length >= BATCH_SIZE) await flush()
      } catch {
        errorCount++
      }
    }
    await flush()
    await db.update(csvSourceFile).set({ status: 'indexed', indexedAt: new Date(), rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
  } catch (err) {
    // Stream itself failed mid-file (e.g. binary garbage) — keep whatever
    // was already flushed rather than rolling it back; a partial index beats
    // none for search purposes, and the error status tells the admin to look.
    await flush().catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    await db.update(csvSourceFile).set({ status: 'error', errorMessage: message, rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
  }
}
