import { NextRequest, NextResponse } from 'next/server'
import { eq, or } from 'drizzle-orm'
import { entity, edge } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

export interface GraphNode {
  id: string
  type: string
  displayLabel: string
}

export interface GraphEdge {
  id: string
  type: string
  sourceEntityId: string
  targetEntityId: string
  confidence: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const DEFAULT_DEPTH = 2
const MAX_DEPTH = 4

// Safety valve for hub entities sitting in a densely-connected cluster — this
// is an application-level BFS, not a bounded recursive CTE, so we cap total
// visited nodes rather than risk one "Expand" click pulling in an entire
// cluster's worth of rows.
const MAX_NODES = 500

function parseDepth(raw: string | null): number {
  const parsed = raw === null ? DEFAULT_DEPTH : Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DEPTH
  return Math.min(parsed, MAX_DEPTH)
}

/**
 * Breadth-first traversal of the edge table starting at `id`, out to `depth`
 * hops (query param, default 2, capped at 4). Written as plain application-level
 * BFS — fetch the edges touching the current frontier, collect the entity ids
 * that newly come into view, repeat — rather than a recursive SQL CTE. At this
 * data scale that trade is simpler to read, easier to cap safely, and follows
 * the same "one query shape per step" style as getDossierData in
 * apps/web/src/server/dossier.ts.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [centerRow] = await db.select().from(entity).where(eq(entity.id, id))
  if (!centerRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const depth = parseDepth(req.nextUrl.searchParams.get('depth'))

  const visited = new Set<string>([id])
  const edgesById = new Map<string, GraphEdge>()
  let frontier = [id]

  for (let hop = 0; hop < depth && frontier.length > 0 && visited.size < MAX_NODES; hop++) {
    const hopEdges = await db.select().from(edge)
      .where(or(...frontier.flatMap((frontierId) => [eq(edge.sourceEntityId, frontierId), eq(edge.targetEntityId, frontierId)])))

    const nextFrontier: string[] = []
    for (const e of hopEdges) {
      edgesById.set(e.id, e)
      for (const otherId of [e.sourceEntityId, e.targetEntityId]) {
        if (!visited.has(otherId) && visited.size < MAX_NODES) {
          visited.add(otherId)
          nextFrontier.push(otherId)
        }
      }
    }
    frontier = nextFrontier
  }

  const nodeIds = [...visited]
  const nodes = nodeIds.length
    ? await db.select({ id: entity.id, type: entity.type, displayLabel: entity.displayLabel }).from(entity)
      .where(or(...nodeIds.map((nodeId) => eq(entity.id, nodeId))))
    : []

  const data: GraphData = { nodes, edges: [...edgesById.values()] }
  return NextResponse.json(data)
}
