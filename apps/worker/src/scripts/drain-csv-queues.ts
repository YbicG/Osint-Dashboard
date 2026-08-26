import '../load-env.js' // must stay the first import — see load-env.ts's doc comment
import { getCsvScanQueue, getCsvIndexQueue } from '../queue/queues'

/**
 * One-off safety valve for stopping a CSV bulk load mid-flight (see
 * docs/RUNBOOK.md "Bulk-loading very large CSV files"). Killing `pnpm dev`
 * while a `csv-index` job is actively running (indexCsvFile) does NOT
 * complete or remove that job from Redis — its lock simply expires. BullMQ's
 * default stalled-job recovery (maxStalledCount: 1) means the *next* worker
 * that starts up will detect the expired lock and automatically re-run that
 * exact job — and indexCsvFile()'s first statement is `DELETE FROM csv_record
 * WHERE file_id = ...`, so an unattended restart of `pnpm dev` silently wipes
 * and restarts whatever file was mid-load when you stopped it, with no
 * confirmation and no log line calling out that it happened.
 *
 * `Queue.obliterate({ force: true })` removes every job (waiting, active,
 * delayed, completed, failed) from the named queue, including active jobs
 * whose lock has expired — so nothing is left for a restarted worker to pick
 * up. Run this once, for both CSV queues, before starting the worker again
 * after an intentional mid-load stop. It does not touch already-committed
 * csv_record rows or csv_source_file status — only pending/stalled queue
 * state.
 */
async function main() {
  const scanQueue = getCsvScanQueue()
  const indexQueue = getCsvIndexQueue()

  await indexQueue.obliterate({ force: true })
  console.log('[drain-csv-queues] csv-index queue obliterated')

  await scanQueue.obliterate({ force: true })
  console.log('[drain-csv-queues] csv-scan queue obliterated')

  await indexQueue.close()
  await scanQueue.close()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[drain-csv-queues] failed:', err)
    process.exit(1)
  })
