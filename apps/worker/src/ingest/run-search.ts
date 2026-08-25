import { eq, and, gt } from 'drizzle-orm'
import type Redis from 'ioredis'
import type { Database } from '@osint/db'
import { searchRequest, source, collectionRun } from '@osint/db/schema'
import type { SearchInput, ConnectorMeta, Claim, Predicate } from '@osint/contracts'
import { planConnectors, createConnectorFetch, ConnectorHttpError } from '@osint/connectors'
import { deriveInputs, keyForInput, type DerivedInput } from '@osint/connectors/pivot'
import { BrowserPool } from '@osint/browser'
import { findOrCreateSubjectEntity } from './resolve-subject'
import { ingestDraftClaim } from './ingest-claim'
import { runPostCollectionResolution } from './post-collection-resolve'
import { publishSearchEvent } from '../queue/events'
import {
  createPivotBudgetState,
  evaluateCandidate,
  summarizeDecisions,
  DEFAULT_PIVOT_BUDGET_LIMITS,
  type PivotDecision,
} from './pivot-budget'

const CONNECTOR_CONCURRENCY = 6
const RECENT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Single atomic `ON CONFLICT DO NOTHING` rather than select-then-insert —
 * the prior version's two-step check-then-act raced under concurrent
 * searches hitting the same never-before-seen connector, and (separately)
 * used `DO NOTHING` semantics implicitly by never updating an existing row,
 * which is why a stale seed-time name never self-corrects (see
 * apps/worker/src/sources/sync.ts, which owns name corrections on startup —
 * this hot path deliberately does NOT `DO UPDATE`, so it can't stomp a
 * future admin edit to a source's display name).
 */
async function getOrCreateSource(db: Database, meta: ConnectorMeta) {
  const inserted = await db.insert(source).values({
    connectorId: meta.id,
    name: meta.name,
    category: meta.category,
    costType: meta.costType,
    robotsPolicy: meta.robotsPolicy,
    enabled: true,
  }).onConflictDoNothing({ target: source.connectorId }).returning()

  if (inserted[0]) return inserted[0]

  const [existing] = await db.select().from(source).where(eq(source.connectorId, meta.id))
  if (!existing) throw new Error(`getOrCreateSource: conflict on connectorId=${meta.id} but no row found on fallback select`)
  return existing
}

async function runOneConnector(params: {
  db: Database
  redis: Redis
  /** The search_request row this connector run's collection_run FK attaches to — the child's own id for a pivot wave, never the root's. */
  dbSearchId: string
  /** Where SSE events for this run are published — always the root's id, so a pivot's activity appears in the one live search page rather than a channel nobody is listening to. Equal to dbSearchId for a root (depth-0) search. */
  eventSearchId: string
  primaryEntityId: string
  input: SearchInput
  connector: ReturnType<typeof planConnectors>[number]
  browserPool: BrowserPool
}) {
  const { db, redis, dbSearchId, eventSearchId, primaryEntityId, input, connector, browserPool } = params

  const src = await getOrCreateSource(db, connector)
  const [run] = await db.insert(collectionRun).values({
    searchId: dbSearchId, sourceId: src.id, connectorId: connector.id, status: 'running',
  }).returning()
  const runId = run!.id

  await publishSearchEvent(redis, eventSearchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: 'running' })

  let claimsProduced = 0
  let finalStatus: 'hit' | 'miss' | 'blocked' | 'error' | 'skipped_captcha' = 'miss'
  let errorMessage: string | null = null
  const producedClaims: ProducedClaim[] = []

  try {
    const ctx = {
      input,
      fetch: createConnectorFetch(connector.id, connector.rateLimitPerMinute),
      browserPool: connector.transport === 'browser' ? browserPool : undefined,
      log: (msg: string) => publishSearchEvent(redis, eventSearchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: `log:${msg}` }),
      apiKey: (envVar: string) => process.env[envVar] ?? null,
    }

    for await (const draft of connector.run(ctx)) {
      const { claimId } = await ingestDraftClaim(db, { draft, primaryEntityId, sourceId: src.id, collectionRunId: runId })
      claimsProduced++
      producedClaims.push({ claimId, predicate: draft.predicate, value: draft.value, confidence: draft.confidence })
      await publishSearchEvent(redis, eventSearchId, { type: 'claim_ingested', connectorId: connector.id, predicate: draft.predicate, entityId: claimId })
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

  await publishSearchEvent(redis, eventSearchId, { type: 'connector_status', connectorId: connector.id, connectorName: connector.name, sourceId: src.id, status: finalStatus })

  return { claimsProduced, status: finalStatus, claims: producedClaims }
}

/** Just enough of a persisted Claim for deriveInputs() to read — see toDerivationClaim below. */
interface ProducedClaim {
  claimId: string
  predicate: Predicate
  value: Claim['value']
  confidence: number
}

/** deriveInputs() only ever reads predicate/value/confidence off a Claim; the rest of these fields are unused placeholders so the real shape can be passed without a broader interface change to a pure, already-tested function. */
function toDerivationClaim(pc: ProducedClaim, primaryEntityId: string): Claim {
  return {
    id: pc.claimId,
    subjectEntityId: primaryEntityId,
    objectEntityId: null,
    predicate: pc.predicate,
    value: pc.value,
    sourceId: '',
    collectionRunId: '',
    observedAt: null,
    collectedAt: new Date(),
    confidence: pc.confidence,
    rawSnippet: null,
    evidenceUrl: null,
    screenshotSha256: null,
    retractedAt: null,
    retractedReason: null,
  }
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

function planEnabledConnectors(input: SearchInput, disabledConnectorIds: Set<string>) {
  return planConnectors(input).filter((c) => !disabledConnectorIds.has(c.id))
}

/**
 * Run every enabled connector accepting `input` against one search_request
 * row: plan -> publish `plan` -> fan out (bounded concurrency, shared
 * browser pool) -> ingest claims as they stream. Used for both the root
 * search's wave 1 and, inline, for each pivot child's own wave — see
 * `dispatchPivots` below for why pivots run inline rather than as separate
 * BullMQ jobs.
 */
async function runConnectorWave(params: {
  db: Database
  redis: Redis
  dbSearchId: string
  eventSearchId: string
  primaryEntityId: string
  input: SearchInput
  disabledConnectorIds: Set<string>
  browserPool: BrowserPool
}) {
  const { db, redis, dbSearchId, eventSearchId, primaryEntityId, input, disabledConnectorIds, browserPool } = params
  const connectors = planEnabledConnectors(input, disabledConnectorIds)
  await publishSearchEvent(redis, eventSearchId, {
    type: 'plan',
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, category: c.category })),
  })

  const results = await mapWithConcurrency(connectors, CONNECTOR_CONCURRENCY, (connector) =>
    runOneConnector({ db, redis, dbSearchId, eventSearchId, primaryEntityId, input, connector, browserPool }),
  )

  return {
    totalClaims: results.reduce((sum, r) => sum + r.claimsProduced, 0),
    claims: results.flatMap((r) => r.claims),
  }
}

