export interface ProxyEndpoint {
  server: string // e.g. "http://proxy.example.com:8080" or "socks5://..."
  username?: string
  password?: string
  /** Coarse geography tag, used when a connector needs a specific-state exit (e.g. a state portal that geo-blocks). */
  region?: string
}

export interface ProxyHealth {
  endpoint: ProxyEndpoint
  consecutiveFailures: number
  lastUsedAt: number | null
  bannedUntil: number | null
}

/**
 * Rotating proxy pool with basic health tracking. Reads a static list from
 * PROXY_POOL_URL (a JSON array of ProxyEndpoint) if configured; with no
 * config, `acquire()` returns null and callers fall back to a direct
 * connection — residential proxy rotation is additive infrastructure, not a
 * hard requirement to run the platform.
 */
export class ProxyPool {
  private pool: ProxyHealth[] = []
  private cursor = 0

  configure(endpoints: ProxyEndpoint[]) {
    this.pool = endpoints.map((endpoint) => ({ endpoint, consecutiveFailures: 0, lastUsedAt: null, bannedUntil: null }))
  }

  get size(): number {
    return this.pool.length
  }

  /** Round-robins over healthy (non-banned) endpoints. Returns null if the pool is empty or all endpoints are currently banned. */
  acquire(region?: string): ProxyEndpoint | null {
    if (this.pool.length === 0) return null
    const now = Date.now()
    const candidates = this.pool.filter((p) => (!p.bannedUntil || p.bannedUntil < now) && (!region || p.endpoint.region === region))
    if (candidates.length === 0) return null
    this.cursor = (this.cursor + 1) % candidates.length
    const chosen = candidates[this.cursor]!
    chosen.lastUsedAt = now
    return chosen.endpoint
  }

  reportSuccess(endpoint: ProxyEndpoint) {
    const entry = this.pool.find((p) => p.endpoint.server === endpoint.server)
    if (entry) entry.consecutiveFailures = 0
  }

  /** Three consecutive failures (typically 403/429/CAPTCHA walls) puts an endpoint in a 15-minute timeout. */
  reportFailure(endpoint: ProxyEndpoint) {
    const entry = this.pool.find((p) => p.endpoint.server === endpoint.server)
    if (!entry) return
    entry.consecutiveFailures += 1
    if (entry.consecutiveFailures >= 3) {
      entry.bannedUntil = Date.now() + 15 * 60_000
    }
  }
}

export function loadProxyPoolFromEnv(): ProxyPool {
  const pool = new ProxyPool()
  const raw = process.env.PROXY_POOL_JSON
  if (raw) {
    try {
      const endpoints = JSON.parse(raw) as ProxyEndpoint[]
      pool.configure(endpoints)
    } catch {
      // malformed config should not crash the worker — just run without a proxy pool
    }
  }
  return pool
}
