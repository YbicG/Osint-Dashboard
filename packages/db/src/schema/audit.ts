import { pgTable, uuid, text, timestamp, jsonb, index, bigserial, uniqueIndex } from 'drizzle-orm/pg-core'
import { appUser } from './org'

/**
 * Hash-chained append-only log (see contracts/case.ts AuditLog doc comment).
 * `entryHash = sha256(prevEntryHash || canonicalJson(rest of row))`, computed
 * application-side in packages/core/audit/hash-chain.ts. No UPDATE/DELETE
 * should ever be issued against this table — enforce via a DB role grant
 * (`REVOKE UPDATE, DELETE ON audit_log`) when the app moves to a real
 * deployment.
 *
 * `seq` is the chain's real ordering — `createdAt` is not monotonic under
 * concurrent inserts (two transactions can get the same millisecond, or
 * commit out of the order their clocks suggest), so chaining and verifying
 * by `createdAt` let the tamper-evident log self-report `valid: false` with
 * no attacker involved. `seq` is a bigserial, assigned by Postgres at
 * insert time, and is what appendAuditEntry/verifyAuditChain order by.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull(),
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
  uniqueIndex('audit_log_seq_uidx').on(t.seq),
])
