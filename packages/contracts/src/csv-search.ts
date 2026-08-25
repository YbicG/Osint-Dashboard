import { z } from 'zod'

/** Lifecycle of one admin-configured source folder's most recent scan pass. */
export const CsvFolderScanStatus = z.enum(['idle', 'scanning', 'error'])
export type CsvFolderScanStatus = z.infer<typeof CsvFolderScanStatus>

/**
 * Lifecycle of one discovered CSV file within a folder, from first sight
 * through indexing. `removed` is transient in practice — a file that drops
 * out of a scan pass is hard-deleted along with its indexed rows rather than
 * lingering in this state (see apps/worker/src/csv/scan-folder.ts) — but the
 * value still exists so an in-flight job can report it before the delete.
 */
export const CsvFileStatus = z.enum(['discovered', 'queued', 'indexing', 'indexed', 'error', 'removed'])
export type CsvFileStatus = z.infer<typeof CsvFileStatus>
