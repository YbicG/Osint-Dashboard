import { describe, it, expect } from 'vitest'
import { CookieJar, type CookieJarEntry } from '../cookies/jar'

function makeEntry(id: string, overrides: Partial<CookieJarEntry> = {}): CookieJarEntry {
  return {
    id,
    platform: 'example.com',
    label: `account-${id}`,
    cookies: [],
    addedAt: new Date(),
    lastUsedAt: null,
    lastHealthCheckAt: null,
    status: 'healthy',
    consecutiveFailures: 0,
    ...overrides,
  }
}

describe('CookieJar', () => {
  it('returns null (== go logged-out) for a platform with no entries', () => {
    const jar = new CookieJar()
    expect(jar.acquire('nowhere.com')).toBeNull()
  })

  it('prefers the least-recently-used healthy entry', () => {
    const jar = new CookieJar()
    const older = makeEntry('older', { lastUsedAt: new Date('2020-01-01') })
    const newer = makeEntry('newer', { lastUsedAt: new Date('2025-01-01') })
    jar.add(newer)
    jar.add(older)

    const chosen = jar.acquire('example.com')
    expect(chosen?.id).toBe('older')
  })

  it('never returns a banned entry', () => {
    const jar = new CookieJar()
    jar.add(makeEntry('banned', { status: 'banned' }))
    expect(jar.acquire('example.com')).toBeNull()
  })

  it('demotes to degraded after 1-2 failures (no longer selected by acquire), bans on the 3rd', () => {
    const jar = new CookieJar()
    jar.add(makeEntry('flaky'))

    jar.reportFailure('example.com', 'flaky')
    expect(jar.listForPlatform('example.com')[0]?.status).toBe('degraded')
    // acquire() only ever selects 'healthy' or 'unknown' entries — a degraded
    // account is benched (not reused) until reportSuccess proves it's good
    // again, it is not simply "still usable."
    expect(jar.acquire('example.com')).toBeNull()

    jar.reportFailure('example.com', 'flaky')
    jar.reportFailure('example.com', 'flaky')
    expect(jar.listForPlatform('example.com')[0]?.status).toBe('banned')
    expect(jar.acquire('example.com')).toBeNull()
  })

  it('reportSuccess clears failures and restores healthy status', () => {
    const jar = new CookieJar()
    jar.add(makeEntry('recovering'))
    jar.reportFailure('example.com', 'recovering')
    jar.reportFailure('example.com', 'recovering')
    jar.reportSuccess('example.com', 'recovering')

    const entry = jar.listForPlatform('example.com')[0]!
    expect(entry.status).toBe('healthy')
    expect(entry.consecutiveFailures).toBe(0)
  })

  it('remove() deletes only the targeted entry', () => {
    const jar = new CookieJar()
    jar.add(makeEntry('keep'))
    jar.add(makeEntry('drop'))
    jar.remove('example.com', 'drop')
    expect(jar.listForPlatform('example.com').map((e) => e.id)).toEqual(['keep'])
  })

  it('listAll() aggregates entries across every platform', () => {
    const jar = new CookieJar()
    jar.add(makeEntry('a', { platform: 'x.com' }))
    jar.add(makeEntry('b', { platform: 'y.com' }))
    expect(jar.listAll()).toHaveLength(2)
  })
})
