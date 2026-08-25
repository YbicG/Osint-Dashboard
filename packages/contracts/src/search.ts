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
})

export const AddressInput = z.object({
  type: z.literal('address'),
  raw: z.string().min(1),
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

export const SearchRequest = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid().nullable(),
  subjectEntityId: z.string().uuid().nullable(), // set once resolved against an existing entity
  input: SearchInput,
  purposeCode: z.string().min(1), // FCRA/compliance gate — required on every search
  requestedByUserId: z.string().uuid(),
  createdAt: z.coerce.date(),
})
export type SearchRequest = z.infer<typeof SearchRequest>
