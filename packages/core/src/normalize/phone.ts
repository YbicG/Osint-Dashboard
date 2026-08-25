import { parsePhoneNumberFromString } from 'libphonenumber-js'

/** Best-effort E.164 normalization, defaulting to US when no country code is present. */
export function normalizePhone(raw: string, defaultCountry: 'US' = 'US'): string | null {
  const parsed = parsePhoneNumberFromString(raw, defaultCountry)
  if (!parsed?.isValid()) return null
  return parsed.number // E.164, e.g. "+15125550123"
}

export function isLikelyPhoneNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}
