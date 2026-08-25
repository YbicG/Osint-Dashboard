import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../rate-limit'

describe('RateLimiter', () => {
  it('allows immediate acquisition up to the configured capacity', async () => {
    const limiter = new RateLimiter()
    limiter.configure('test-source', 60) // 60/min = 1/sec, capacity starts full

    const start = Date.now()
    // Capacity starts full, so the first N acquires (N = capacity) should not block meaningfully.
    await limiter.acquire('test-source')
    await limiter.acquire('test-source')
    await limiter.acquire('test-source')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  it('auto-configures an unconfigured key with a sane default rather than throwing', async () => {
    const limiter = new RateLimiter()
    await expect(limiter.acquire('never-configured')).resolves.toBeUndefined()
  })

  it('tracks separate buckets per key independently', async () => {
    const limiter = new RateLimiter()
    limiter.configure('a', 120)
    limiter.configure('b', 1) // very slow bucket

    // Draining key 'b' down to empty should not affect key 'a's independent bucket.
    await limiter.acquire('b')
    const start = Date.now()
    await limiter.acquire('a')
    expect(Date.now() - start).toBeLessThan(100)
  })
})
