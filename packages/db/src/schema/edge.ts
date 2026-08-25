import { pgTable, uuid, text, timestamp, real, index, primaryKey } from 'drizzle-orm/pg-core'
import { edgeTypeEnum } from './enums'
import { entity } from './entity'
import { claim } from './claim'

export const edge = pgTable('edge', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: edgeTypeEnum('type').notNull(),
  sourceEntityId: uuid('source_entity_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  targetEntityId: uuid('target_entity_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  label: text('label'),
  confidence: real('confidence').notNull(),
  firstObservedAt: timestamp('first_observed_at', { withTimezone: true }),
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
}, (t) => [
  index('edge_source_idx').on(t.sourceEntityId),
  index('edge_target_idx').on(t.targetEntityId),
  index('edge_type_idx').on(t.type),
])

/** Join table: which claims justify a given materialized edge (see contracts/edge.ts doc comment). */
export const edgeClaim = pgTable('edge_claim', {
  edgeId: uuid('edge_id').notNull().references(() => edge.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').notNull().references(() => claim.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.edgeId, t.claimId] })])
