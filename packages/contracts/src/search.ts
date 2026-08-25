import { z } from 'zod'

/**
 * The universal search bar accepts *anything* and we auto-detect its type.
 * Each SearchInputType is also what a Connector declares in `accepts` — the
 * planner intersects "what did the user give us" with "what can read that"
 * to build the fan-out plan.
 */
export const SearchInputType = z.enum([
  'person_name',
  'phone_e164',
  'email',
  'username',
  'address',
  'license_plate',
  'vin',
  'domain',
  'ip_address',
  'crypto_wallet',
  'docket_number',
  'ssn_last4',
  'image_face',
])
export type SearchInputType = z.infer<typeof SearchInputType>

export const PersonNameInput = z.object({
  type: z.literal('person_name'),
  fullName: z.string().min(1),
  dateOfBirth: z.string().optional(), // ISO date, partial precision allowed (YYYY or YYYY-MM-DD)
  stateHint: z.string().length(2).optional(), // USPS state code, narrows jurisdiction fan-out
  cityHint: z.string().optional(),
  /**
   * Corroboration only — NEVER a search key. SSN geography lives in the
   * *first* three digits, so last-4 alone can't drive a lookup; this exists
   * so the entity-resolution scorer can use it as a strong-but-not-alone
   * signal when two candidate records both carry one. Must never be echoed
   * into search_request.inputPayload in plaintext where a history/export
   * view could render it — see apps/web's history label logic.
   */
  ssnLast4: z.string().regex(/^\d{4}$/).optional(),
})

export const AddressInput = z.object({
  type: z.literal('address'),
  raw: z.string().min(1),
  /** Narrows jurisdiction fan-out (county portals, state registries) — set by the caller or by a prior jurisdiction_fips claim on re-scoped pivot searches. */
  stateHint: z.string().length(2).optional(),
  countyHint: z.string().optional(),
})

export const SimpleValueInput = z.object({
  type: z.enum(['phone_e164', 'email', 'username', 'license_plate', 'vin', 'domain', 'ip_address', 'crypto_wallet', 'docket_number', 'ssn_last4']),
  value: z.string().min(1),
  stateHint: z.string().length(2).optional(),
})

export const ImageFaceInput = z.object({
  type: z.literal('image_face'),
  /** sha256 of the uploaded image, already persisted to evidence storage before this input is built. */
  imageSha256: z.string(),
})

export const SearchInput = z.discriminatedUnion('type', [
  PersonNameInput,
  AddressInput,
  SimpleValueInput,
  ImageFaceInput,
])
export type SearchInput = z.infer<typeof SearchInput>

/**
 * The types the universal search bar actually offers as dropdown entries.
 * Deliberately excludes `ssn_last4` (never a search key — see PersonNameInput's
 * doc comment) and `image_face` (a distinct Face Match workflow with its own
 * consent gate, not a peer of the other 11 — see apps/web's face-match surface).
 * The search bar and the connector-coverage test both import this so they
 * cannot silently diverge on what "searchable" means.
 */
export const SEARCHABLE_INPUT_TYPES: Exclude<SearchInputType, 'ssn_last4' | 'image_face'>[] = [
  'person_name', 'phone_e164', 'email', 'username', 'address',
  'license_plate', 'vin', 'domain', 'ip_address', 'crypto_wallet', 'docket_number',
]

/**
 * Where a search came from — one consistent story across every unattended
 * path (auto-pivot, manual expand, monitoring), not just user-initiated
 * ones. See docs/PLAN.md's M3 "Pivot engine" reconciliation section.
 */
export const SearchOrigin = z.enum(['user', 'auto_pivot', 'manual_expand', 'monitoring'])
export type SearchOrigin = z.infer<typeof SearchOrigin>

export const SearchRequest = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid().nullable(),
  subjectEntityId: z.string().uuid().nullable(), // set once resolved against an existing entity
  input: SearchInput,
  purposeCode: z.string().min(1), // FCRA/compliance gate — required on every search
  requestedByUserId: z.string().uuid(),
  createdAt: z.coerce.date(),

  // --- Pivot engine provenance (M3) ---
  parentSearchId: z.string().uuid().nullable(),
  rootSearchId: z.string().uuid().nullable(),
  pivotDepth: z.number().int().min(0),
  origin: SearchOrigin,
  /** "This search exists because claim X asserted phone Y" — the evidentiary payload behind an auto-pivot. Null for a root search. */
  derivedFromClaimId: z.string().uuid().nullable(),
  connectorBudget: z.number().int().positive(),
  connectorBudgetUsed: z.number().int().min(0),
})
export type SearchRequest = z.infer<typeof SearchRequest>
