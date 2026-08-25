import { pgTable, uuid, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core'
import { caseStatusEnum } from './enums'
import { org, appUser } from './org'
import { entity } from './entity'

export const caseTable = pgTable('case', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id),
  title: text('title').notNull(),
  status: caseStatusEnum('status').notNull().default('open'),
  purposeCode: text('purpose_code').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  biometricDataPurged: boolean('biometric_data_purged').notNull().default(false),
}, (t) => [index('case_org_idx').on(t.orgId)])

export const subject = pgTable('subject', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => caseTable.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').references(() => entity.id),
  label: text('label').notNull(),
  addedByUserId: uuid('added_by_user_id').notNull().references(() => appUser.id),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  monitoringEnabled: boolean('monitoring_enabled').notNull().default(false),
  monitoringIntervalHours: integer('monitoring_interval_hours'),
}, (t) => [index('subject_case_idx').on(t.caseId)])

export const caseNote = pgTable('case_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => caseTable.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').notNull().references(() => appUser.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const caseAttachment = pgTable('case_attachment', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => caseTable.id, { onDelete: 'cascade' }),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => appUser.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
})
