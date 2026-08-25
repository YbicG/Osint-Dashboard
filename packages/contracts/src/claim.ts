import { z } from 'zod'
import { Predicate } from './predicate'

/**
 * The central design decision of this platform: we never write
 * `person.address = X`. We write "source S asserted address X for entity E
 * at time T" as an immutable, append-only Claim. Every field rendered in the
 * UI traces back to one or more of these — that provenance chain is what
 * makes a dossier defensible rather than a hallucination-shaped guess.
 *
 * Consequences:
 *  - Claims are never updated or deleted, only superseded (retracted_at set).
 *  - Two claims disagreeing (two DOBs) is not an error state, it's the
 *    normal case — the UI surfaces conflicts rather than picking a winner.
 *  - `confidence` is the connector's own estimate (parse quality, name-match
 *    strength); it is distinct from entity-resolution confidence, which
 *    lives on identity_cluster.
 */
export const ClaimValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()), // structured payloads (e.g. a full court case object)
])
export type ClaimValue = z.infer<typeof ClaimValue>

export const Claim = z.object({
  id: z.string().uuid(),
  subjectEntityId: z.string().uuid(),
  /** For relationship-shaped predicates, the other side of the edge. */
  objectEntityId: z.string().uuid().nullable(),
  predicate: Predicate,
  value: ClaimValue,
  sourceId: z.string().uuid(),
  collectionRunId: z.string().uuid(),
  /** When the source says this fact was/is true, not when we scraped it. */
  observedAt: z.coerce.date().nullable(),
  /** When we collected it. */
  collectedAt: z.coerce.date(),
  /** Connector's own confidence in this specific extraction, 0-1. */
  confidence: z.number().min(0).max(1),
  /** Verbatim text/HTML fragment the value was parsed from, for human review. */
  rawSnippet: z.string().nullable(),
  /** Deep link back to the source page/record. */
  evidenceUrl: z.string().url().nullable(),
  /** sha256 of an archived full-page screenshot in evidence storage (MinIO). */
  screenshotSha256: z.string().nullable(),
  /** Set when a later, higher-confidence claim or manual review supersedes this one. Never deleted. */
  retractedAt: z.coerce.date().nullable(),
  retractedReason: z.string().nullable(),
})
export type Claim = z.infer<typeof Claim>

export const NewClaim = Claim.omit({ id: true, collectedAt: true, retractedAt: true, retractedReason: true }).extend({
  collectedAt: z.coerce.date().optional(),
})
export type NewClaim = z.infer<typeof NewClaim>
