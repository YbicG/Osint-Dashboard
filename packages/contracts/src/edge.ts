import { z } from 'zod'

export const EdgeType = z.enum([
  'relative',
  'spouse',
  'associate',
  'coworker',
  'neighbor',
  'employee_of',
  'owner_of',
  'officer_of',
  'registered_agent_of',
  'resides_at',
  'uses_contact',
  'uses_username',
  'registered_vehicle',
  'party_to_case',
  'same_as', // identity-resolution merge edge
])
export type EdgeType = z.infer<typeof EdgeType>

/**
 * A materialized, queryable relationship between two entities. Always backed
 * by >=1 claims (see edge_claim join in the db package) — an edge is a
 * read-optimized projection for the graph view, not a separate source of
 * truth. Deleting the backing claims (retraction) should collapse the edge.
 */
export const Edge = z.object({
  id: z.string().uuid(),
  type: EdgeType,
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  label: z.string().nullable(),
  /** Aggregate confidence across backing claims. */
  confidence: z.number().min(0).max(1),
  firstObservedAt: z.coerce.date().nullable(),
  lastObservedAt: z.coerce.date().nullable(),
})
export type Edge = z.infer<typeof Edge>
