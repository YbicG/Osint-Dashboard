import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { entityTypeEnum } from './enums'
import { identityCluster } from './identity'

export const entity = pgTable('entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: entityTypeEnum('type').notNull(),
  displayLabel: text('display_label').notNull(),
  clusterId: uuid('cluster_id').references(() => identityCluster.id),
  /**
   * Normalized dedup key for "identifier" entity types (phone/email/address/
   * domain/...) — see packages/core's computeMatchKey, the ONLY function
   * that may write this column. Null for person/organization, which are
   * deliberately never deduped by value (see computeMatchKey's doc comment).
   * The partial unique index below is what makes a duplicate identifier
   * entity a constraint violation rather than a possibility that depends on
   * two normalizer functions staying in agreement.
   */
  matchKey: text('match_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('entity_type_idx').on(t.type),
  index('entity_cluster_idx').on(t.clusterId),
  uniqueIndex('entity_type_match_key_uidx').on(t.type, t.matchKey).where(sql`${t.matchKey} is not null`),
  // trigram index for fuzzy display-label search is added in a raw-SQL migration (pg_trgm gin).
])

export const entityAlias = pgTable('entity_alias', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  aliasType: text('alias_type', {
    enum: ['aka', 'maiden_name', 'nickname', 'misspelling', 'transliteration', 'username', 'business_dba'],
  }).notNull(),
  sourceId: uuid('source_id').notNull(),
}, (t) => [
  index('entity_alias_entity_idx').on(t.entityId),
  index('entity_alias_alias_idx').on(t.alias),
])
