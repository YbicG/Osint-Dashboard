import type { Cookie } from 'playwright'

export interface CookieJarEntry {
  id: string
  platform: string // e.g. "x.com", "instagram.com" — matches connector-declared platform keys
  label: string // user-facing name so an operator can tell accounts apart in the admin console
  cookies: Cookie[]
  addedAt: Date
  lastUsedAt: Date | null
  lastHealthCheckAt: Date | null
  status: 'healthy' | 'degraded' | 'banned' | 'unknown'
  consecutiveFailures: number
}

/**
 * Manages user-supplied session cookies for optional authenticated scraping
 * (see plan: "public/logged-out by default, dedicated accounts if cookies
 * given"). This platform never creates accounts or captures credentials —
 * an operator logs in themselves in a real browser, exports cookies, and
 * uploads them here. Rotates across multiple entries per platform to spread
 * load and demotes/bans an entry on repeated failures so a burned account
 * stops being used automatically.
 */
export class CookieJar {
  private entries = new Map<string, CookieJarEntry[]>() // platform -> entries

  add(entry: CookieJarEntry) {
    const list = this.entries.get(entry.platform) ?? []
    list.push(entry)
    this.entries.set(entry.platform, list)
  }

  remove(platform: string, id: string) {
    const list = this.entries.get(platform)
    if (!list) return
    this.entries.set(platform, list.filter((e) => e.id !== id))
  }

  /** Round-robins over healthy entries for a platform; returns null (== "go logged-out") if none are healthy. */
  acquire(platform: string): CookieJarEntry | null {
    const list = this.entries.get(platform)
    if (!list || list.length === 0) return null
    const healthy = list.filter((e) => e.status === 'healthy' || e.status === 'unknown')
    if (healthy.length === 0) return null
    healthy.sort((a, b) => (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0))
    const chosen = healthy[0]!
    chosen.lastUsedAt = new Date()
    return chosen
  }

  reportSuccess(platform: string, id: string) {
    const entry = this.entries.get(platform)?.find((e) => e.id === id)
    if (!entry) return
    entry.consecutiveFailures = 0
    entry.status = 'healthy'
  }

  /** A logged-out redirect, a 403, or a "your account has been locked" page all count as a failure. Three strikes -> banned, stop using it until an operator re-authenticates it. */
  reportFailure(platform: string, id: string) {
    const entry = this.entries.get(platform)?.find((e) => e.id === id)
    if (!entry) return
    entry.consecutiveFailures += 1
    entry.status = entry.consecutiveFailures >= 3 ? 'banned' : 'degraded'
  }

  listForPlatform(platform: string): CookieJarEntry[] {
    return this.entries.get(platform) ?? []
  }

  listAll(): CookieJarEntry[] {
    return [...this.entries.values()].flat()
  }
}
