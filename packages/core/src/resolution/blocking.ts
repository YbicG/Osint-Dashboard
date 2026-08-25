import { soundex, normalizeForMatch, parseName } from '../normalize/name'

export interface PersonBlockingInput {
  fullName: string
  dobYear?: number | null
  phone?: string | null // E.164
  email?: string | null
}

/**
 * Blocking keys limit entity-resolution comparisons to O(n) candidate pairs
 * instead of O(n^2) over the whole entity table — any entity sharing at
 * least one key with a new record is pulled into pairwise scoring.
 */
export function personBlockingKeys(input: PersonBlockingInput): string[] {
  const keys: string[] = []
  const { last, first } = parseName(input.fullName)
  if (last) {
    const lastSoundex = soundex(last)
    if (input.dobYear) keys.push(`name-dob:${lastSoundex}:${input.dobYear}`)
    if (first) keys.push(`name-first:${lastSoundex}:${normalizeForMatch(first)[0] ?? ''}`)
    keys.push(`name-last:${lastSoundex}`)
  }
  if (input.phone) keys.push(`phone:${input.phone}`)
  if (input.email) keys.push(`email:${input.email.toLowerCase()}`)
  return keys
}