/**
 * Derive, budget, and inline-execute wave-2 pivot searches from wave 1's
 * claims. Adopts the plan's `search_request` model (a real child row per
 * derived input — audit, purpose-code attribution, and provenance all come
 * free) with one deliberate v1 simplification: children are executed
 * inline within this same call rather than round-tripped through a second
 * BullMQ job. The real queue architecture is async/multi-job (see
 * apps/worker/src/index.ts), which would otherwise force
 * `runPostCollectionResolution` to either race pivot completion or be
 * driven by a separate "all children done" signal that doesn't exist yet.
 * Inline execution keeps the plan's "resolution runs after wave 2"
 * ordering exactly true, at the cost of pivot children not getting their
 * own BullMQ retry semantics in this version.
 */
async function dispatchPivots(params: {
  db: Database
  redis: Redis
  rootSearchId: string
  parentSearchId: string
  primaryEntityId: string
  parentInput: SearchInput
  wave1Claims: ProducedClaim[]
  req: typeof searchRequest.$inferSelect
  browserPool: BrowserPool
  disabledConnectorIds: Set<string>
}): Promise<number> {
  const { db, redis, rootSearchId, parentSearchId, primaryEntityId, parentInput, wave1Claims, req, browserPool, disabledConnectorIds } = params

  const candidates: DerivedInput[] = wave1Claims.flatMap((pc) =>
    deriveInputs(toDerivationClaim(pc, primaryEntityId), parentInput),
  )
  if (candidates.length === 0) return 0

  // Dedup window: any search already run against this same subject in the
  // last 24h seeds `seen` too, so a re-run of an investigation doesn't
  // re-spend budget re-deriving searches it already has answers for.
  const sinceCutoff = new Date(Date.now() - RECENT_DUPLICATE_WINDOW_MS)
  const recentSiblings = await db.select({ inputType: searchRequest.inputType, inputPayload: searchRequest.inputPayload })
    .from(searchRequest)
    .where(and(eq(searchRequest.subjectEntityId, primaryEntityId), gt(searchRequest.createdAt, sinceCutoff)))
  const seedKeys = [
    keyForInput(parentInput),
    ...recentSiblings.map((s) => keyForInput({ type: s.inputType, ...(s.inputPayload as object) } as SearchInput)),
  ]

  let totalWave2Claims = 0
  const decisions: PivotDecision[] = []
  const dispatchedChildren: { childId: string; input: SearchInput; viaPredicate: string }[] = []

  // The durable connector-run ceiling lives on the root row; a row lock for
  // the duration of this evaluation is the "single-statement CAS" the plan
  // asks for, scoped to one root's pivot dispatch at a time.
  await db.transaction(async (tx) => {
    const [rootRow] = await tx.select().from(searchRequest).where(eq(searchRequest.id, rootSearchId)).for('update')
    if (!rootRow) return

    const state = createPivotBudgetState(seedKeys, rootRow.connectorBudgetUsed)
    const limits = { ...DEFAULT_PIVOT_BUDGET_LIMITS, maxConnectorRuns: rootRow.connectorBudget }

    for (const candidate of candidates) {
      const estimatedConnectorRuns = Math.max(1, planEnabledConnectors(candidate.input, disabledConnectorIds).length)
      const decision = evaluateCandidate(candidate, state, req.pivotDepth, estimatedConnectorRuns, limits)
      decisions.push(decision)
      if (!decision.accepted) continue

      const [child] = await tx.insert(searchRequest).values({
        caseId: req.caseId,
        subjectEntityId: primaryEntityId, // inherits the root's primary entity — never a fresh findOrCreateSubjectEntity call, or the subject fragments across a dozen entities
        inputType: candidate.input.type,
        inputPayload: candidate.input,
        purposeCode: req.purposeCode,
        requestedByUserId: req.requestedByUserId,
        parentSearchId,
        rootSearchId,
        pivotDepth: req.pivotDepth + 1,
        origin: 'auto_pivot',
        derivedFromClaimId: candidate.viaClaimId,
        connectorBudget: rootRow.connectorBudget,
        connectorBudgetUsed: 0,
      }).returning()
      dispatchedChildren.push({ childId: child!.id, input: candidate.input, viaPredicate: candidate.viaPredicate })
    }

    await tx.update(searchRequest).set({ connectorBudgetUsed: state.connectorRunsUsed }).where(eq(searchRequest.id, rootSearchId))
  })

  const summary = summarizeDecisions(decisions)
  await publishSearchEvent(redis, rootSearchId, { type: 'pivot_summary', ...summary })

  for (const { childId, input: childInput, viaPredicate } of dispatchedChildren) {
    await publishSearchEvent(redis, rootSearchId, { type: 'pivot_dispatched', childSearchId: childId, inputType: childInput.type, viaPredicate })
    const wave = await runConnectorWave({
      db, redis, dbSearchId: childId, eventSearchId: rootSearchId, primaryEntityId, input: childInput, disabledConnectorIds, browserPool,
    })
    totalWave2Claims += wave.totalClaims
  }

  return totalWave2Claims
}

