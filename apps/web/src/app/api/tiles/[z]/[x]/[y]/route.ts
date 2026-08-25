import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/server/auth'

/**
 * Same-origin proxy for OSM's standard raster tile server, used as MapView's basemap.
 *
 * Why proxy instead of pointing MapLibre straight at tile.openstreetmap.org (the
 * simpler, more common setup): apps/web/next.config.ts sends a strict
 * `Content-Security-Policy` with `connect-src 'self'` on every route, and that file is
 * off-limits for this change (see the sibling-view build constraints). MapLibre GL JS
 * loads raster tiles via `fetch()`, which falls under `connect-src`, not `img-src` -- so
 * a cross-origin tile URL would be silently blocked by the browser regardless of the
 * `img-src https:` allowance. Proxying tiles through our own `/api/tiles/*` route keeps
 * every request same-origin and sidesteps that without touching shared config.
 *
 * This still respects OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/):
 * a real identifying User-Agent, no bulk/automated prefetching (tiles are only ever
 * requested by MapLibre for the visible viewport, exactly like a normal browser client),
 * and a bounded in-memory cache so repeated views of the same area within this
 * process's lifetime don't re-hit OSM at all.
 */

const MAX_ZOOM = 19
const USER_AGENT = 'OSINT-Dashboard-Internal/1.0 (self-hosted investigative case tool; low-volume basemap proxy)'

// Bounded so a long-running process can't accumulate unbounded tile bytes in memory --
// well below anything that could be mistaken for mirroring/bulk downloading.
const MAX_CACHE_ENTRIES = 1000
const cache = new Map<string, { body: ArrayBuffer; contentType: string }>()

function rememberTile(key: string, entry: { body: ArrayBuffer; contentType: string }) {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, entry)
}

function tileResponse(entry: { body: ArrayBuffer; contentType: string }) {
  return new NextResponse(entry.body, {
    headers: { 'Content-Type': entry.contentType, 'Cache-Control': 'public, max-age=86400' },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { z: zRaw, x: xRaw, y: yRaw } = await params
  const z = Number.parseInt(zRaw, 10)
  const x = Number.parseInt(xRaw, 10)
  const y = Number.parseInt(yRaw.replace(/\.png$/, ''), 10)

  const tilesAcrossAxis = 2 ** z
  const isValid =
    Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) &&
    z >= 0 && z <= MAX_ZOOM && x >= 0 && y >= 0 && x < tilesAcrossAxis && y < tilesAcrossAxis
  if (!isValid) return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 })

  const key = `${z}/${x}/${y}`
  const cached = cache.get(key)
  if (cached) return tileResponse(cached)

  try {
    const upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!upstream.ok) return NextResponse.json({ error: 'Tile fetch failed' }, { status: 502 })

    const body = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') ?? 'image/png'
    const entry = { body, contentType }
    rememberTile(key, entry)

    return tileResponse(entry)
  } catch (err) {
    console.error('[tiles] upstream fetch failed', err)
    return NextResponse.json({ error: 'Tile fetch failed' }, { status: 502 })
  }
}
