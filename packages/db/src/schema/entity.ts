import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { entityTypeEnum } from './enums'
import { identityCluster } from './identity'

export const entity = pgTable('entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: entityTypeEnum('type').notNull(),
  displayLabel: text('display_label').notNull(),
  clusterId: uuid('cluster_id').references(() => identityCluster.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('entity_type_idx').on(t.type),
  index('entity_cluster_idx').on(t.clusterId),
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
