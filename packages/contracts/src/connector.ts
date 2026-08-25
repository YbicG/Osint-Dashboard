import { z } from 'zod'
import { SearchInputType } from './search'
import { SourceCategory, SourceCostType } from './source'

export const JurisdictionScope = z.enum(['national', 'state', 'county', 'municipal'])
export type JurisdictionScope = z.infer<typeof JurisdictionScope>

export const ConnectorTransport = z.enum(['http', 'browser'])
export type ConnectorTransport = z.infer<typeof ConnectorTransport>

/**
 * Static, serializable metadata about a connector — everything the planner
 * needs to decide "should this run for this search" without importing the
 * connector's actual scraping/parsing code. Kept separate from the runtime
 * `run()` function (defined alongside it in packages/connectors) so the web
 * app and admin console can list/reason about connectors without pulling in
 * Playwright.
 */
export const ConnectorMeta = z.object({
  id: z.string().min(1), // e.g. "federal.courtlistener", "portal.odyssey"
  name: z.string(),
  category: SourceCategory,
  costType: SourceCostType,
  transport: ConnectorTransport,
  jurisdictionScope: JurisdictionScope,
  /** Which search input types this connector can consume. */
  accepts: z.array(SearchInputType).min(1),
  /** Which predicates this connector can, at least in principle, emit. Informational for the UI. */
  emits: z.array(z.string()).min(1),
  rateLimitPerMinute: z.number().int().positive(),
  robotsPolicy: z.enum(['honor', 'override']),
  tosNote: z.string().nullable(),
  requiresApiKey: z.string().nullable(), // env var name, or null if no key needed
  enabledByDefault: z.boolean(),
})
export type ConnectorMeta = z.infer<typeof ConnectorMeta>

export const ConnectorEventType = z.enum(['claim', 'log', 'status'])

export const ConnectorRunStatus = z.enum(['hit', 'miss', 'blocked', 'error', 'skipped_captcha'])
export type ConnectorRunStatus = z.infer<typeof ConnectorRunStatus>
