import { z } from 'zod'

export const SourceCategory = z.enum([
  'federal',
  'courts_corrections',
  'property_assets',
  'business_professional',
  'digital',
  'sanctions_watchlists',
  'vital_genealogy',
  'consumer_api',
  'licensed_vendor',
])
export type SourceCategory = z.infer<typeof SourceCategory>

export const SourceCostType = z.enum(['free', 'freemium', 'paid_api', 'licensed'])
export type SourceCostType = z.infer<typeof SourceCostType>

export const Source = z.object({
  id: z.string().uuid(),
  /** Stable connector id, e.g. "portal.odyssey", "federal.courtlistener". */
  connectorId: z.string(),
  name: z.string(),
  category: SourceCategory,
  costType: SourceCostType,
  jurisdiction: z.string().nullable(), // e.g. "US-TX-Travis" or "US" for federal/national
  homepageUrl: z.string().url().nullable(),
  tosUrl: z.string().url().nullable(),
  robotsPolicy: z.enum(['honor', 'override']),
  enabled: z.boolean(),
})
export type Source = z.infer<typeof Source>

export const CollectionRunStatus = z.enum([
  'pending', 'running', 'hit', 'miss', 'blocked', 'error', 'skipped_captcha',
])
export type CollectionRunStatus = z.infer<typeof CollectionRunStatus>

/**
 * One execution of one connector against one search. Archives the raw
 * request/response pair so every claim it produced can be re-verified
 * without re-hitting the live source. This is the audit trail's backbone.
 */
export const CollectionRun = z.object({
  id: z.string().uuid(),
  searchId: z.string().uuid(),
  sourceId: z.string().uuid(),
  connectorId: z.string(),
  status: CollectionRunStatus,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  claimsProduced: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  /** sha256 pointers into evidence storage. */
  requestArchiveSha256: z.string().nullable(),
  responseArchiveSha256: z.string().nullable(),
  screenshotSha256: z.string().nullable(),
})
export type CollectionRun = z.infer<typeof CollectionRun>
