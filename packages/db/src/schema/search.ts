import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { appUser } from './org'
import { caseTable } from './case'
import { entity } from './entity'

export const searchRequest = pgTable('search_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => caseTable.id),
  subjectEntityId: uuid('subject_entity_id').references(() => entity.id),
  inputType: text('input_type').notNull(),
  inputPayload: jsonb('input_payload').notNull(),
  purposeCode: text('purpose_code').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
