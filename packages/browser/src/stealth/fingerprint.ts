export interface DeviceFingerprint {
  userAgent: string
  viewport: { width: number; height: number }
  locale: string
  timezoneId: string
  platform: string
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
]

const VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1536, height: 864 },
  { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 2560, height: 1440 },
]

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/** A fresh, internally-consistent fingerprint for one browser context. Not cryptographically random — just varied enough to avoid a static, obviously-scripted signature across many contexts. */
export function randomFingerprint(): DeviceFingerprint {
  const ua = pick(USER_AGENTS)
  return {
    userAgent: ua,
    viewport: pick(VIEWPORTS),
    locale: 'en-US',
    timezoneId: pick(TIMEZONES),
    platform: ua.includes('Windows') ? 'Win32' : ua.includes('Macintosh') ? 'MacIntel' : 'Linux x86_64',
  }
}

/**
 * Init script injected into every page of a stealth context. Patches the
 * handful of properties most bot-detection scripts check for the default
 * headless/automation tells. This is not a guarantee against sophisticated
 * fingerprinting (e.g. Cloudflare/DataDome) — those get skip-and-flagged
 * like a CAPTCHA (see captcha/solver.ts), not fought head-on.
 */
export const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = window.chrome || { runtime: {} };
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  }
`
