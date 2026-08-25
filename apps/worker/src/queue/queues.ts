import { Queue } from 'bullmq'
import { createRedisConnection } from './connection'

export const SEARCH_EXECUTION_QUEUE = 'search-execution'

export interface SearchExecutionJobData {
  searchId: string
}

let queue: Queue<SearchExecutionJobData> | null = null

/** Lazily-constructed singleton — the web app's API routes import this to enqueue new searches without needing their own BullMQ Worker. */
export function getSearchExecutionQueue(): Queue<SearchExecutionJobData> {
  if (!queue) {
    queue = new Queue<SearchExecutionJobData>(SEARCH_EXECUTION_QUEUE, { connection: createRedisConnection() })
  }
  return queue
}

// --- CSV Search indexing pipeline ---
// Two queues, not one: scanning (readdir+stat, cheap) and indexing (streaming
// parse + batch insert, heavier) have different cost profiles and failure
// isolation needs — one huge/malformed file's indexing shouldn't block
// discovery of other files. See apps/worker/src/csv/{scan-folder,index-file}.ts.

export const CSV_SCAN_QUEUE = 'csv-scan'
export interface CsvScanJobData {
  folderId: string
}

export const CSV_INDEX_QUEUE = 'csv-index'
export interface CsvIndexJobData {
  fileId: string
}

let csvScanQueue: Queue<CsvScanJobData> | null = null
export function getCsvScanQueue(): Queue<CsvScanJobData> {
  if (!csvScanQueue) {
    csvScanQueue = new Queue<CsvScanJobData>(CSV_SCAN_QUEUE, { connection: createRedisConnection() })
  }
  return csvScanQueue
}

let csvIndexQueue: Queue<CsvIndexJobData> | null = null
export function getCsvIndexQueue(): Queue<CsvIndexJobData> {
  if (!csvIndexQueue) {
    csvIndexQueue = new Queue<CsvIndexJobData>(CSV_INDEX_QUEUE, { connection: createRedisConnection() })
  }
  return csvIndexQueue
}
