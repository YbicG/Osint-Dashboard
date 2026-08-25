import type { SearchInput, SearchInputType } from '@osint/contracts'

/**
 * Best-effort auto-detection for the universal search bar. Order matters —
 * more specific patterns (email, IP, domain, plate) are checked before the
 * catch-all "looks like a name" fallback. The detected type is shown as an
 * editable chip in the UI (see SearchBar) precisely because this is a
 * heuristic, not a guarantee — the operator can always override it.
 */
/** Never returns 'image_face' (no text pattern can mean "this is a photo") or 'ssn_last4' (never a search key — see PersonNameInput's doc comment in contracts). */
export function detectInputType(raw: string): Exclude<SearchInputType, 'image_face' | 'ssn_last4'> {
  const trimmed = raw.trim()

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email'
  // Grouped as (A || B) && C, not A || (B && C). Written without the outer
  // parens, `&&` binds tighter than `||`, so the space check only ever
  // gated the bare-domain branch (B) — a pasted "https://example.com with
  // trailing text" satisfied the `https?://` branch (A) unconditionally and
  // still returned 'domain' regardless of the space. Grouping explicitly
  // makes the space check apply to the whole url-or-domain test.
  if ((/^https?:\/\//.test(trimmed) || /^[a-z0-9-]+\.[a-z]{2,}$/i.test(trimmed)) && !trimmed.includes(' ')) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return 'domain'
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed) || /^[0-9a-f:]+:[0-9a-f:]+$/i.test(trimmed)) return 'ip_address'
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed.replace(/\s/g, ''))) return 'vin'
  if (/^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,60})$/.test(trimmed)) return 'crypto_wallet'
  if (/^[\d\s().+-]{7,20}$/.test(trimmed) && /\d{7,}/.test(trimmed.replace(/\D/g, ''))) return 'phone_e164'
  if (/^@?[a-z0-9_.]{3,30}$/i.test(trimmed) && !trimmed.includes(' ') && !/^\d+$/.test(trimmed)) {
    // Ambiguous with a single-word name — but a bare single token with no
    // spaces, digits+letters mixed, or a leading @ reads as a handle far
    // more often than as a full legal name.
    if (trimmed.startsWith('@') || /\d/.test(trimmed)) return 'username'
  }
  if (/\d{1,5}\s+\S+.*\b(st|street|ave|avenue|blvd|dr|drive|rd|road|ln|lane|way|ct|court)\b/i.test(trimmed)) return 'address'
  if (/^[A-Z]{1,3}[- ]?\d{2,4}[A-Z]{0,3}$/i.test(trimmed.replace(/\s/g, '')) && trimmed.length <= 8) return 'license_plate'
  if (/^\d{1,2}:\d{2}-[a-z]{2}-\d{3,6}$|^[a-z0-9-]{4,20}\d{3,}$/i.test(trimmed)) return 'docket_number'

  return 'person_name'
}

/**
 * `type` is deliberately typed as the 11 searchable types, not the full
 * SearchInputType union — `image_face` needs an uploaded file's sha256,
 * not raw text (see buildImageFaceInput), and `ssn_last4` is never a
 * search key on its own (see contracts' PersonNameInput doc comment), so
 * neither can be constructed from a plain string and both are excluded at
 * the type level instead of via a runtime throw a caller could hit.
 */
export function buildSearchInput(
  type: Exclude<SearchInputType, 'image_face' | 'ssn_last4'>,
  raw: string,
  opts?: { stateHint?: string; countyHint?: string },
): SearchInput {
  const trimmed = raw.trim()
  switch (type) {
    case 'person_name':
      return { type: 'person_name', fullName: trimmed, stateHint: opts?.stateHint }
    case 'address':
      return { type: 'address', raw: trimmed, stateHint: opts?.stateHint, countyHint: opts?.countyHint }
    default:
      return { type, value: trimmed, stateHint: opts?.stateHint }
  }
}

/** Constructs the one SearchInput that can't come from raw text — a face-match search keyed by the sha256 of an already-archived upload. */
export function buildImageFaceInput(imageSha256: string): SearchInput {
  return { type: 'image_face', imageSha256 }
}

export const INPUT_TYPE_LABELS: Record<SearchInputType, string> = {
  person_name: 'Person Name',
  phone_e164: 'Phone Number',
  email: 'Email Address',
  username: 'Username',
  address: 'Address',
  license_plate: 'License Plate',
  vin: 'VIN',
  domain: 'Domain',
  ip_address: 'IP Address',
  crypto_wallet: 'Crypto Wallet',
  docket_number: 'Docket Number',
  ssn_last4: 'SSN (Last 4)',
  image_face: 'Face Photo',
}
