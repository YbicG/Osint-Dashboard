import { Queue } from 'bullmq'
import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379'
export const SEARCH_EXECUTION_QUEUE = 'search-execution'

export interface SearchExecutionJobData {
  searchId: string
}

// Mirrors apps/worker/src/queue/* — deliberately duplicated rather than a
// cross-app import (apps/web and apps/worker are siblings; sharing this
// would mean either app importing the other's internals). If this grows
// past "two small files," promote it to a `packages/queue` shared package.
let queue: Queue<SearchExecutionJobData> | null = null

export function getSearchExecutionQueue(): Queue<SearchExecutionJobData> {
  if (!queue) {
    queue = new Queue<SearchExecutionJobData>(SEARCH_EXECUTION_QUEUE, {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }),
    })
  }
  return queue
}

export function createSubscriberConnection(): IORedis {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
}

export function searchEventChannel(searchId: string): string {
  return `search:${searchId}:events`
}

// --- CSV Search indexing pipeline — mirrors apps/worker/src/queue/queues.ts ---

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
    csvScanQueue = new Queue<CsvScanJobData>(CSV_SCAN_QUEUE, {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }),
    })
  }
  return csvScanQueue
}
