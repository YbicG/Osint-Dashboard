import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379'

/** Shared ioredis connection for BullMQ (requires maxRetriesPerRequest: null per BullMQ's docs) and for the pub/sub channel that fans SSE events out to the web app. */
export function createRedisConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
}
