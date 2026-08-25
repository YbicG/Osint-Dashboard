import { sql } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity } from '@osint/db/schema'
import type { SearchInput, EntityType } from '@osint/contracts'
import { computeMatchKey } from '@osint/core'

function inputEntityType(input: SearchInput): EntityType {
  switch (input.type) {
    case 'person_name': return 'person'
    case 'address': return 'address'
    case 'image_face': return 'image'
    case 'phone_e164': return 'phone'
    case 'email': return 'email'
    case 'username': return 'username'
    case 'domain': return 'domain'
    case 'ip_address': return 'ip_address'
    case 'license_plate':
    case 'vin': return 'vehicle'
    case 'crypto_wallet': return 'crypto_wallet'
    case 'docket_number': return 'court_case'
    case 'ssn_last4': return 'person'
    default: return 'person'
  }
}

function inputDisplayLabel(input: SearchInput): string {
  switch (input.type) {
    case 'person_name': return input.fullName
    case 'address': return input.raw
    case 'image_face': return `Face search (${input.imageSha256.slice(0, 12)})`
    default: return input.value
  }
}

/**
 * Finds or creates the Entity that a search's claims attach to as
 * `subjectRef: 'primary'`.
 *
 * Identifier-shaped inputs (phone/email/username/domain/ip/address/...) ARE
 * their own identity — re-searching "+15125550100" should land on the same
 * phone entity every time. This used to be done with a select-then-compare
 * that called two *different* normalizer functions on the two sides of the
 * comparison (normalizeAddress on the input, normalizeForMatch on the
 * stored label) — for addresses those never agree, so every address search
 * minted a duplicate entity. It's now a single atomic
 * `INSERT ... ON CONFLICT (type, match_key) DO NOTHING` against a DB-level
 * partial unique index, with `match_key` computed by exactly one function
 * (computeMatchKey) and compared only against itself — the two-normalizer
 * mismatch is structurally impossible now, not just fixed for this case.
 *
 * `person_name` (and `image_face`) inputs are NOT unique identifiers —
 * "John Smith" doesn't name one person. Every such search creates a fresh
 * person entity (computeMatchKey returns null, so there's nothing to
 * conflict on); packages/core's entity-resolution scorer then decides, once
 * claims (DOB, phone, address, relatives) have been collected, whether to
 * auto-merge it into an existing cluster (see post-collection-resolve.ts).
 * This mirrors how real MDM/entity-resolution systems work: observe first,
 * cluster second — never guess identity from a name string alone.
 */
export async function findOrCreateSubjectEntity(db: Database, input: SearchInput): Promise<{ entityId: string; isNew: boolean }> {
  const type = inputEntityType(input)
  const label = inputDisplayLabel(input)
  const matchKey = computeMatchKey(type, label)

  if (matchKey === null) {
    const [created] = await db.insert(entity).values({ type, displayLabel: label }).returning()
    return { entityId: created!.id, isNew: true }
  }

  // Single round trip, race-safe under concurrent inserts of the same
  // identifier: the unique index makes the losing transaction's INSERT
  // conflict rather than silently duplicate, and RETURNING id together with
  // a fallback select handles both the winner and loser paths.
  const inserted = await db
    .insert(entity)
    .values({ type, displayLabel: label, matchKey })
    // Must repeat the partial index's predicate here — Postgres only infers
    // a partial unique index as an ON CONFLICT target when the WHERE clause
    // matches exactly (see entity_type_match_key_uidx in schema/entity.ts).
    .onConflictDoNothing({ target: [entity.type, entity.matchKey], where: sql`${entity.matchKey} is not null` })
    .returning({ id: entity.id })

  if (inserted[0]) return { entityId: inserted[0].id, isNew: true }

  const [existing] = await db
    .select({ id: entity.id })
    .from(entity)
    .where(sql`${entity.type} = ${type} and ${entity.matchKey} = ${matchKey}`)
  if (!existing) {
    // Extremely unlikely (would require the row to have been deleted
    // between the failed insert and this select) but fail loudly rather
    // than silently minting a duplicate.
    throw new Error(`findOrCreateSubjectEntity: conflict on (${type}, ${matchKey}) but no row found on fallback select`)
  }
  return { entityId: existing.id, isNew: false }
}
