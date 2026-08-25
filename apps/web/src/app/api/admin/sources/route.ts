import { NextResponse } from 'next/server'
import { sql, desc } from 'drizzle-orm'
import { source, collectionRun } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

/**
 * Source health dashboard data: per-source run counts by outcome, most
 * recent run timestamp, and a rolling hit rate — everything an operator
 * needs to answer "which sources are actually working right now" without
 * grepping worker logs. Aggregated in SQL (one query, GROUP BY) rather than
 * pulled row-by-row and reduced in JS — collection_run can get large.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.select({
    sourceId: source.id,
    connectorId: source.connectorId,
    name: source.name,
    category: source.category,
    costType: source.costType,
    enabled: source.enabled,
    totalRuns: sql<number>`count(${collectionRun.id})`.mapWith(Number),
    hits: sql<number>`count(*) filter (where ${collectionRun.status} = 'hit')`.mapWith(Number),
    misses: sql<number>`count(*) filter (where ${collectionRun.status} = 'miss')`.mapWith(Number),
    blocked: sql<number>`count(*) filter (where ${collectionRun.status} = 'blocked')`.mapWith(Number),
    errors: sql<number>`count(*) filter (where ${collectionRun.status} = 'error')`.mapWith(Number),
    skippedCaptcha: sql<number>`count(*) filter (where ${collectionRun.status} = 'skipped_captcha')`.mapWith(Number),
    totalClaims: sql<number>`coalesce(sum(${collectionRun.claimsProduced}), 0)`.mapWith(Number),
    lastRunAt: sql<string | null>`max(${collectionRun.startedAt})`,
  })
    .from(source)
    .leftJoin(collectionRun, sql`${collectionRun.sourceId} = ${source.id}`)
    .groupBy(source.id)
    .orderBy(desc(sql`count(${collectionRun.id})`))

  return NextResponse.json({
    sources: rows.map((r) => ({
      ...r,
      hitRate: r.totalRuns > 0 ? r.hits / r.totalRuns : null,
    })),
  })
}
