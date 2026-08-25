import { z } from 'zod'

export const Role = z.enum(['admin', 'supervisor', 'analyst', 'auditor'])
export type Role = z.infer<typeof Role>

export const User = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: Role,
  mfaEnrolled: z.boolean(),
  createdAt: z.coerce.date(),
  disabledAt: z.coerce.date().nullable(),
})
export type User = z.infer<typeof User>

export const Org = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.coerce.date(),
})
export type Org = z.infer<typeof Org>

export const CaseStatus = z.enum(['open', 'on_hold', 'closed'])
export type CaseStatus = z.infer<typeof CaseStatus>

export const Case = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string().min(1),
  status: CaseStatus,
  purposeCode: z.string().min(1),
  createdByUserId: z.string().uuid(),
  createdAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable(),
  /** Set true once biometric faceprints belonging to this case have been purged on close. */
  biometricDataPurged: z.boolean(),
})
export type Case = z.infer<typeof Case>

export const Subject = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  entityId: z.string().uuid().nullable(), // null until resolved to a cluster
  label: z.string(),
  addedByUserId: z.string().uuid(),
  addedAt: z.coerce.date(),
  /** Recurring re-collection for change monitoring. */
  monitoringEnabled: z.boolean(),
  monitoringIntervalHours: z.number().int().positive().nullable(),
})
export type Subject = z.infer<typeof Subject>

/**
 * Hash-chained append-only audit log — every row's `entryHash` is
 * sha256(prevEntryHash || canonical JSON of this entry), so any deletion or
 * tampering breaks the chain and is detectable by walking it. This is the
 * FCRA/CJIS-adjacent accountability record: who searched what, why, and when.
 */
export const AuditLog = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.string(), // e.g. "search.create", "entity.merge", "case.close", "export.pdf"
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  purposeCode: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  prevEntryHash: z.string().nullable(),
  entryHash: z.string(),
})
export type AuditLog = z.infer<typeof AuditLog>

/** FCRA-adjacent permissible-purpose codes prompted on every search. Not exhaustive of FCRA itself — this product is explicitly NOT a consumer reporting agency output. */
export const PURPOSE_CODES = [
  'criminal_investigation',
  'civil_litigation_support',
  'due_diligence',
  'fraud_investigation',
  'missing_person',
  'background_verification_non_fcra',
  'journalism_research',
  'other_documented',
] as const
export const PurposeCode = z.enum(PURPOSE_CODES)
export type PurposeCode = z.infer<typeof PurposeCode>
