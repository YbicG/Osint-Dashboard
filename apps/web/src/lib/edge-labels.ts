/**
 * Human-readable labels for `edge.type` values (see packages/db/src/schema/enums.ts
 * `edgeTypeEnum`). Mirrors the humanize-with-a-lookup-table-and-fallback shape of
 * predicate-labels.ts's CATEGORY_LABELS/predicateLabel — a curated map for the
 * values worth special-casing (most edge types read better as a hand-written
 * phrase than a mechanical title-case), falling back to a generic humanizer for
 * anything added to the enum later that this map hasn't caught up with yet.
 */
export const EDGE_TYPE_LABELS: Record<string, string> = {
  relative: 'Relative',
  spouse: 'Spouse',
  associate: 'Associate',
  coworker: 'Coworker',
  neighbor: 'Neighbor',
  employee_of: 'Employee of',
  owner_of: 'Owner of',
  officer_of: 'Officer of',
  registered_agent_of: 'Registered agent of',
  resides_at: 'Resides at',
  uses_contact: 'Uses contact',
  uses_username: 'Uses username',
  registered_vehicle: 'Registered vehicle',
  party_to_case: 'Party to case',
  same_as: 'Same as',
}

export function edgeTypeLabel(type: string): string {
  return EDGE_TYPE_LABELS[type] ?? type
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}
