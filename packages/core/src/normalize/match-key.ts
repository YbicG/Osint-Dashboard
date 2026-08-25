import type { EntityType } from '@osint/contracts'
import { normalizeForMatch } from './name'
import { normalizeAddress } from './address'

/**
 * Entity types that ARE their own identity — re-searching "+15125550100"
 * must always land on the same phone entity. `person`/`organization` are
 * deliberately excluded: a name string doesn't name one person, so every
 * person_name search mints a fresh entity and packages/core's
 * scorePersonMatch decides later, from collected claims, whether to cluster
 * it (see apps/worker/src/ingest/post-collection-resolve.ts).
 */
const IDENTIFIER_ENTITY_TYPES = new Set<EntityType>([
  'address', 'phone', 'email', 'username', 'vehicle', 'vessel', 'aircraft',
  'domain', 'ip_address', 'crypto_wallet', 'court_case', 'image', 'document',
])

/**
 * Computes the normalized dedup key for an entity, or null for types that
 * must never be deduped by value alone (person/organization).
 *
 * This is the ONLY function that may compute `entity.match_key` — it is
 * written once at insert time (packages/worker's resolve-subject.ts) and
 * compared against itself via a DB-level partial unique index on
 * `(type, match_key)`, which is what makes a mismatched pair of normalizer
 * calls structurally impossible rather than merely "fixed for now."
 */
export function computeMatchKey(type: EntityType, displayLabel: string): string | null {
  if (!IDENTIFIER_ENTITY_TYPES.has(type)) return null
  if (type === 'address') return normalizeAddress(displayLabel)
  return normalizeForMatch(displayLabel)
}
