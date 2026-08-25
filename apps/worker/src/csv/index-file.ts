import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Writable } from 'node:stream'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { parse } from 'csv-parse'
import { eq } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { pgClient } from '@osint/db'
import { csvSourceFile, csvRecord } from '@osint/db/schema'
import { detectSensitiveColumns } from '@osint/core'
import { detectDelimiter } from './detect-delimiter'

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

// Rows per COPY invocation. COPY FROM STDIN is one implicit transaction: a
// hard failure (e.g. a dropped connection) aborts whatever hasn't committed
// in the CURRENT chunk, not the whole file. Chunking bounds that blast
// radius to ~this many rows instead of up to the full file, while staying
// large enough that COPY's fixed per-invocation overhead stays negligible
// against the data volume. See docs/RUNBOOK.md "Bulk-loading very large CSV
// files" for the reasoning and the trade-offs below.
const COPY_CHUNK_ROWS = 500_000

// A fast local COPY write is usually accepted into the stream's buffer
// synchronously (writable.write() returns true), so `await writeLine(...)`
// resolves via an already-settled microtask rather than a real I/O wait --
// unlike the old batched-INSERT version, whose per-batch round trip to
// Postgres naturally yielded to Node's event loop. Without an explicit
// yield, a single large file's loop can run long enough to starve BullMQ's
// own (Redis-driven) job dispatch in this same process, so a second queued
// file never gets its processor invoked even with concurrency > 1 —
// observed directly: one file indexing while a second sat at `discovered`
// indefinitely. setImmediate forces a real event-loop turn periodically.
const YIELD_EVERY_ROWS = 2_000

/**
 * CSV-quotes a field per COPY's FORMAT csv rules: ALWAYS quoted (not just
 * when it contains a comma/quote/newline), with internal quotes doubled.
 * Always-quoting rather than only-when-needed means an empty string reads
 * back as an empty string ('""'), not as SQL NULL (COPY's csv format treats
 * a bare, unquoted empty field as NULL) -- search_text is NOT NULL.
 */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Streams one CSV file into `csv_record` via Postgres COPY rather than
 * batched INSERT -- at multi-hundred-million-row scale, per-statement
 * planning/parameter-binding overhead (even batched) is the dominant cost;
 * COPY sidesteps it. `ON_ERROR ignore` (Postgres 17+, confirmed in use --
 * see infra/docker-compose.yml's `pgvector/pgvector:pg17` image) tolerates
 * server-side data-conversion failures within a chunk without aborting it.
 * Rows that fail to parse as CSV in the first place are skipped
 * client-side, before ever reaching COPY, exactly as before.
 *
 * Trade-offs versus the previous batched-INSERT version, both accepted
 * deliberately for this scale -- see docs/RUNBOOK.md for the full writeup:
 *   - rowCount/errorRowCount become approximate: they reflect what this
 *     process attempted to write, not a confirmed post-COPY count from
 *     Postgres (an extra COUNT(*) per chunk would itself get slower as the
 *     table grows, working against the very thing this change is for).
 *   - a hard COPY-chunk failure can lose up to COPY_CHUNK_ROWS rows of
 *     progress, not just the current small batch.
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
  let chunkRows = 0

  // Chunk state -- one persistent error listener per chunk (not per row) so
  // a server-side abort surfaces without EventEmitter churn at billions of
  // writes/sec scale.
  let writable: Writable | null = null
  let chunkError: Error | null = null

  async function openChunk() {
    const w = await pgClient`copy csv_record (file_id, folder_id, row_number, data, search_text) from stdin with (format csv, on_error ignore)`.writable()
    chunkError = null
    w.on('error', (err: Error) => {
      chunkError = err
    })
    writable = w
    chunkRows = 0
  }

  /** Writes one CSV line, respecting Writable backpressure via drain. */
  function writeLine(line: string): Promise<void> {
    if (chunkError) return Promise.reject(chunkError)
    const w = writable!
    if (w.write(line)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      w.once('drain', () => (chunkError ? reject(chunkError) : resolve()))
    })
  }

  function closeChunk(): Promise<void> {
    const w = writable
    writable = null
    if (!w) return Promise.resolve()
    return new Promise((resolve, reject) => {
      w.end(() => (chunkError ? reject(chunkError) : resolve()))
    })
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
    await openChunk()
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

        const line =
          [csvField(fileId), csvField(file.folderId), csvField(String(rowNumber)), csvField(JSON.stringify(row)), csvField(searchText)].join(',') +
          '\n'

        await writeLine(line)
        chunkRows++
        indexedCount++

        if (chunkRows >= COPY_CHUNK_ROWS) {
          await closeChunk()
          await db.update(csvSourceFile).set({ rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
          await openChunk()
        }

        if (rowNumber % YIELD_EVERY_ROWS === 0) await yieldToEventLoop()
      } catch {
        errorCount++
      }
    }
    await closeChunk()
    await db.update(csvSourceFile).set({ status: 'indexed', indexedAt: new Date(), rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
  } catch (err) {
    // Stream itself failed mid-file (e.g. binary garbage, or the current
    // COPY chunk aborted) -- keep whatever prior chunks already committed
    // rather than rolling them back; a partial index beats none for search
    // purposes, and the error status tells the admin to look.
    await closeChunk().catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    await db.update(csvSourceFile).set({ status: 'error', errorMessage: message, rowCount: indexedCount, errorRowCount: errorCount }).where(eq(csvSourceFile.id, fileId))
  }
}
