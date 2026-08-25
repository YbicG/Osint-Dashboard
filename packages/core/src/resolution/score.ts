import { jaroWinkler } from './similarity'
import { isNicknameMatch, normalizeForMatch, parseName } from '../normalize/name'
import { normalizeAddress } from '../normalize/address'

export interface ResolutionFeatureSet {
  nameA: string
  nameB: string
  dobA?: string | null // ISO date or year
  dobB?: string | null
  phonesA?: string[]
  phonesB?: string[]
  emailsA?: string[]
  emailsB?: string[]
  addressesA?: string[]
  addressesB?: string[]
  relativeNamesA?: string[]
  relativeNamesB?: string[]
}

export interface ScoredMatch {
  score: number // 0-1
  matchedOn: string[]
  decision: 'auto_merge' | 'needs_review' | 'reject'
}

// Fixed weights, not EM-trained — deliberately conservative and documented
// rather than pretending to a precision this v1 hasn't earned. Revisit once
// there's a labeled dataset (see packages/core/src/__tests__/resolution fixtures).
const WEIGHTS = {
  nameExact: 0.35,
  nameNickname: 0.30,
  nameFuzzyPerPoint: 0.30, // scaled by jaroWinkler score above a 0.85 floor
  dobExact: 0.30,
  dobYearOnly: 0.12,
  dobConflict: -0.40, // full DOB present on both sides and disagrees -> strong negative
  sharedPhone: 0.25,
  sharedEmail: 0.25,
  sharedAddress: 0.15,
  sharedRelative: 0.10,
}

const AUTO_MERGE_THRESHOLD = 0.90
const REVIEW_THRESHOLD = 0.40

function dobYear(dob?: string | null): number | null {
  if (!dob) return null
  const y = Number(dob.slice(0, 4))
  return Number.isFinite(y) ? y : null
}

function overlap(a: string[] = [], b: string[] = [], normalize: (s: string) => string): string[] {
  const setB = new Set(b.map(normalize))
  return a.filter((x) => setB.has(normalize(x)))
}

/** Pairwise entity-resolution scorer. Pure function — no I/O, easy to unit test against fixtures. */
export function scorePersonMatch(f: ResolutionFeatureSet): ScoredMatch {
  let score = 0
  const matchedOn: string[] = []

  const { first: firstA, last: lastA } = parseName(f.nameA)
  const { first: firstB, last: lastB } = parseName(f.nameB)
  const lastMatches = lastA && lastB && normalizeForMatch(lastA) === normalizeForMatch(lastB)

  if (lastMatches && firstA && firstB) {
    if (normalizeForMatch(firstA) === normalizeForMatch(firstB)) {
      score += WEIGHTS.nameExact
      matchedOn.push('name:exact')
    } else if (isNicknameMatch(firstA, firstB)) {
      score += WEIGHTS.nameNickname
      matchedOn.push('name:nickname')
    } else {
      const sim = jaroWinkler(normalizeForMatch(firstA), normalizeForMatch(firstB))
      if (sim >= 0.85) {
        score += WEIGHTS.nameFuzzyPerPoint * sim
        matchedOn.push(`name:fuzzy=${sim.toFixed(2)}`)
      }
    }
  }

  if (f.dobA && f.dobB) {
    if (f.dobA === f.dobB) {
      score += WEIGHTS.dobExact
      matchedOn.push('dob:exact')
    } else {
      const ya = dobYear(f.dobA)
      const yb = dobYear(f.dobB)
      if (ya && yb && ya === yb) {
        score += WEIGHTS.dobYearOnly
        matchedOn.push('dob:year_only')
      } else if (f.dobA.length === 10 && f.dobB.length === 10) {
        // both full-precision and they disagree — strong signal these are different people
        score += WEIGHTS.dobConflict
        matchedOn.push('dob:conflict')
      }
    }
  }

  const phoneOverlap = overlap(f.phonesA, f.phonesB, (s) => s)
  if (phoneOverlap.length > 0) { score += WEIGHTS.sharedPhone; matchedOn.push(`phone:shared(${phoneOverlap.length})`) }

  const emailOverlap = overlap(f.emailsA, f.emailsB, (s) => s.toLowerCase())
  if (emailOverlap.length > 0) { score += WEIGHTS.sharedEmail; matchedOn.push(`email:shared(${emailOverlap.length})`) }

  const addressOverlap = overlap(f.addressesA, f.addressesB, normalizeAddress)
  if (addressOverlap.length > 0) { score += WEIGHTS.sharedAddress; matchedOn.push(`address:shared(${addressOverlap.length})`) }

  const relativeOverlap = overlap(f.relativeNamesA, f.relativeNamesB, normalizeForMatch)
  if (relativeOverlap.length > 0) { score += WEIGHTS.sharedRelative; matchedOn.push(`relative:shared(${relativeOverlap.length})`) }

  // Round before thresholding — the weights above are chosen to land on clean
  // decimal boundaries (e.g. 0.35+0.30+0.25=0.90), which binary float addition
  // does not represent exactly.
  score = Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
  const decision = score >= AUTO_MERGE_THRESHOLD ? 'auto_merge' : score >= REVIEW_THRESHOLD ? 'needs_review' : 'reject'
  return { score, matchedOn, decision }
}
