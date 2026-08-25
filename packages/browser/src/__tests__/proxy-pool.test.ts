import { describe, it, expect } from 'vitest'
import { ProxyPool } from '../proxy/pool'

describe('ProxyPool', () => {
  it('returns null when unconfigured', () => {
    const pool = new ProxyPool()
    expect(pool.acquire()).toBeNull()
    expect(pool.size).toBe(0)
  })

  it('round-robins across configured endpoints', () => {
    const pool = new ProxyPool()
    pool.configure([
      { server: 'http://proxy-a:8080' },
      { server: 'http://proxy-b:8080' },
      { server: 'http://proxy-c:8080' },
    ])
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const p = pool.acquire()
      expect(p).not.toBeNull()
      seen.add(p!.server)
    }
    expect(seen.size).toBe(3)
  })

  it('filters by region when requested', () => {
    const pool = new ProxyPool()
    pool.configure([
      { server: 'http://us-proxy:8080', region: 'US' },
      { server: 'http://eu-proxy:8080', region: 'EU' },
    ])
    for (let i = 0; i < 4; i++) {
      const p = pool.acquire('US')
      expect(p?.region).toBe('US')
    }
  })

  it('bans an endpoint after 3 consecutive failures and stops returning it', () => {
    const pool = new ProxyPool()
    const endpoint = { server: 'http://flaky:8080' }
    pool.configure([endpoint])

    pool.reportFailure(endpoint)
    expect(pool.acquire()).not.toBeNull() // still healthy after 1 failure
    pool.reportFailure(endpoint)
    expect(pool.acquire()).not.toBeNull() // still healthy after 2 failures
    pool.reportFailure(endpoint)
    expect(pool.acquire()).toBeNull() // banned after 3rd consecutive failure
  })

  it('resets the failure count on a reported success', () => {
    const pool = new ProxyPool()
    const endpoint = { server: 'http://recovering:8080' }
    pool.configure([endpoint])

    pool.reportFailure(endpoint)
    pool.reportFailure(endpoint)
    pool.reportSuccess(endpoint)
    pool.reportFailure(endpoint)
    pool.reportFailure(endpoint)
    // Only 2 consecutive failures since the reset — should still be healthy.
    expect(pool.acquire()).not.toBeNull()
  })
})
