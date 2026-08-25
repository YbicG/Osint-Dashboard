import { eq } from 'drizzle-orm'
import type Redis from 'ioredis'
import type { Database } from '@osint/db'
import { searchRequest, source, collectionRun } from '@osint/db/schema'
import type { SearchInput } from '@osint/contracts'
import { planConnectors, createConnectorFetch, ConnectorHttpError } from '@osint/connectors'
import { BrowserPool } from '@osint/browser'
import { findOrCreateSubjectEntity } from './resolve-subject'
import { ingestDraftClaim } from './ingest-claim'
import { runPostCollectionResolution } from './post-collection-resolve'
import { publishSearchEvent } from '../queue/events'

const CONNECTOR_CONCURRENCY = 6

async function getOrCreateSource(db: Database, connectorId: string, meta: { name: string; category: string; costType: string; robotsPolicy: string }) {
  const [existing] = await db.select().from(source).where(eq(source.connectorId, connectorId))
  if (existing) return existing
  const [created] = await db.insert(source).values({
    connectorId,
    name: meta.name,
    category: meta.category as never,
    costType: meta.costType as never,
    robotsPolicy: meta.robotsPolicy as 'honor' | 'override',
    enabled: true,
  }).returning()
  return created!
}

async function runOneConnector(params: {
  db: Database
  redis: Redis
  searchId: string
  primaryEntityId: string
  input: SearchInput
  connector: ReturnType<typeof planConnectors>[number]
  browserPool: BrowserPool
}) {
  const { db, redis, searchId, primaryEntityId, input, connector, browserPool } = params

  const src = await getOrCreateSource(db, connector.id, connector)
  const [run] = await db.insert(collectionRun).values({
    searchId, sourceId: src.id, connectorId: connector.id, status: 'running',
  }).returning()
  const runId = run!.id

  await publishSearchEvent(redis, searchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: 'running' })

  let claimsProduced = 0
  let finalStatus: 'hit' | 'miss' | 'blocked' | 'error' | 'skipped_captcha' = 'miss'
  let errorMessage: string | null = null

  try {
    const ctx = {
      input,
      fetch: createConnectorFetch(connector.id, connector.rateLimitPerMinute),
      browserPool: connector.transport === 'browser' ? browserPool : undefined,
      log: (msg: string) => publishSearchEvent(redis, searchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: `log:${msg}` }),
      apiKey: (envVar: string) => process.env[envVar] ?? null,
    }

    for await (const draft of connector.run(ctx)) {
      const { claimId } = await ingestDraftClaim(db, { draft, primaryEntityId, sourceId: src.id, collectionRunId: runId })
      claimsProduced++
      await publishSearchEvent(redis, searchId, { type: 'claim_ingested', connectorId: connector.id, predicate: draft.predicate, entityId: claimId })
    }
    finalStatus = claimsProduced > 0 ? 'hit' : 'miss'
  } catch (err) {
    if (err instanceof ConnectorHttpError) {
      finalStatus = err.classification
      errorMessage = err.message
    } else {
      finalStatus = 'error'
      errorMessage = err instanceof Error ? err.message : String(err)
    }
  }

  await db.update(collectionRun).set({
    status: finalStatus,
    finishedAt: new Date(),
    claimsProduced,
    errorMessage,
  }).where(eq(collectionRun.id, runId))

  await publishSearchEvent(redis, searchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: finalStatus })

  return { claimsProduced, status: finalStatus }
}

/** Simple concurrency-limited map — avoids pulling in p-limit for one call site. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * The whole pipeline for one search: plan -> fan out to connectors
 * (bounded concurrency, browser pool shared across the browser-transport
 * ones) -> ingest claims as they stream -> post-collection entity
 * resolution -> publish completion. This is the single function the BullMQ
 * processor (index.ts) calls per job.
 */
export async function runSearch(db: Database, redis: Redis, searchId: string): Promise<void> {
  const [req] = await db.select().from(searchRequest).where(eq(searchRequest.id, searchId))
  if (!req) throw new Error(`Search ${searchId} not found`)

  const input = { type: req.inputType, ...(req.inputPayload as object) } as SearchInput
  const { entityId: primaryEntityId } = await findOrCreateSubjectEntity(db, input)

  await db.update(searchRequest).set({ subjectEntityId: primaryEntityId }).where(eq(searchRequest.id, searchId))

  // Admin-disabled sources (apps/web's PATCH /api/admin/sources/[id]) are
  // filtered out here, at plan time — not per-connector inside
  // runOneConnector — so a disabled source is invisible to a search rather
  // than showing up as a chip that then does nothing. planConnectors()
  // itself only knows the connector's static enabledByDefault; this is the
  // DB-backed override on top of it.
  const disabledConnectorIds = new Set(
    (await db.select({ connectorId: source.connectorId }).from(source).where(eq(source.enabled, false)))
      .map((s) => s.connectorId),
  )
  const connectors = planConnectors(input).filter((c) => !disabledConnectorIds.has(c.id))
  await publishSearchEvent(redis, searchId, {
    type: 'plan',
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, category: c.category })),
  })

  const browserPool = new BrowserPool()
  try {
    const results = await mapWithConcurrency(connectors, CONNECTOR_CONCURRENCY, (connector) =>
      runOneConnector({ db, redis, searchId, primaryEntityId, input, connector, browserPool }),
    )

    if (input.type === 'person_name') {
      await runPostCollectionResolution(db, primaryEntityId)
    }

    const totalClaims = results.reduce((sum, r) => sum + r.claimsProduced, 0)
    await publishSearchEvent(redis, searchId, { type: 'search_complete', totalClaims, subjectEntityId: primaryEntityId })
  } catch (err) {
    await publishSearchEvent(redis, searchId, { type: 'search_error', message: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    await browserPool.stop()
  }
}
