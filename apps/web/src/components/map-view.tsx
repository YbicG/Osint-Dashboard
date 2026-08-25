'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker, Popup, NavigationControl, LngLatBounds } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPinOff } from 'lucide-react'
import { predicateLabel, confidenceTier } from '@/lib/predicate-labels'
import type { DossierClaim } from '@/server/dossier'
import type { GeocodeResult } from '@/app/api/geocode/route'

const ADDRESS_PREDICATES = new Set(['current_address', 'former_address'])

/*
 * Address claims carry free-form `value` payloads -- a plain string, or a
 * structured object with whatever field names the source connector used
 * (there's no fixed schema; see ClaimCard's `formatValue` for the same
 * problem on the claims-list side). These key lists are a best-effort net
 * over the field names likely to show up, not an exhaustive contract.
 */
const PREFORMATTED_KEYS = ['formattedAddress', 'formatted', 'fullAddress', 'displayAddress']
const LINE_KEYS = ['street', 'streetAddress', 'line1', 'address', 'addressLine1']
const CITY_KEYS = ['city', 'town']
const STATE_KEYS = ['state', 'region', 'province']
const ZIP_KEYS = ['zip', 'zipCode', 'postalCode']
const COUNTRY_KEYS = ['country']
const START_DATE_KEYS = ['startDate', 'from', 'movedInAt', 'effectiveDate', 'since', 'beginDate']
const END_DATE_KEYS = ['endDate', 'to', 'movedOutAt', 'until', 'throughDate']

