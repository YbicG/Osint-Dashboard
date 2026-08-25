import { pgEnum } from 'drizzle-orm/pg-core'
import { EntityType } from '@osint/contracts'

// Mirrors packages/contracts Zod enums 1:1 — contracts is the source of
// truth for the *values*, this file just declares them as Postgres enums.
export const entityTypeEnum = pgEnum('entity_type', EntityType.options as [string, ...string[]])

export const roleEnum = pgEnum('role', ['admin', 'supervisor', 'analyst', 'auditor'])

export const caseStatusEnum = pgEnum('case_status', ['open', 'on_hold', 'closed'])

export const collectionRunStatusEnum = pgEnum('collection_run_status', [
  'pending', 'running', 'hit', 'miss', 'blocked', 'error', 'skipped_captcha',
])

export const sourceCategoryEnum = pgEnum('source_category', [
  'federal', 'courts_corrections', 'property_assets', 'business_professional',
  'digital', 'sanctions_watchlists', 'vital_genealogy', 'consumer_api', 'licensed_vendor',
])

export const sourceCostTypeEnum = pgEnum('source_cost_type', ['free', 'freemium', 'paid_api', 'licensed'])

export const clusterStatusEnum = pgEnum('cluster_status', [
  'auto_merged', 'needs_review', 'manually_confirmed', 'manually_split',
])

export const edgeTypeEnum = pgEnum('edge_type', [
  'relative', 'spouse', 'associate', 'coworker', 'neighbor', 'employee_of',
  'owner_of', 'officer_of', 'registered_agent_of', 'resides_at', 'uses_contact',
  'uses_username', 'registered_vehicle', 'party_to_case', 'same_as',
])
