import { createHash } from 'node:crypto'
import { normalizeForMatch } from './name'

/** USPS Publication 28 street-suffix abbreviations, common subset. */
const STREET_SUFFIX: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr', court: 'ct',
  lane: 'ln', road: 'rd', circle: 'cir', place: 'pl', square: 'sq',
  terrace: 'ter', trail: 'trl', parkway: 'pkwy', highway: 'hwy', way: 'way',
  apartment: 'apt', suite: 'ste', building: 'bldg', floor: 'fl', unit: 'unit',
}

/** Lossy normalization for blocking/dedup — never for display. */
export function normalizeAddress(raw: string): string {
  const s = normalizeForMatch(raw)
  const tokens = s.split(' ').map((word) => STREET_SUFFIX[word] ?? word)
  return tokens.join(' ').replace(/\s+/g, ' ').trim()
}

/** Stable hash of a normalized address, used as an entity-resolution blocking key. */
export function addressBlockingKey(raw: string): string {
  return createHash('sha1').update(normalizeAddress(raw)).digest('hex').slice(0, 16)
}
