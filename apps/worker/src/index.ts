import './load-env.js' // must stay the first import — see load-env.ts's doc comment
import { Worker } from 'bullmq'
import { db } from '@osint/db'
import { createRedisConnection } from './queue/connection'
import { SEARCH_EXECUTION_QUEUE, type SearchExecutionJobData, CSV_SCAN_QUEUE, type CsvScanJobData, CSV_INDEX_QUEUE, type CsvIndexJobData } from './queue/queues'
import { runSearch } from './ingest/run-search'
import { syncSourceRegistry } from './sources/sync'
import { scanFolder } from './csv/scan-folder'
import { indexCsvFile } from './csv/index-file'

const redis = createRedisConnection()

const { created, updated } = await syncSourceRegistry(db)
console.log(`[worker] source registry synced: ${created} created, ${updated} updated`)

const worker = new Worker<SearchExecutionJobData>(
  SEARCH_EXECUTION_QUEUE,
  async (job) => {
    console.log(`[worker] running search ${job.data.searchId}`)
    await runSearch(db, redis, job.data.searchId)
    console.log(`[worker] finished search ${job.data.searchId}`)
  },
  {
    connection: createRedisConnection(),
    concurrency: 4, // concurrent *searches* — each search internally fans out across connectors (see CONNECTOR_CONCURRENCY in run-search.ts)
  },
)

worker.on('failed', (job, err) => {
  console.error(`[worker] search ${job?.data.searchId} failed:`, err)
})

// CSV Search indexing pipeline — see packages/db/src/schema/csv-search.ts
// and apps/worker/src/csv/*. Low concurrency on both: scanning is I/O-light
// but indexing does bulk inserts against the same Postgres instance the
// search worker above also writes to.
const csvScanWorker = new Worker<CsvScanJobData>(
  CSV_SCAN_QUEUE,
  async (job) => {
    console.log(`[worker] scanning csv folder ${job.data.folderId}`)
    await scanFolder(db, job.data.folderId)
  },
  { connection: createRedisConnection(), concurrency: 2 },
)
csvScanWorker.on('failed', (job, err) => {
  console.error(`[worker] csv folder scan ${job?.data.folderId} failed:`, err)
})

const csvIndexWorker = new Worker<CsvIndexJobData>(
  CSV_INDEX_QUEUE,
  async (job) => {
    console.log(`[worker] indexing csv file ${job.data.fileId}`)
    await indexCsvFile(db, job.data.fileId)
    console.log(`[worker] finished indexing csv file ${job.data.fileId}`)
  },
  { connection: createRedisConnection(), concurrency: 3 },
)
csvIndexWorker.on('failed', (job, err) => {
  console.error(`[worker] csv file index ${job?.data.fileId} failed:`, err)
})

console.log('[worker] listening on queues', SEARCH_EXECUTION_QUEUE, CSV_SCAN_QUEUE, CSV_INDEX_QUEUE)

async function shutdown() {
  console.log('[worker] shutting down...')
  await Promise.all([worker.close(), csvScanWorker.close(), csvIndexWorker.close()])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
