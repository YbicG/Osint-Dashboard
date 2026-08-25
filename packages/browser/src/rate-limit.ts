/**
 * Simple per-key token bucket. One instance is shared across all connector
 * runs in a worker process; each connector's `rateLimitPerMinute` (from its
 * ConnectorMeta) becomes its bucket's refill rate. Deliberately in-process
 * only — if this ever needs to be enforced across multiple worker
 * processes, back it with a Redis token-bucket script instead.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; capacity: number; refillPerMs: number; lastRefill: number }>()

  configure(key: string, perMinute: number) {
    const capacity = Math.max(1, perMinute)
    this.buckets.set(key, {
      tokens: capacity,
      capacity,
      refillPerMs: capacity / 60_000,
      lastRefill: Date.now(),
    })
  }

  private refill(key: string) {
    const b = this.buckets.get(key)
    if (!b) return
    const now = Date.now()
    const elapsed = now - b.lastRefill
    b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerMs)
    b.lastRefill = now
  }

  /**
   * Resolves once a token is available, waiting as needed. Call before every
   * request to a rate-limited source. `perMinuteIfUnconfigured` registers the
   * bucket on first use (idempotent) so callers don't need a separate
   * configure() step; a bare `acquire(key)` falls back to a conservative
   * default if the bucket was never configured either way.
   */
  async acquire(key: string, perMinuteIfUnconfigured = 30): Promise<void> {
    if (!this.buckets.has(key)) this.configure(key, perMinuteIfUnconfigured)
    for (;;) {
      this.refill(key)
      const b = this.buckets.get(key)!
      if (b.tokens >= 1) {
        b.tokens -= 1
        return
      }
      const msPerToken = 1 / b.refillPerMs
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.ceil(msPerToken))))
    }
  }
}

export const globalRateLimiter = new RateLimiter()
