import { pgTable, uuid, text, timestamp, real, jsonb, index } from 'drizzle-orm/pg-core'
import { Predicate } from '@osint/contracts'
import { entity } from './entity'
import { source, collectionRun } from './source'

export const claim = pgTable('claim', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectEntityId: uuid('subject_entity_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  objectEntityId: uuid('object_entity_id').references(() => entity.id, { onDelete: 'cascade' }),
  predicate: text('predicate', { enum: Predicate.options as [string, ...string[]] }).notNull(),
  value: jsonb('value').notNull(),
  sourceId: uuid('source_id').notNull().references(() => source.id),
  collectionRunId: uuid('collection_run_id').notNull().references(() => collectionRun.id, { onDelete: 'cascade' }),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  confidence: real('confidence').notNull(),
  rawSnippet: text('raw_snippet'),
  evidenceUrl: text('evidence_url'),
  screenshotSha256: text('screenshot_sha256'),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
  retractedReason: text('retracted_reason'),
}, (t) => [
  index('claim_subject_idx').on(t.subjectEntityId),
  index('claim_object_idx').on(t.objectEntityId),
  index('claim_predicate_idx').on(t.predicate),
  index('claim_source_idx').on(t.sourceId),
  index('claim_subject_predicate_idx').on(t.subjectEntityId, t.predicate),
])
