import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/server/auth'

/**
 * Server-side proxy for OSM Nominatim geocoding, used by MapView to turn raw
 * address-claim text into coordinates.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * requires a descriptive HTTP User-Agent identifying the calling application and caps
 * automated use at one request per second. Both constraints only make sense enforced
 * in one place shared by every browser session, not per-request from the client -- two
 * investigators with a dossier open at once would trivially blow past 1 req/sec if the
 * browser called Nominatim directly, and a browser can't set a custom User-Agent header
 * anyway. So every address lookup is funneled through this route, which queues them
 * onto Nominatim one at a time and never geocodes the same normalized address twice.
 *
 * `cache`, `inFlight`, and the rate-limit queue state are module-level rather than
 * per-request, so they live for the lifetime of the Node process this route handler
 * runs in (this app runs as a persistent `next start` server, not per-invocation
 * serverless functions -- see apps/worker for the separate queue-backed background
 * worker process). A process restart clears the cache; that's an acceptable cost for
 * a dashboard, not a correctness issue.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
// Nominatim's policy asks for an identifying User-Agent, not necessarily a personal
// contact -- deliberately not embedding an individual analyst's email here, since that
// would leak an investigator's identity to a third-party service on every OSINT lookup.
const USER_AGENT = 'OSINT-Dashboard-Internal/1.0 (self-hosted investigative case tool; low-volume server-side geocoding)'
const MIN_REQUEST_INTERVAL_MS = 1100 // stay safely under Nominatim's 1 req/sec cap

export interface GeocodeResult {
  lat: number
  lon: number
  displayName: string
}

function normalizeAddress(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Cache is keyed by normalized address text and shared across all entities/sessions --
// the same physical address geocodes identically regardless of which dossier it came
// from, so sharing the cache only helps.
const cache = new Map<string, GeocodeResult | null>()
const inFlight = new Map<string, Promise<GeocodeResult | null>>()

let queueTail: Promise<void> = Promise.resolve()
let lastRequestAt = 0

/**
 * Runs `task` after waiting out whatever's left of the 1-req/sec window, chained onto
 * every other queued caller so concurrent geocode requests still serialize onto
 * Nominatim one at a time instead of firing in parallel.
 */
function scheduleOnQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return task()
  })
  // The queue's own chain must never reject, or every job queued behind a failed one
  // would be dropped -- the real success/failure still flows to `run`'s caller below.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function fetchFromNominatim(address: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)

  const body = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  const hit = body[0]
  if (!hit) return null
  return { lat: Number.parseFloat(hit.lat), lon: Number.parseFloat(hit.lon), displayName: hit.display_name }
}

async function geocode(address: string): Promise<GeocodeResult | null> {
  const key = normalizeAddress(address)
  if (cache.has(key)) return cache.get(key)!

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = scheduleOnQueue(() => fetchFromNominatim(address))
    .then((result) => {
      // Only a confirmed result (hit or genuine "no match") is worth caching --
      // an upstream error should be retryable on the next request, not stuck at null.
      cache.set(key, result)
      return result
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  return promise
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const address = req.nextUrl.searchParams.get('address')?.trim()
  if (!address) return NextResponse.json({ error: 'Missing address query parameter' }, { status: 400 })

  try {
    const result = await geocode(address)
    return NextResponse.json({ result })
  } catch (err) {
    console.error('[geocode] Nominatim lookup failed', err)
    return NextResponse.json({ result: null, error: 'geocoding_failed' }, { status: 502 })
  }
}
