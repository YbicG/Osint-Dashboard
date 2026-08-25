/**
 * Auto-detects which CSV columns are likely to hold hard PII identifiers
 * (SSNs, tax IDs, license numbers, etc.) from their header name alone, and
 * masks their values for display. Used by apps/worker/src/csv/index-file.ts
 * at index time (to persist csvSourceFile.sensitiveColumns) and by the
 * apps/web csv-search API routes at read time (to mask csvRecord.data
 * before it's serialized).
 *
 * Deliberately narrow: name/address/phone/city/state/zip are NOT treated as
 * sensitive, even though they're personal data, because they're exactly
 * what an analyst searches *by* and needs to see plainly in results. This
 * only covers identifiers a reasonable person would want masked-by-default
 * — SSN-shaped, financial-account-shaped, government-ID-shaped fields.
 */

const SENSITIVE_HEADER_PATTERNS: RegExp[] = [
  /ssn|social.?sec(urity)?/,
  /\bdob\b|date.?of.?birth|birth.?date|alt\d*.?dob/,
  /tax.?id|\btin\b|\bein\b/,
  /passport/,
  /driver.?s?.?licen[cs]e|\bdl.?no\b|license.?number/,
  /account.?(number|no|num)|\bacct.?no\b/,
  /credit.?card|card.?number|\bcvv\b|\bccv\b/,
  /routing.?number/,
  /medicare|medicaid/,
  /alien.?number|uscis/,
]

/** Lowercases and collapses any run of non-alphanumeric characters to a single `_`, so "SSN", "Social_Security_Number", and "social-security-number" all normalize the same way before matching. Exported for packages/core/src/pii/lookup-fields.ts, which needs the same normalization for its own header-alias matching. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export function isSensitiveColumnName(header: string): boolean {
  const normalized = normalizeHeader(header)
  return SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** Returns the subset of `headers` (in their original, unmodified form) that look sensitive. */
export function detectSensitiveColumns(headers: string[]): string[] {
  return headers.filter(isSensitiveColumnName)
}

/**
 * Masks a value for display. Values long enough to have a meaningful "last
 * 4" (e.g. an SSN, an account number) keep those 4 characters visible with
 * the rest replaced by bullets — enough for an analyst to confirm they
 * opened the right record without the full identifier being on screen.
 * Shorter values (a 4-digit PIN, a short ID) are fully redacted instead,
 * since a partial reveal of something that short isn't meaningfully safer
 * than showing it whole.
 */
export function maskSensitiveValue(value: string | null): string {
  if (value === null || value === '') return ''
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length)
  const visible = trimmed.slice(-4)
  return `${'•'.repeat(Math.min(trimmed.length - 4, 8))}${visible}`
}

/** Applies maskSensitiveValue to every column in `sensitiveColumns` found in `data`, leaving everything else untouched. Used server-side, never on the client. */
export function maskRecord(
  data: Record<string, string | null>,
  sensitiveColumns: string[],
): Record<string, string | null> {
  const masked = { ...data }
  for (const column of sensitiveColumns) {
    if (column in masked) masked[column] = maskSensitiveValue(masked[column] ?? null)
  }
  return masked
}
