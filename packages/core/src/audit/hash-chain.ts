import { createHash } from 'node:crypto'
import { eq, desc } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { auditLog } from '@osint/db/schema'

export interface AuditEntryInput {
  userId: string
  action: string
  targetType?: string | null
  targetId?: string | null
  purposeCode?: string | null
  metadata?: Record<string, unknown>
}

function canonicalize(obj: Record<string, unknown>): string {
  // Deterministic JSON: sorted keys, no whitespace. Sufficient for our flat
  // metadata objects — if nested objects ever get deep, swap for a proper
  // canonical-JSON library, but don't add that dependency preemptively.
  return JSON.stringify(obj, Object.keys(obj).sort())
}

/**
 * Appends one entry to the hash-chained audit log. Must be the *only*
 * write path into audit_log in the codebase — every mutation that should be
 * accountable (search, merge/split, case close, export) calls this.
 */
export async function appendAuditEntry(db: Database, entry: AuditEntryInput) {
  const [last] = await db.select({ entryHash: auditLog.entryHash })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(1)

  const prevEntryHash = last?.entryHash ?? null
  const createdAt = new Date()
  const payload = canonicalize({
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    purposeCode: entry.purposeCode ?? null,
    metadata: entry.metadata ?? {},
    createdAt: createdAt.toISOString(),
    prevEntryHash,
  })
  const entryHash = createHash('sha256').update(payload).digest('hex')

  const [row] = await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    purposeCode: entry.purposeCode ?? null,
    metadata: entry.metadata ?? {},
    createdAt,
    prevEntryHash,
    entryHash,
  }).returning()

  return row
}

export interface ChainVerificationResult {
  valid: boolean
  brokenAtId: string | null
  entriesChecked: number
}

/** Walks the full chain and recomputes each hash — detects any tampering or deletion. */
export async function verifyAuditChain(db: Database): Promise<ChainVerificationResult> {
  const rows = await db.select().from(auditLog).orderBy(auditLog.createdAt)

  let prevEntryHash: string | null = null
  for (const row of rows) {
    const payload = canonicalize({
      userId: row.userId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      purposeCode: row.purposeCode,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
      prevEntryHash,
    })
    const expectedHash = createHash('sha256').update(payload).digest('hex')
    if (expectedHash !== row.entryHash || row.prevEntryHash !== prevEntryHash) {
      return { valid: false, brokenAtId: row.id, entriesChecked: rows.length }
    }
    prevEntryHash = row.entryHash
  }
  return { valid: true, brokenAtId: null, entriesChecked: rows.length }
}
