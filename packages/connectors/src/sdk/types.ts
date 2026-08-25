import type { Predicate, ClaimValue, ConnectorMeta, SearchInput, EntityType } from '@osint/contracts'
import type { BrowserPool } from '@osint/browser'

/**
 * What a connector actually yields. Deliberately NOT a full Claim — a
 * connector has no idea what entity UUIDs exist yet, that's the ingest
 * pipeline's job (packages/core resolution + apps/worker ingest.ts). A
 * connector only knows "this fact, about the thing being searched for (or a
 * related entity it just discovered), extracted from this evidence."
 */
export interface DraftClaim {
  /** 'primary' = about the entity the search was for. A relationship predicate (relative_of, spouse_of, ...) implies a second entity, described by `relatedEntity`. */
  subjectRef: 'primary'
  predicate: Predicate
  value: ClaimValue
  relatedEntity?: { type: EntityType; label: string }
  observedAt?: Date | null
  confidence: number
  rawSnippet?: string | null
  evidenceUrl?: string | null
}

export type ConnectorEvent =
  | { type: 'claim'; claim: DraftClaim }
  | { type: 'log'; message: string }
  | { type: 'captcha_pending'; pageUrl: string }

export interface ConnectorContext {
  input: SearchInput
  /** Rate-limited, connector-tagged fetch — use this instead of bare `fetch` for transport:'http' connectors. */
  fetch: typeof fetch
  /** Only present for transport:'browser' connectors. */
  browserPool?: BrowserPool
  log: (message: string) => void
  apiKey: (envVar: string) => string | null
}

export interface ConnectorDefinition extends ConnectorMeta {
  run(ctx: ConnectorContext): AsyncGenerator<DraftClaim>
}

export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  return def
}
