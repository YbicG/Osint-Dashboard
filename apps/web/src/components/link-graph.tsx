'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Core, EdgeSingular, ElementDefinition, NodeSingular } from 'cytoscape'
import { Loader2, Maximize2, Plus, Waypoints } from 'lucide-react'
import { predicateLabel, confidenceTier } from '@/lib/predicate-labels'
import type { GraphData, GraphEdge, GraphNode } from '@/app/api/entities/[id]/graph/route'

export interface LinkGraphEdge {
  id: string
  type: string
  sourceEntityId: string
  targetEntityId: string
  confidence: number
}

export interface LinkGraphRelatedEntity {
  id: string
  type: string
  displayLabel: string
}

export interface LinkGraphProps {
  entityId: string
  edges: LinkGraphEdge[]
  relatedEntities: LinkGraphRelatedEntity[]
  centerLabel: string
}

/** Mirrors the chip labels used on the dossier page's "Relationships" strip — kept as its own
 * copy here (rather than imported) since that page is owned by a sibling process and this
 * component must stay self-contained. Falls back to a generic snake_case humanizer for any
 * edge type not covered, so a future addition to the edge_type enum never renders as raw text. */
const EDGE_TYPE_LABELS: Record<string, string> = {
  relative: 'Relative', spouse: 'Spouse', associate: 'Associate', coworker: 'Coworker',
  neighbor: 'Neighbor', employee_of: 'Employee of', owner_of: 'Owner of', officer_of: 'Officer of',
  registered_agent_of: 'Registered agent of', resides_at: 'Resides at', uses_contact: 'Uses contact',
  uses_username: 'Uses username', registered_vehicle: 'Registered vehicle', party_to_case: 'Party to case', same_as: 'Same as',
}

function edgeTypeLabel(type: string): string {
  return EDGE_TYPE_LABELS[type] ?? predicateLabel(type)
}

/**
 * Entity types bucketed onto the same 5 hues the rest of the app already uses
 * (see timeline-view.tsx's CATEGORY_COLOR_VAR for the same idea) rather than
 * inventing a fresh per-type palette. Only used for the non-center node border —
 * a light touch, since the edge labels/colors carry the primary information here.
 */
type Hue = 'accent' | 'hit' | 'blocked' | 'error' | 'miss'

const ENTITY_TYPE_HUE: Record<string, Hue> = {
  person: 'accent', organization: 'accent', phone: 'accent', email: 'accent',
  address: 'hit',
  crypto_wallet: 'blocked',
  court_case: 'error',
  username: 'miss', vehicle: 'miss', vessel: 'miss', aircraft: 'miss', domain: 'miss', ip_address: 'miss', image: 'miss', document: 'miss',
}

function entityHue(type: string): Hue {
  return ENTITY_TYPE_HUE[type] ?? 'miss'
}

interface Palette {
  bgSurface: string
  bgSurfaceRaised: string
  textPrimary: string
  textMuted: string
  accent: string
  accentDim: string
  accentFg: string
  hit: string
  blocked: string
  error: string
  miss: string
}

/** Cytoscape draws to a <canvas>, not the DOM, so it can't resolve `var(--x)` itself —
 * resolve the design tokens to real color strings once, client-side, and hand cytoscape
 * plain values. Single dark palette, no light/dark split, so this only needs to run once. */
function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    bgSurface: v('--bg-surface', '#10141b'),
    bgSurfaceRaised: v('--bg-surface-raised', '#161b24'),
    textPrimary: v('--text-primary', '#e7ecf3'),
    textMuted: v('--text-muted', '#6b7688'),
    accent: v('--accent', '#4f8cff'),
    accentDim: v('--accent-dim', '#2c4a8c'),
    accentFg: v('--accent-fg', '#eaf1ff'),
    hit: v('--status-hit', '#34c77b'),
    blocked: v('--status-blocked', '#f0a63b'),
    error: v('--status-error', '#f0553b'),
    miss: v('--status-miss', '#6b7688'),
  }
}

function confidenceColor(palette: Palette, confidence: number): string {
  const tier = confidenceTier(confidence)
  return tier === 'high' ? palette.hit : tier === 'mid' ? palette.blocked : palette.error
}

const MAX_DEPTH = 4

type GraphNodeState = GraphNode
type GraphEdgeState = GraphEdge

