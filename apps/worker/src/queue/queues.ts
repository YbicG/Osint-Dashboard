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
