import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { appUser } from './org'

/**
 * Hash-chained append-only log (see contracts/case.ts AuditLog doc comment).
 * `entryHash = sha256(prevEntryHash || canonicalJson(rest of row))`, computed
 * application-side in packages/core/audit.ts. No UPDATE/DELETE should ever
 * be issued against this table — enforce via a DB role grant when the app
 * moves to a real deployment.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  purposeCode: text('purpose_code'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  prevEntryHash: text('prev_entry_hash'),
  entryHash: text('entry_hash').notNull(),
}, (t) => [
  index('audit_log_user_idx').on(t.userId),
  index('audit_log_created_idx').on(t.createdAt),
])
