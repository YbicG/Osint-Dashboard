import { pgEnum } from 'drizzle-orm/pg-core'
import {
  EntityType, Role, CaseStatus, CollectionRunStatus, SourceCategory, SourceCostType,
  CsvFolderScanStatus, CsvFileStatus,
} from '@osint/contracts'

// Generated 1:1 from packages/contracts Zod enums — contracts is the source
// of truth for the *values*, this file just declares them as Postgres
// enums. Previously these were hand-copied literal arrays; every value here
// was diffed against contracts and matched exactly (drift would have shown
// up as an unexpected `pnpm db:generate` diff), so switching to a generated
// helper changes nothing at the DB level while making a future drift
// impossible instead of merely unlikely.
// Generic over the zod enum's own tuple type (not widened to `string[]`) so
// the resulting pg enum keeps the specific literal union — a non-generic
// `{ options: readonly string[] }` parameter type would erase it, turning
// every column using it into a bare `string` and defeating the whole point
// of generating from contracts.
function pgEnumFromZod<Name extends string, T extends readonly [string, ...string[]]>(
  name: Name,
  zodEnum: { options: T },
) {
  return pgEnum(name, zodEnum.options)
}

export const entityTypeEnum = pgEnumFromZod('entity_type', EntityType)
export const roleEnum = pgEnumFromZod('role', Role)
export const caseStatusEnum = pgEnumFromZod('case_status', CaseStatus)
export const collectionRunStatusEnum = pgEnumFromZod('collection_run_status', CollectionRunStatus)
export const sourceCategoryEnum = pgEnumFromZod('source_category', SourceCategory)
export const sourceCostTypeEnum = pgEnumFromZod('source_cost_type', SourceCostType)

export const clusterStatusEnum = pgEnum('cluster_status', [
  'auto_merged', 'needs_review', 'manually_confirmed', 'manually_split',
])

export const edgeTypeEnum = pgEnum('edge_type', [
  'relative', 'spouse', 'associate', 'coworker', 'neighbor', 'employee_of',
  'owner_of', 'officer_of', 'registered_agent_of', 'resides_at', 'uses_contact',
  'uses_username', 'registered_vehicle', 'party_to_case', 'same_as',
])

// Folder/file lifecycle enums for the CSV Search feature (packages/db/src/schema/csv-search.ts).
export const csvFolderScanStatusEnum = pgEnumFromZod('csv_folder_scan_status', CsvFolderScanStatus)
export const csvFileStatusEnum = pgEnumFromZod('csv_file_status', CsvFileStatus)
