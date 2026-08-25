import { createHash } from 'node:crypto'
import { sql, asc } from 'drizzle-orm'
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

/**
 * Arbitrary fixed key for the audit-chain advisory lock (see appendAuditEntry).
 * Any int8 works — it just needs to be the same constant everywhere so
 * concurrent appends serialize against each other. Not derived from
 * anything, so it can't collide with a different subsystem's advisory lock
 * key by coincidence of hashing the same string.
 *
 * A plain number, not a BigInt literal — pg_advisory_xact_lock accepts a
 * bigint parameter, but the value itself is well within
 * Number.MAX_SAFE_INTEGER, and a `847_291_003n` literal requires an ES2020+
 * compile target. apps/web's tsconfig doesn't extend the shared config (a
 * separate, larger-scope M0 item), so anything in its dependency graph gets
 * typechecked at apps/web's lower target — a plain number sidesteps that
 * without touching tsconfig target settings here.
 */
const AUDIT_CHAIN_LOCK_KEY = 847_291_003

/**
 * Deterministic canonical JSON: recursively sorts object keys at every
 * depth (not just the top level — a plain `JSON.stringify(obj, keys.sort())`
 * replacer-array only reorders top-level properties, so nested `metadata`
 * hashes differently depending on insertion order even when logically
 * identical), preserves array order, and rejects `undefined` so a
 * accidentally-omitted field can't silently change the hash input shape
 * between two logically-equal calls.
 */
export function canonicalize(value: unknown): string {
  return stringify(value)
}

function stringify(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalize: undefined is not permitted in audit payloads')
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringify(v ?? null)).join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(',')}}`
  }
  throw new TypeError(`canonicalize: unsupported value type ${typeof value}`)
}

function hashEntry(fields: {
  userId: string
  action: string
  targetType: string | null
  targetId: string | null
  purposeCode: string | null
  metadata: unknown
  createdAt: string
  prevEntryHash: string | null
}): string {
  return createHash('sha256').update(canonicalize(fields)).digest('hex')
}

/**
 * Appends one entry to the hash-chained audit log. Must be the *only*
 * write path into audit_log in the codebase — every mutation that should be
 * accountable (search, merge/split, case close, export) calls this.
 *
 * Runs inside its own transaction holding a session-scoped advisory lock
 * (`pg_advisory_xact_lock`), so "read the last hash, compute the next one,
 * insert" is atomic across concurrent callers — without the lock, two
 * concurrent appends can both read the same `prevEntryHash`, and the loser's
 * insert produces a chain that `verifyAuditChain` correctly reports broken
 * even though nobody tampered with anything. The lock is released
 * automatically at transaction end (commit or rollback).
 *
 * NOTE: this opens its own transaction rather than accepting one from the
 * caller, so an audit entry can still land even if the mutation it
 * describes rolls back afterward for an unrelated reason. Threading a
 * shared transaction handle through every one of the ~8 call sites is real
 * future work (see docs/RUNBOOK.md) but out of scope here — the chain
 * integrity bug (this function's actual defect) is fixed regardless.
 */
export async function appendAuditEntry(db: Database, entry: AuditEntryInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`)

    const [last] = await tx.select({ entryHash: auditLog.entryHash })
      .from(auditLog)
      .orderBy(sql`${auditLog.seq} desc`)
      .limit(1)

    const prevEntryHash = last?.entryHash ?? null
    const createdAt = new Date()
    const targetType = entry.targetType ?? null
    const targetId = entry.targetId ?? null
    const purposeCode = entry.purposeCode ?? null
    const metadata = entry.metadata ?? {}

    const entryHash = hashEntry({
      userId: entry.userId,
      action: entry.action,
      targetType,
      targetId,
      purposeCode,
      metadata,
      createdAt: createdAt.toISOString(),
      prevEntryHash,
    })

    const [row] = await tx.insert(auditLog).values({
      userId: entry.userId,
      action: entry.action,
      targetType,
      targetId,
      purposeCode,
      metadata,
      createdAt,
      prevEntryHash,
      entryHash,
    }).returning()

    return row
  })
}

export interface ChainVerificationResult {
  valid: boolean
  brokenAtId: string | null
  entriesChecked: number
}

/** Walks the full chain in `seq` order and recomputes each hash — detects any tampering or deletion. */
export async function verifyAuditChain(db: Database): Promise<ChainVerificationResult> {
  const rows = await db.select().from(auditLog).orderBy(asc(auditLog.seq))

  let prevEntryHash: string | null = null
  for (const row of rows) {
    const expectedHash = hashEntry({
      userId: row.userId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      purposeCode: row.purposeCode,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
      prevEntryHash,
    })
    if (expectedHash !== row.entryHash || row.prevEntryHash !== prevEntryHash) {
      return { valid: false, brokenAtId: row.id, entriesChecked: rows.length }
    }
    prevEntryHash = row.entryHash
  }
  return { valid: true, brokenAtId: null, entriesChecked: rows.length }
}
