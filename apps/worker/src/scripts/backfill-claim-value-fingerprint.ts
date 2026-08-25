import '../load-env.js' // must stay the first import — see load-env.ts's doc comment
import { sql } from 'drizzle-orm'
import { db, schema } from '@osint/db'
import { computeValueFingerprint } from '@osint/core'

const BATCH_SIZE = 500

/**
 * One-off data backfill for migrations/0006_concerned_diamondback.sql +
 * 0007_claim_value_fingerprint_not_null.sql: 0006 adds `claim.value_fingerprint`
 * as NULLABLE (existing rows have no value for it and there's no safe
 * SQL-only default), this script fills it in for every existing row using
 * the real predicate-aware computeValueFingerprint() logic from
 * packages/core/src/monitoring/claim-fingerprint.ts (the exact function the
 * rest of the fingerprinting feature uses — not a guessed/approximated SQL
 * expression), and 0007 then locks the column down with NOT NULL.
 *
 * Required run order:
 *   1. pnpm db:migrate                                    (applies 0006, nullable)
 *   2. pnpm --filter @osint/worker backfill-claim-value-fingerprint   (this script)
 *   3. pnpm db:migrate                                    (applies 0007, NOT NULL)
 *
 * Safe to re-run: every row's fingerprint is recomputed deterministically
 * from its own predicate/value, so re-running just overwrites with the same
 * result. Only rows still missing a fingerprint are touched.
 */
async function main() {
  const rows = await db
    .select({
      id: schema.claim.id,
      predicate: schema.claim.predicate,
      value: schema.claim.value,
    })
    .from(schema.claim)
    .where(sql`${schema.claim.valueFingerprint} IS NULL`)

  console.log(`Backfilling value_fingerprint for ${rows.length} claim row(s)...`)

  let updated = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (row) => {
        try {
          const fingerprint = computeValueFingerprint(row.predicate, row.value)
          await db.execute(
            sql`UPDATE "claim" SET "value_fingerprint" = ${fingerprint} WHERE "id" = ${row.id}`,
          )
          updated++
        } catch (err) {
          failed++
          console.error(`  Failed to fingerprint claim ${row.id} (predicate=${row.predicate}):`, err)
        }
      }),
    )
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} processed...`)
  }

  console.log(`Backfill complete: ${updated} updated, ${failed} failed.`)

  if (failed > 0) {
    console.error(
      `${failed} row(s) could not be fingerprinted and are still NULL. Resolve these before running the follow-up NOT NULL migration (0007), or it will fail with a 23502 error.`,
    )
    process.exit(1)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
