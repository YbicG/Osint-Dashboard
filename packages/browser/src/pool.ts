import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { randomFingerprint, STEALTH_INIT_SCRIPT } from './stealth/fingerprint'
import { ProxyPool, type ProxyEndpoint } from './proxy/pool'
import { CookieJar } from './cookies/jar'
import { CaptchaSolver, SkipAndFlagSolver, type CaptchaChallenge } from './captcha/solver'
import { globalRateLimiter } from './rate-limit'

export interface AcquireContextOptions {
  /** Rate-limit + proxy-region bucket key, typically the connector id. */
  connectorId: string
  rateLimitPerMinute: number
  /** If set and the cookie jar has a healthy entry, the context launches authenticated for this platform. */
  platform?: string
  proxyRegion?: string
}

export interface ManagedContext {
  context: BrowserContext
  page: Page
  /** Call once the run finishes — releases the context and reports proxy/cookie health. */
  release: (outcome: 'success' | 'blocked' | 'error') => Promise<void>
}

/**
 * Single shared pool of Playwright browser contexts for the whole worker
 * process. One real Chromium instance, many isolated contexts (each with
 * its own fingerprint/proxy/cookies) — cheaper than one browser per job and
 * still gives every job its own cookie/storage isolation.
 */
export class BrowserPool {
  private browser: Browser | null = null
  private proxyPool: ProxyPool
  private cookieJar: CookieJar
  private captchaSolver: CaptchaSolver
  private activeProxyByContext = new WeakMap<BrowserContext, ProxyEndpoint>()
  private activeCookieByContext = new WeakMap<BrowserContext, { platform: string; id: string }>()

  constructor(opts?: { proxyPool?: ProxyPool; cookieJar?: CookieJar; captchaSolver?: CaptchaSolver }) {
    this.proxyPool = opts?.proxyPool ?? new ProxyPool()
    this.cookieJar = opts?.cookieJar ?? new CookieJar()
    this.captchaSolver = opts?.captchaSolver ?? new SkipAndFlagSolver()
  }

  async start() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
  }

  async stop() {
    await this.browser?.close()
    this.browser = null
  }

  async acquireContext(opts: AcquireContextOptions): Promise<ManagedContext> {
    if (!this.browser) await this.start()
    await globalRateLimiter.acquire(opts.connectorId, opts.rateLimitPerMinute)

    const fp = randomFingerprint()
    const proxyEndpoint = this.proxyPool.acquire(opts.proxyRegion)
    const cookieEntry = opts.platform ? this.cookieJar.acquire(opts.platform) : null

    const context = await this.browser!.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
      proxy: proxyEndpoint
        ? { server: proxyEndpoint.server, username: proxyEndpoint.username, password: proxyEndpoint.password }
        : undefined,
    })
    await context.addInitScript(STEALTH_INIT_SCRIPT)
    if (cookieEntry) await context.addCookies(cookieEntry.cookies)
    if (proxyEndpoint) this.activeProxyByContext.set(context, proxyEndpoint)
    if (cookieEntry) this.activeCookieByContext.set(context, { platform: opts.platform!, id: cookieEntry.id })

    const page = await context.newPage()

    return {
      context,
      page,
      release: async (outcome) => {
        const proxy = this.activeProxyByContext.get(context)
        if (proxy) outcome === 'success' ? this.proxyPool.reportSuccess(proxy) : this.proxyPool.reportFailure(proxy)
        const cookie = this.activeCookieByContext.get(context)
        if (cookie) {
          outcome === 'success'
            ? this.cookieJar.reportSuccess(cookie.platform, cookie.id)
            : this.cookieJar.reportFailure(cookie.platform, cookie.id)
        }
        await context.close()
      },
    }
  }

  getCookieJar(): CookieJar { return this.cookieJar }
  getProxyPool(): ProxyPool { return this.proxyPool }
  getCaptchaSolver(): CaptchaSolver { return this.captchaSolver }
}

/** Best-effort detection of the common CAPTCHA/bot-wall providers, checked after navigation and on 403/429 responses. */
export async function detectCaptcha(page: Page): Promise<CaptchaChallenge | null> {
  const url = page.url()
  const html = await page.content().catch(() => '')

  if (html.includes('g-recaptcha') || html.includes('recaptcha/api.js')) {
    const siteKey = html.match(/data-sitekey="([^"]+)"/)?.[1] ?? null
    return { kind: html.includes('recaptcha/api.js?render=') ? 'recaptcha_v3' : 'recaptcha_v2', pageUrl: url, siteKey }
  }
  if (html.includes('hcaptcha.com')) {
    const siteKey = html.match(/data-sitekey="([^"]+)"/)?.[1] ?? null
    return { kind: 'hcaptcha', pageUrl: url, siteKey }
  }
  if (html.includes('challenges.cloudflare.com') || html.includes('Just a moment')) {
    return { kind: 'cloudflare_turnstile', pageUrl: url, siteKey: null }
  }
  return null
}