function buildElements(
  entityId: string,
  centerLabel: string,
  nodesById: Map<string, GraphNodeState>,
  edgesById: Map<string, GraphEdgeState>,
  palette: Palette,
): ElementDefinition[] {
  const nodeEls: ElementDefinition[] = [...nodesById.values()].map((n): ElementDefinition => {
    const isCenter = n.id === entityId
    const hue = entityHue(n.type)
    return {
      group: 'nodes',
      data: {
        id: n.id,
        label: isCenter ? centerLabel : n.displayLabel,
        isCenter,
        borderColor: isCenter ? palette.accent : palette[hue],
      },
    }
  })

  const edgeEls: ElementDefinition[] = [...edgesById.values()]
    // Drop dangling edges — an expand can pull in an edge whose other endpoint
    // sits past the server's MAX_NODES cap and never arrives as a node.
    .filter((e) => nodesById.has(e.sourceEntityId) && nodesById.has(e.targetEntityId))
    .map((e): ElementDefinition => ({
      group: 'edges',
      data: {
        id: e.id,
        source: e.sourceEntityId,
        target: e.targetEntityId,
        label: edgeTypeLabel(e.type),
        confidence: e.confidence,
        color: confidenceColor(palette, e.confidence),
      },
    }))

  return [...nodeEls, ...edgeEls]
}

function runLayout(cy: Core, randomize: boolean) {
  const layout = cy.layout({ name: 'cose', animate: true, animationDuration: randomize ? 300 : 400, randomize, fit: false })
  layout.one('layoutstop', () => cy.fit(undefined, 30))
  layout.run()
}

