import { globalRateLimiter } from '@osint/browser'

export class ConnectorHttpError extends Error {
  constructor(message: string, public readonly classification: 'blocked' | 'error', public readonly status?: number) {
    super(message)
  }
}

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Builds a rate-limited, connector-tagged fetch wrapper. 403/429 are
 * classified as `blocked` (feeds the source-health dashboard and the
 * CAPTCHA/bot-wall skip-and-flag path) rather than a generic `error`, so
 * operators can tell "this source is geo/rate blocking us" from "this
 * source's parser broke."
 *
 * Every request gets a hard timeout via a manually-managed AbortController
 * (not `AbortSignal.timeout()` — that convenience helper triggers a libuv
 * handle-cleanup assertion crash on Node 24/Windows when combined with
 * `fetch`). The controller is always cleared in `finally`, so no dangling
 * timers survive a fast response.
 */
export function createConnectorFetch(connectorId: string, rateLimitPerMinute: number): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    await globalRateLimiter.acquire(connectorId, rateLimitPerMinute)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OSINT-Dashboard/0.1; +https://localhost)',
          ...init?.headers,
        },
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ConnectorHttpError(`Timed out after ${DEFAULT_TIMEOUT_MS}ms`, 'error')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }

    if (response.status === 403 || response.status === 429) {
      throw new ConnectorHttpError(`Blocked with status ${response.status}`, 'blocked', response.status)
    }
    if (!response.ok && response.status >= 500) {
      throw new ConnectorHttpError(`Upstream error ${response.status}`, 'error', response.status)
    }
    return response
  }) as typeof fetch
}
