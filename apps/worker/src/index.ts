import { Worker } from 'bullmq'
import { db } from '@osint/db'
import { createRedisConnection } from './queue/connection'
import { SEARCH_EXECUTION_QUEUE, type SearchExecutionJobData } from './queue/queues'
import { runSearch } from './ingest/run-search'

const redis = createRedisConnection()

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

console.log('[worker] listening on queue', SEARCH_EXECUTION_QUEUE)

async function shutdown() {
  console.log('[worker] shutting down...')
  await worker.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