/**
 * The whole pipeline for one search: plan -> fan out to connectors
 * (bounded concurrency, browser pool shared across the browser-transport
 * ones) -> ingest claims as they stream -> derive and inline-run one wave
 * of pivot children -> post-collection entity resolution (now unconditional
 * — see dispatchPivots's doc comment on why resolution must wait for wave
 * 2) -> publish completion. This is the single function the BullMQ
 * processor (index.ts) calls per job.
 */
export async function runSearch(db: Database, redis: Redis, searchId: string): Promise<void> {
  const [req] = await db.select().from(searchRequest).where(eq(searchRequest.id, searchId))
  if (!req) throw new Error(`Search ${searchId} not found`)

  const input = { type: req.inputType, ...(req.inputPayload as object) } as SearchInput

  // A manual-expand child (see apps/web's POST /api/entities/[id]/expand)
  // already has subjectEntityId set at creation time to the root's primary
  // entity — never re-resolve it here. Calling findOrCreateSubjectEntity
  // against the *derived* input (an email, an address, ...) would mint or
  // match a completely different entity and fragment the subject across
  // several disconnected dossiers, exactly what the plan's pivot model
  // exists to avoid. Only a fresh, not-yet-resolved search (subjectEntityId
  // still null — true for every root search created by POST /api/search)
  // goes through resolution here.
  const primaryEntityId = req.subjectEntityId ?? (await findOrCreateSubjectEntity(db, input)).entityId

  // A root search records itself as its own root (rather than leaving it
  // null) so later queries — the Sources tab, the 24h duplicate check above
  // — can always join on rootSearchId without a special-cased "or my own id"
  // branch.
  const rootSearchId = req.rootSearchId ?? searchId
  await db.update(searchRequest).set({ subjectEntityId: primaryEntityId, rootSearchId }).where(eq(searchRequest.id, searchId))

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

  const browserPool = new BrowserPool()
  try {
    const wave1 = await runConnectorWave({ db, redis, dbSearchId: searchId, eventSearchId: rootSearchId, primaryEntityId, input, disabledConnectorIds, browserPool })

    // Auto-pivot only fans out from a depth-0 (root) search — see
    // pivot-budget.ts's maxDepth guard, checked again per-candidate inside
    // dispatchPivots. A pivot child calling runSearch directly (rather than
    // through dispatchPivots' inline path) would still hit that guard and
    // simply derive nothing further.
    const wave2Claims = req.pivotDepth < DEFAULT_PIVOT_BUDGET_LIMITS.maxDepth
      ? await dispatchPivots({
          db, redis, rootSearchId, parentSearchId: searchId, primaryEntityId,
          parentInput: input, wave1Claims: wave1.claims, req, browserPool, disabledConnectorIds,
        })
      : 0

    // Moved after wave 2 completes and the `person_name`-only guard is
    // gone: with pivots, any search can now produce full_name/
    // current_address/relative_of claims and create person entities via
    // relatedEntity — exactly what resolution exists to cluster. Only the
    // root search runs this once, after its own wave 2 is fully done.
    if (req.pivotDepth === 0) {
      const resolution = await runPostCollectionResolution(db, primaryEntityId)
      if (resolution.candidatesCapped) {
        console.warn(`[run-search] entity resolution candidates capped at MAX_CANDIDATES for entity ${primaryEntityId} — a broad blocking key (e.g. a common surname) returned more matches than were scored`)
      }
    }

    const totalClaims = wave1.totalClaims + wave2Claims
    await publishSearchEvent(redis, rootSearchId, { type: 'search_complete', totalClaims, subjectEntityId: primaryEntityId })
  } catch (err) {
    await publishSearchEvent(redis, rootSearchId, { type: 'search_error', message: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    await browserPool.stop()
  }
}