export function LinkGraph({ entityId, edges, relatedEntities, centerLabel }: LinkGraphProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const paletteRef = useRef<Palette | null>(null)

  function initialNodes(): Map<string, GraphNodeState> {
    const map = new Map<string, GraphNodeState>()
    map.set(entityId, { id: entityId, type: 'person', displayLabel: centerLabel })
    for (const n of relatedEntities) map.set(n.id, n)
    return map
  }

  const [nodesById, setNodesById] = useState<Map<string, GraphNodeState>>(initialNodes)
  const [edgesById, setEdgesById] = useState<Map<string, GraphEdgeState>>(() => new Map(edges.map((e) => [e.id, e])))
  const [depth, setDepth] = useState(1)
  const [expanding, setExpanding] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Reset if the caller swaps in a different entity while keeping this component
  // mounted (e.g. an in-page navigation rather than a fresh route render).
  useEffect(() => {
    setNodesById(initialNodes())
    setEdgesById(new Map(edges.map((e) => [e.id, e])))
    setDepth(1)
    setExpandError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  const isEmpty = edges.length === 0 && relatedEntities.length === 0

  // Mount cytoscape once. Dynamically imported so nothing that touches
  // `window`/`document` ever executes during server render.
  useEffect(() => {
    if (isEmpty || !containerRef.current) return
    let disposed = false

    import('cytoscape').then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) return
      const palette = readPalette()
      paletteRef.current = palette

      const cy = cytoscape({
        container: containerRef.current,
        elements: buildElements(entityId, centerLabel, nodesById, edgesById, palette),
        style: [
          {
            selector: 'node',
            style: {
              shape: 'round-rectangle',
              'background-color': palette.bgSurfaceRaised,
              'border-width': 1.5,
              'border-color': 'data(borderColor)',
              'corner-radius': '6px',
              width: 'label',
              height: 'label',
              padding: '8px',
              label: 'data(label)',
              color: palette.textPrimary,
              'font-size': 11,
              'text-valign': 'center',
              'text-halign': 'center',
              'text-max-width': '140px',
              'text-wrap': 'ellipsis',
            },
          },
          {
            selector: 'node[?isCenter]',
            style: {
              'background-color': palette.accentDim,
              'border-width': 2,
              'border-color': palette.accent,
              color: palette.accentFg,
              'font-weight': 'bold',
              'font-size': 12,
            },
          },
          {
            selector: 'node:selected',
            style: { 'border-color': palette.accent, 'border-width': 3 },
          },
          {
            selector: 'edge',
            style: {
              width: 1.5,
              'curve-style': 'bezier',
              'line-color': 'data(color)',
              'target-arrow-color': 'data(color)',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.8,
              opacity: (ele: EdgeSingular) => 0.35 + 0.65 * (Number(ele.data('confidence')) || 0),
              label: 'data(label)',
              'font-size': 9,
              color: palette.textMuted,
              'text-background-color': palette.bgSurface,
              'text-background-opacity': 1,
              'text-background-padding': '2px',
              'text-rotation': 'autorotate',
            },
          },
        ],
        layout: { name: 'preset' },
        minZoom: 0.15,
        maxZoom: 2.5,
        wheelSensitivity: 0.25,
      })

      cy.on('tap', 'node', (evt) => {
        const node = evt.target as NodeSingular
        const id = node.id()
        if (id === entityId) return
        router.push(`/entities/${id}`)
      })
      cy.on('mouseover', 'node', (evt) => {
        const node = evt.target as NodeSingular
        if (containerRef.current) containerRef.current.style.cursor = node.id() === entityId ? 'default' : 'pointer'
      })
      cy.on('mouseout', 'node', () => {
        if (containerRef.current) containerRef.current.style.cursor = 'grab'
      })

      cyRef.current = cy
      runLayout(cy, true)
      setReady(true)
    })

    return () => {
      disposed = true
      cyRef.current?.destroy()
      cyRef.current = null
    }
    // Mount/unmount only — element updates are pushed via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmpty])

  // Push node/edge changes (initial load is folded into the mount above; this
  // effect fires again after each Expand) into the live cytoscape instance.
  useEffect(() => {
    const cy = cyRef.current
    const palette = paletteRef.current
    if (!cy || !palette) return

    const elements = buildElements(entityId, centerLabel, nodesById, edgesById, palette)
    const incomingIds = new Set(elements.map((el) => el.data.id))
    cy.elements().forEach((el) => {
      if (!incomingIds.has(el.id())) el.remove()
    })
    const existingIds = new Set(cy.elements().map((el) => el.id()))
    const toAdd = elements.filter((el) => !existingIds.has(el.data.id as string))
    if (toAdd.length === 0) return

    cy.add(toAdd)
    runLayout(cy, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesById, edgesById])

  // Keep the canvas in step with its container — the graph lives inside a
  // view switcher whose panel can resize independently of the browser window.
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => cyRef.current?.resize())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  async function handleExpand() {
    if (expanding || depth >= MAX_DEPTH) return
    const nextDepth = Math.min(depth + 1, MAX_DEPTH)
    setExpanding(true)
    setExpandError(null)
    try {
      const res = await fetch(`/api/entities/${entityId}/graph?depth=${nextDepth}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string })
        setExpandError(body.error ?? `Could not expand graph (${res.status}).`)
        return
      }
      const data: GraphData = await res.json()
      setNodesById((prev) => {
        const next = new Map(prev)
        for (const n of data.nodes) next.set(n.id, n)
        return next
      })
      setEdgesById((prev) => {
        const next = new Map(prev)
        for (const e of data.edges) next.set(e.id, e)
        return next
      })
      setDepth(nextDepth)
    } catch {
      setExpandError('Could not expand graph. Check your connection and try again.')
    } finally {
      setExpanding(false)
    }
  }

  function handleFit() {
    cyRef.current?.fit(undefined, 30)
  }

  if (isEmpty) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No linked entities to graph.</p>
  }

  const nodeCount = nodesById.size
  const edgeCount = edgesById.size
  const atMaxDepth = depth >= MAX_DEPTH

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">
            <Waypoints className="h-3.5 w-3.5" />
            {nodeCount} {nodeCount === 1 ? 'entity' : 'entities'} &middot; {edgeCount} {edgeCount === 1 ? 'link' : 'links'}
          </span>
          <span>Depth {depth} of {MAX_DEPTH}</span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--confidence-high)' }} /> High</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--confidence-mid)' }} /> Med</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--confidence-low)' }} /> Low</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleFit}
            disabled={!ready}
            title="Fit graph to view"
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <Maximize2 className="h-3 w-3" /> Fit
          </button>
          {atMaxDepth ? (
            <span className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)]">Fully expanded</span>
          ) : (
            <button
              type="button"
              onClick={handleExpand}
              disabled={expanding}
              title={`Pull in entities up to depth ${depth + 1}`}
              className="flex items-center gap-1 rounded-md border border-[var(--accent)] bg-[var(--accent-dim)] px-2 py-1 text-[11px] font-medium text-[var(--accent-fg)] transition hover:opacity-90 disabled:opacity-60"
            >
              {expanding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Expand
            </button>
          )}
        </div>
      </div>

      {expandError && (
        <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-1.5 text-xs text-[var(--status-error)]">
          {expandError}
        </div>
      )}

      <div
        ref={containerRef}
        className="h-[480px] w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
        style={{ cursor: 'grab' }}
      />

      <p className="text-[10px] text-[var(--text-muted)]">
        Click a node to open its dossier. Drag to pan, scroll to zoom.
      </p>
    </div>
  )
}
