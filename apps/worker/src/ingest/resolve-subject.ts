import { eq } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { entity } from '@osint/db/schema'
import type { SearchInput, EntityType } from '@osint/contracts'
import { normalizeForMatch, normalizeAddress } from '@osint/core'

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

/** Normalized key used to dedupe "identifier" entities (phone/email/username/domain/ip/address) — these ARE their own identity, unlike a bare name. */
function identifierBlockingKey(input: SearchInput): string | null {
  switch (input.type) {
    case 'phone_e164':
    case 'email':
    case 'username':
    case 'domain':
    case 'ip_address':
    case 'license_plate':
    case 'vin':
    case 'crypto_wallet':
    case 'docket_number':
      return normalizeForMatch(input.value)
    case 'address':
      return normalizeAddress(input.raw)
    default:
      return null
  }
}

/**
 * Finds or creates the Entity that a search's claims attach to as
 * `subjectRef: 'primary'`.
 *
 * Identifier-shaped inputs (phone/email/username/domain/ip/address/...) ARE
 * their own identity — re-searching "+15125550100" should land on the same
 * phone entity every time, so these are deduped by normalized value.
 *
 * `person_name` (and `image_face`) inputs are NOT unique identifiers —
 * "John Smith" doesn't name one person. Every such search creates a fresh
 * person entity; packages/core's entity-resolution scorer then decides,
 * once claims (DOB, phone, address, relatives) have been collected, whether
 * to auto-merge it into an existing cluster (see post-collection-resolve.ts).
 * This mirrors how real MDM/entity-resolution systems work: observe first,
 * cluster second — never guess identity from a name string alone.
 */
export async function findOrCreateSubjectEntity(db: Database, input: SearchInput): Promise<{ entityId: string; isNew: boolean }> {
  const type = inputEntityType(input)
  const label = inputDisplayLabel(input)
  const blockingKey = identifierBlockingKey(input)

  if (blockingKey) {
    const existing = await db.select({ id: entity.id, displayLabel: entity.displayLabel })
      .from(entity)
      .where(eq(entity.type, type))
    const match = existing.find((e) => normalizeForMatch(e.displayLabel) === blockingKey)
    if (match) return { entityId: match.id, isNew: false }
  }

  const [created] = await db.insert(entity).values({ type, displayLabel: label }).returning()
  return { entityId: created!.id, isNew: true }
}