function firstStringValue(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function formatDateLabel(raw: string): string {
  const trimmed = raw.trim()
  if (/^\d{4}$/.test(trimmed)) return trimmed // bare year -- don't fabricate a month
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return trimmed
}

/** Best-effort tenure string for the marker popup. Prefers an explicit date range found
 *  in the claim's value payload; falls back to the claim's own `observedAt` (always a
 *  real, reliably-typed field regardless of value shape) rather than fabricating a range. */
function tenureLabelFor(claim: DossierClaim, obj: Record<string, unknown> | null): string | null {
  const start = obj ? firstStringValue(obj, START_DATE_KEYS) : undefined
  const end = obj ? firstStringValue(obj, END_DATE_KEYS) : undefined

  if (start || end) {
    const startLabel = start ? formatDateLabel(start) : null
    const endLabel = end ? formatDateLabel(end) : claim.predicate === 'current_address' ? 'present' : null
    if (startLabel && endLabel) return `${startLabel} – ${endLabel}`
    if (startLabel) return `Since ${startLabel}`
    if (endLabel) return `Until ${endLabel}`
  }

  if (claim.observedAt) {
    return `Observed ${new Date(claim.observedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
  }
  return null
}

function extractAddress(claim: DossierClaim): { text: string; tenureLabel: string | null } | null {
  const { value } = claim

  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { text, tenureLabel: tenureLabelFor(claim, null) } : null
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>

    const preformatted = firstStringValue(obj, PREFORMATTED_KEYS)
    if (preformatted) return { text: preformatted, tenureLabel: tenureLabelFor(claim, obj) }

    const line = firstStringValue(obj, LINE_KEYS)
    const city = firstStringValue(obj, CITY_KEYS)
    const state = firstStringValue(obj, STATE_KEYS)
    const zip = firstStringValue(obj, ZIP_KEYS)
    const country = firstStringValue(obj, COUNTRY_KEYS)
    const cityState = [city, state].filter(Boolean).join(', ')
    const text = [line, cityState, zip, country].filter((part) => part && part.length > 0).join(', ')

    if (!text) return null
    return { text, tenureLabel: tenureLabelFor(claim, obj) }
  }

  return null
}

function confidenceWord(confidence: number): string {
  const tier = confidenceTier(confidence)
  return tier === 'high' ? 'High' : tier === 'mid' ? 'Medium' : 'Low'
}

function buildPopupContent(point: AddressPoint, isCurrent: boolean): HTMLDivElement {
  // Built via DOM nodes with textContent (never innerHTML/setHTML) because every
  // string here -- address text, source name -- ultimately comes from scraped
  // OSINT source data, which is untrusted and must never be interpolated as HTML.
  const root = document.createElement('div')
  root.className = 'map-view-popup'

  const title = document.createElement('div')
  title.className = 'map-view-popup-title'
  title.textContent = point.text
  root.appendChild(title)

  const badge = document.createElement('div')
  badge.className = 'map-view-popup-badge'
  badge.textContent = predicateLabel(point.claim.predicate)
  badge.style.color = isCurrent ? 'var(--status-hit)' : 'var(--text-muted)'
  root.appendChild(badge)

  if (point.tenureLabel) {
    const tenure = document.createElement('div')
    tenure.className = 'map-view-popup-meta'
    tenure.textContent = point.tenureLabel
    root.appendChild(tenure)
  }

  const source = document.createElement('div')
  source.className = 'map-view-popup-meta'
  source.textContent = `${point.claim.sourceName} · ${confidenceWord(point.claim.confidence)} confidence`
  root.appendChild(source)

  return root
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

interface AddressPoint {
  claim: DossierClaim
  text: string
  tenureLabel: string | null
  status: 'pending' | 'success' | 'failed'
  lat: number | null
  lon: number | null
}

export function MapView({ entityId, addressClaims }: { entityId: string; addressClaims: DossierClaim[] }) {
  // Defensive: the caller is expected to already filter to address predicates, but a
  // component that silently mis-renders on an unexpected input is worse than one that
  // just re-filters cheaply.
  const relevantClaims = useMemo(() => addressClaims.filter((c) => ADDRESS_PREDICATES.has(c.predicate)), [addressClaims])

  const [points, setPoints] = useState<AddressPoint[]>([])
  const [loading, setLoading] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const hasFitRef = useRef(false)

  // Mount the map exactly once. Basemap tiles are served from our own /api/tiles proxy
  // (not tile.openstreetmap.org directly) -- see that route's header comment: the app's
  // CSP scopes connect-src to 'self', and that config is out of scope for this change.
  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8 as const,
        sources: {
          osm: {
            type: 'raster' as const,
            tiles: ['/api/tiles/{z}/{x}/{y}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: OSM_ATTRIBUTION,
          },
        },
        layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
      },
      center: [0, 20],
      zoom: 1,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Re-extract and re-geocode whenever we're looking at a different entity's address
  // claims. Keyed off both `entityId` and `relevantClaims` because the App Router can
  // reuse this component instance across a client-side navigation between two entities'
  // dossiers rather than remounting it.
  useEffect(() => {
    let cancelled = false
    hasFitRef.current = false

    const initial: AddressPoint[] = relevantClaims.map((claim) => {
      const extracted = extractAddress(claim)
      return extracted
        ? { claim, text: extracted.text, tenureLabel: extracted.tenureLabel, status: 'pending' as const, lat: null, lon: null }
        : { claim, text: '(no usable address text on this claim)', tenureLabel: null, status: 'failed' as const, lat: null, lon: null }
    })
    setPoints(initial)

    const toGeocode = initial.filter((p) => p.status === 'pending')
    if (toGeocode.length === 0) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)

    // Dedupe identical address text client-side (the server also caches by normalized
    // address, this just skips the redundant round trip when e.g. the same address
    // shows up as both a current_address and a former_address claim).
    const byText = new Map<string, AddressPoint[]>()
    for (const point of toGeocode) {
      if (!byText.has(point.text)) byText.set(point.text, [])
      byText.get(point.text)!.push(point)
    }

    Promise.all(
      [...byText.entries()].map(async ([text, group]) => {
        let result: GeocodeResult | null = null
        try {
          const res = await fetch(`/api/geocode?address=${encodeURIComponent(text)}`)
          if (res.ok) {
            const body = (await res.json()) as { result: GeocodeResult | null }
            result = body.result
          }
        } catch {
          result = null
        }
        if (cancelled) return
        const groupIds = new Set(group.map((p) => p.claim.id))
        setPoints((prev) =>
          prev.map((p) =>
            groupIds.has(p.claim.id)
              ? result
                ? { ...p, status: 'success' as const, lat: result.lat, lon: result.lon }
                : { ...p, status: 'failed' as const }
              : p,
          ),
        )
      }),
    ).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [entityId, relevantClaims])

  // Sync map markers with the current point set, then fit the camera once per
  // claims-set after geocoding settles (not on every individual marker arrival, which
  // would jump the camera around while the 1-req/sec queue works through the list).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const successful = points.filter(
      (p): p is AddressPoint & { lat: number; lon: number } => p.status === 'success' && p.lat !== null && p.lon !== null,
    )
    const currentIds = new Set(successful.map((p) => p.claim.id))

    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    for (const point of successful) {
      if (markersRef.current.has(point.claim.id)) continue

      const isCurrent = point.claim.predicate === 'current_address'
      const el = document.createElement('div')
      el.className = 'map-view-pin'
      el.style.background = isCurrent ? 'var(--status-hit)' : 'var(--text-muted)'
      el.title = point.text
      el.tabIndex = 0
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', `${predicateLabel(point.claim.predicate)}: ${point.text}`)

      const popup = new Popup({ offset: 14, maxWidth: '260px' }).setDOMContent(buildPopupContent(point, isCurrent))

      let marker: Marker
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          marker.togglePopup()
        }
      })
      marker = new Marker({ element: el }).setLngLat([point.lon, point.lat]).setPopup(popup).addTo(map)
      markersRef.current.set(point.claim.id, marker)
    }

    if (!hasFitRef.current && !loading && successful.length > 0) {
      hasFitRef.current = true
      if (successful.length === 1) {
        const only = successful[0]!
        map.flyTo({ center: [only.lon, only.lat], zoom: 13, duration: 500 })
        markersRef.current.get(only.claim.id)?.togglePopup()
      } else {
        const bounds = new LngLatBounds()
        successful.forEach((p) => bounds.extend([p.lon, p.lat]))
        map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 500 })
      }
    }
  }, [points, loading])

  if (relevantClaims.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No address claims to plot.</p>
  }

  const failed = points.filter((p) => p.status === 'failed')
  const successCount = points.filter((p) => p.status === 'success').length

  return (
    <div data-entity-id={entityId} className="flex flex-col gap-3">
      <style>{POPUP_STYLES}</style>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-3">
          <span>
            {successCount} of {points.length} address{points.length === 1 ? '' : 'es'} plotted
          </span>
          {loading && (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-pending)] animate-pulse-dot" />
              Geocoding…
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-hit)' }} /> Current
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--text-muted)' }} /> Former
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="h-[420px] w-full overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      />

      {failed.length > 0 && (
        <details className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none font-medium text-[var(--text-secondary)]">
            {failed.length} address{failed.length === 1 ? '' : 'es'} could not be geocoded
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {failed.map((p) => (
              <li key={p.claim.id} className="flex items-start gap-1.5 text-[var(--text-muted)]">
                <MapPinOff className="mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--status-error)]" />
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--text-secondary)]">{p.text}</span>{' '}
                  <span className="text-[10px] uppercase tracking-wide">{predicateLabel(p.claim.predicate)}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

const POPUP_STYLES = `
  .map-view-pin {
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    border: 2px solid var(--bg-canvas);
    box-shadow: 0 0 0 1px var(--border-default);
    cursor: pointer;
  }
  .map-view-pin:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .maplibregl-popup-content {
    background: var(--bg-surface-raised);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .maplibregl-popup-close-button {
    color: var(--text-muted);
  }
  .maplibregl-popup-tip {
    border-top-color: var(--bg-surface-raised) !important;
    border-bottom-color: var(--bg-surface-raised) !important;
    border-left-color: var(--bg-surface-raised) !important;
    border-right-color: var(--bg-surface-raised) !important;
  }
  .maplibregl-ctrl-group {
    background: var(--bg-surface-raised);
    border: 1px solid var(--border-default);
  }
  .maplibregl-ctrl-group button:hover {
    background: var(--bg-hover);
  }
  .maplibregl-ctrl-attrib {
    background: rgba(10, 13, 18, 0.7) !important;
    color: var(--text-muted) !important;
  }
  .maplibregl-ctrl-attrib a {
    color: var(--text-secondary) !important;
  }
  .map-view-popup-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .map-view-popup-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 500;
    margin-bottom: 4px;
  }
  .map-view-popup-meta {
    font-size: 11px;
    color: var(--text-muted);
  }
`
