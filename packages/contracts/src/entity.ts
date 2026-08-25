import { z } from 'zod'

/**
 * Every "thing" the platform reasons about is an Entity. Entities never carry
 * their own data fields directly (see claim.ts for why) — an Entity is just a
 * typed, addressable node that claims and edges attach to.
 */
export const EntityType = z.enum([
  'person',
  'organization',
  'address',
  'phone',
  'email',
  'username',
  'vehicle',
  'vessel',
  'aircraft',
  'domain',
  'ip_address',
  'crypto_wallet',
  'court_case',
  'image',
  'document',
])
export type EntityType = z.infer<typeof EntityType>

export const Entity = z.object({
  id: z.string().uuid(),
  type: EntityType,
  /** Stable, human-scannable label derived from the current best claims — never authoritative on its own. */
  displayLabel: z.string(),
  /** Identity-cluster this entity currently belongs to (see identity_cluster table / core resolution). */
  clusterId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Entity = z.infer<typeof Entity>

export const EntityAlias = z.object({
  id: z.string().uuid(),
  entityId: z.string().uuid(),
  alias: z.string(),
  aliasType: z.enum(['aka', 'maiden_name', 'nickname', 'misspelling', 'transliteration', 'username', 'business_dba']),
  sourceId: z.string().uuid(),
})
export type EntityAlias = z.infer<typeof EntityAlias>
