import { pgTable, uuid, text, boolean, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { sourceCategoryEnum, sourceCostTypeEnum, collectionRunStatusEnum } from './enums'
import { searchRequest } from './search'

export const source = pgTable('source', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectorId: text('connector_id').notNull().unique(),
  name: text('name').notNull(),
  category: sourceCategoryEnum('category').notNull(),
  costType: sourceCostTypeEnum('cost_type').notNull(),
  jurisdiction: text('jurisdiction'),
  homepageUrl: text('homepage_url'),
  tosUrl: text('tos_url'),
  robotsPolicy: text('robots_policy', { enum: ['honor', 'override'] }).notNull().default('honor'),
  enabled: boolean('enabled').notNull().default(true),
})

export const collectionRun = pgTable('collection_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  searchId: uuid('search_id').notNull().references(() => searchRequest.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => source.id),
  connectorId: text('connector_id').notNull(),
  status: collectionRunStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  claimsProduced: integer('claims_produced').notNull().default(0),
  errorMessage: text('error_message'),
  requestArchiveSha256: text('request_archive_sha256'),
  responseArchiveSha256: text('response_archive_sha256'),
  screenshotSha256: text('screenshot_sha256'),
}, (t) => [
  index('collection_run_search_idx').on(t.searchId),
  index('collection_run_status_idx').on(t.status),
])
