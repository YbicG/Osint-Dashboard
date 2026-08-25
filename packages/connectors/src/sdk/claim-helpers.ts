import type { Predicate, ClaimValue, EntityType } from '@osint/contracts'
import type { DraftClaim } from './types'

export interface ClaimOptions {
  observedAt?: Date | null
  confidence?: number
  rawSnippet?: string | null
  evidenceUrl?: string | null
  relatedEntity?: { type: EntityType; label: string }
}

/** Ergonomic constructor for the common case — a claim about the primary search subject. */
export function claim(predicate: Predicate, value: ClaimValue, opts: ClaimOptions = {}): DraftClaim {
  return {
    subjectRef: 'primary',
    predicate,
    value,
    relatedEntity: opts.relatedEntity,
    observedAt: opts.observedAt ?? null,
    confidence: opts.confidence ?? 0.75,
    rawSnippet: opts.rawSnippet ?? null,
    evidenceUrl: opts.evidenceUrl ?? null,
  }
}

/** A relationship claim — implies a second entity, created/resolved by the ingest pipeline. */
export function relationshipClaim(
  predicate: Predicate,
  relatedEntity: { type: EntityType; label: string },
  opts: ClaimOptions = {},
): DraftClaim {
  return claim(predicate, { relatedEntityLabel: relatedEntity.label }, { ...opts, relatedEntity })
}
