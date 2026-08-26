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
 * arbitrary-shape pattern elsewhere in this codebase). Always populated,
 * always what the record panel renders — unaffected by anything below.
 *
 * The columns below are a DIFFERENT thing: structured search keys,
 * extracted and normalized from `data` at index time via
 * packages/core/src/pii/lookup-fields.ts's header-alias detection (e.g. a
 * source column named "phone1" or "telephone" both map to `phone`,
 * digits-only). This replaced an earlier generic
 * search_text/search_vector(tsvector)/trigram design — see
 * docs/RUNBOOK.md's "Bulk-loading very large CSV files" for why: at
 * billion-row scale, storing every value twice (once in `data`, again
 * concatenated into a searchable blob) plus a tsvector column was most of
 * the storage cost, and trigram-over-a-whole-row-blob is expensive to
 * build/maintain for a query pattern ("find this SSN/name/phone") that's
 * actually exact/prefix matching on specific fields, not free-text search.
 * Nullable — a file whose headers don't match any recognized alias just
 * leaves these null for its rows; that data is still viewable via `data`,
 * just not reachable through the fast structured search path (documented
 * limitation, not a bug).
 */
export const csvRecord = pgTable('csv_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id').notNull().references(() => csvSourceFile.id, { onDelete: 'cascade' }),
  // Denormalized from csvSourceFile so the hot search-query path can filter
  // on folder.enabled with one join instead of two.
  folderId: uuid('folder_id').notNull().references(() => csvSourceFolder.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  data: jsonb('data').$type<Record<string, string | null>>().notNull(),
  ssn: text('ssn'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  dob: text('dob'),
  phone: text('phone'),
  zip: text('zip'),
  city: text('city'),
  state: text('state'),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('csv_record_file_idx').on(t.fileId),
  index('csv_record_folder_idx').on(t.folderId),
  // B-tree, not GIN -- these back exact/prefix lookups (the actual query
  // pattern here), which B-tree does natively and far more cheaply than
  // GIN at this row count. Only `ssn` additionally gets a trigram index
  // (hand-written migration) for substring/suffix matching (e.g. "last 4
  // digits") -- affordable there specifically because it's a single small
  // structured column, not a whole-row blob.
  //
  // last_name/first_name are declared here as plain btree for drizzle-kit's
  // sake, but the indexes actually applied to the database use the
  // text_pattern_ops operator class instead (see
  // packages/db/migrations/0010_csv_record_name_text_pattern_ops.sql) -- a
  // plain btree index can only accelerate `LIKE 'prefix%'` when the
  // column's collation is `C`, which this database is not (the official
  // Postgres image defaults to en_US.utf8), so without text_pattern_ops
  // apps/web/src/app/api/csv-search/route.ts's prefix search on these two
  // columns silently falls back to a full table scan despite the index
  // existing. Drizzle has no first-class opclass API in this version, so
  // this is enforced by the hand-written migration, not by `db:generate`.
  index('csv_record_ssn_idx').on(t.ssn),
  index('csv_record_last_name_idx').on(t.lastName),
  index('csv_record_first_name_idx').on(t.firstName),
  index('csv_record_phone_idx').on(t.phone),
  index('csv_record_zip_idx').on(t.zip),
  index('csv_record_dob_idx').on(t.dob),
])
