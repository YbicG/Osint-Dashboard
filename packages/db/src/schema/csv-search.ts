import { pgTable, uuid, text, boolean, timestamp, integer, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { csvFolderScanStatusEnum, csvFileStatusEnum } from './enums'
import { appUser } from './org'

/**
 * One admin-configured directory the CSV Search feature is allowed to read.
 * `path` is an absolute server filesystem path with no root-containment
 * check — pointing this at a folder is an admin-only, already-trusted
 * action (see apps/web/src/app/api/admin/csv-sources/route.ts), not
 * something exposed to analysts. The worker (apps/worker/src/csv/*) is the
 * only thing that ever reads from `path` on disk.
 */
export const csvSourceFolder = pgTable('csv_source_folder', {
  id: uuid('id').primaryKey().defaultRandom(),
  path: text('path').notNull().unique(),
  label: text('label').notNull(),
  recursive: boolean('recursive').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  lastScanStatus: csvFolderScanStatusEnum('last_scan_status').notNull().default('idle'),
  lastScanError: text('last_scan_error'),
})

/**
 * One CSV file discovered under a folder. Tracks enough about the file
 * itself (size/mtime, delimiter, header list, which headers look sensitive)
 * for the settings UI to explain what's indexed without a human opening the
 * raw file. `(folderId, relativePath)` is the file's stable identity across
 * rescans — content changes update the row in place rather than creating a
 * new one, so `csvRecord` rows can be deleted-and-reinserted per file.
 */
export const csvSourceFile = pgTable('csv_source_file', {
  id: uuid('id').primaryKey().defaultRandom(),
  folderId: uuid('folder_id').notNull().references(() => csvSourceFolder.id, { onDelete: 'cascade' }),
  relativePath: text('relative_path').notNull(),
  absolutePath: text('absolute_path').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  fileMtimeMs: timestamp('file_mtime_ms', { withTimezone: true }).notNull(),
  status: csvFileStatusEnum('status').notNull().default('discovered'),
  rowCount: integer('row_count').notNull().default(0),
  errorRowCount: integer('error_row_count').notNull().default(0),
  columns: jsonb('columns').$type<string[]>().notNull().default([]),
  sensitiveColumns: jsonb('sensitive_columns').$type<string[]>().notNull().default([]),
  delimiter: text('delimiter').notNull().default(','),
  errorMessage: text('error_message'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  // Bumped to the scan's start time every pass a file is seen; a row whose
  // lastSeenAt predates the current pass was not found on disk this time,
  // which is how scan-folder.ts detects (and hard-deletes) removed files.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('csv_source_file_folder_relpath_uidx').on(t.folderId, t.relativePath),
  index('csv_source_file_folder_idx').on(t.folderId),
  index('csv_source_file_status_idx').on(t.status),
])

/**
 * One indexed CSV row. `data` holds the row's actual columns verbatim,
 * keyed by whatever headers that file used — deliberately not a fixed
 * schema (real-world "authorized CSV files" vary source to source; see
 * packages/db/src/schema/claim.ts's `value` jsonb column for the same
 * arbitrary-shape pattern elsewhere in this codebase).
 *
 * `searchText` is every value concatenated and lowercased at index time
 * (apps/worker/src/csv/index-file.ts) — it backs both the full-text
 * (`search_vector`, a generated tsvector column) and trigram indexes added
 * by the hand-written packages/db/migrations/000X_csv_search_indexes.sql
 * migration, since Drizzle Kit here has no first-class support for
 * generated columns. Sensitive values (SSNs, etc.) ARE included in
 * searchText — masking is a display-time concern only (see
 * packages/core/src/pii/sensitive-columns.ts); an analyst must still be
 * able to search *by* an SSN to find the record it belongs to.
 */
export const csvRecord = pgTable('csv_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id').notNull().references(() => csvSourceFile.id, { onDelete: 'cascade' }),
  // Denormalized from csvSourceFile so the hot search-query path can filter
  // on folder.enabled with one join instead of two.
  folderId: uuid('folder_id').notNull().references(() => csvSourceFolder.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  data: jsonb('data').$type<Record<string, string | null>>().notNull(),
  searchText: text('search_text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('csv_record_file_idx').on(t.fileId),
  index('csv_record_folder_idx').on(t.folderId),
])
