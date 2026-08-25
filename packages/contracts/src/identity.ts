import { z } from 'zod'

/**
 * Result of running entity resolution over a set of entities that might be
 * the same real-world thing. A cluster is the "current best merge" — always
 * revisable, always audit-logged when a human overrides it.
 */
export const ClusterStatus = z.enum(['auto_merged', 'needs_review', 'manually_confirmed', 'manually_split'])
export type ClusterStatus = z.infer<typeof ClusterStatus>

export const IdentityCluster = z.object({
  id: z.string().uuid(),
  status: ClusterStatus,
  /** Fellegi-Sunter-derived score for the weakest pairwise link inside the cluster, 0-1. */
  cohesionScore: z.number().min(0).max(1),
  primaryEntityId: z.string().uuid(), // the "canonical" node used for display
  createdAt: z.coerce.date(),
  reviewedByUserId: z.string().uuid().nullable(),
  reviewedAt: z.coerce.date().nullable(),
})
export type IdentityCluster = z.infer<typeof IdentityCluster>

export const MergeCandidate = z.object({
  entityAId: z.string().uuid(),
  entityBId: z.string().uuid(),
  score: z.number().min(0).max(1),
  matchedOn: z.array(z.string()), // e.g. ["name:jaro_winkler=0.94", "dob_year:exact", "address:overlap"]
})
export type MergeCandidate = z.infer<typeof MergeCandidate>
