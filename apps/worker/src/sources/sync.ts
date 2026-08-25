import { eq } from 'drizzle-orm'
import type { Database } from '@osint/db'
import { source } from '@osint/db/schema'
import { CONNECTOR_REGISTRY } from '@osint/connectors'

/**
 * Upserts every connector in CONNECTOR_REGISTRY into the `source` table,
 * correcting `name`/`category`/`costType`/`robotsPolicy` on every run. This
 * is the ONE place those fields get corrected — the worker's hot-path
 * `getOrCreateSource` (run-search.ts) deliberately never updates an
 * existing row, so a display-name fix to a connector's metadata used to
 * never reach the DB until this existed (claim cards and exported exhibits
 * would keep citing a source by a stale name). `enabled` is deliberately
 * excluded from the update — that's an admin-owned runtime toggle
 * (PATCH /api/admin/sources/[id]), and this sync must never clobber it.
 *
 * Called on worker startup (index.ts) and exposed as a standalone script
 * (`pnpm --filter @osint/worker sync-sources`) for a "fix source names
 * without restarting the worker" escape hatch.
 */
export async function syncSourceRegistry(db: Database): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

  for (const meta of CONNECTOR_REGISTRY) {
    const [existing] = await db.select().from(source).where(eq(source.connectorId, meta.id))
    if (!existing) {
      await db.insert(source).values({
        connectorId: meta.id,
        name: meta.name,
        category: meta.category,
        costType: meta.costType,
        robotsPolicy: meta.robotsPolicy,
        enabled: meta.enabledByDefault,
      })
      created++
      continue
    }
    if (existing.name !== meta.name || existing.category !== meta.category || existing.costType !== meta.costType || existing.robotsPolicy !== meta.robotsPolicy) {
      await db.update(source).set({
        name: meta.name,
        category: meta.category,
        costType: meta.costType,
        robotsPolicy: meta.robotsPolicy,
        // enabled intentionally omitted — admin-owned, see doc comment above.
      }).where(eq(source.connectorId, meta.id))
      updated++
    }
  }

  return { created, updated }
}
