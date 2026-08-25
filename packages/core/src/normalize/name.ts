/** Common suffixes/prefixes stripped before comparison, not before display. */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

export interface ParsedName {
  first: string | null
  middle: string | null
  last: string | null
  suffix: string | null
  raw: string
}

/** Best-effort "Last, First Middle Suffix" / "First Middle Last Suffix" splitter for free-text name input. */
export function parseName(raw: string): ParsedName {
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  if (cleaned.includes(',')) {
    const [lastPart, restPart] = cleaned.split(',', 2)
    const rest = (restPart ?? '').trim().split(' ').filter(Boolean)
    const suffix = rest.length > 1 && NAME_SUFFIXES.has(rest[rest.length - 1]!.toLowerCase().replace('.', ''))
      ? rest.pop()!
      : null
    return {
      last: lastPart!.trim() || null,
      first: rest[0] ?? null,
      middle: rest.length > 1 ? rest.slice(1).join(' ') : null,
      suffix,
      raw,
    }
  }
  const parts = cleaned.split(' ').filter(Boolean)
  let suffix: string | null = null
  if (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1]!.toLowerCase().replace('.', ''))) {
    suffix = parts.pop()!
  }
  return {
    first: parts[0] ?? null,
    last: parts.length > 1 ? parts[parts.length - 1]! : null,
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    suffix,
    raw,
  }
}

/** Lowercase, strip diacritics/punctuation — used for blocking keys and exact-match comparisons, never for display. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Small phonetic code (Soundex) used only as a coarse blocking key to limit
 * the candidate pairs entity resolution has to score — not a match signal
 * on its own. Full double-metaphone would be more accurate but drags in a
 * dependency for marginal gain at blocking-key precision.
 */
export function soundex(s: string): string {
  const input = normalizeForMatch(s).replace(/[^a-z]/g, '')
  if (!input) return '0000'
  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  }
  const first = input[0]!.toUpperCase()
  let result = first
  let lastCode = codes[input[0]!] ?? ''
  for (let i = 1; i < input.length && result.length < 4; i++) {
    const code = codes[input[i]!] ?? ''
    if (code && code !== lastCode) result += code
    lastCode = code
  }
  return result.padEnd(4, '0')
}

/** Minimal nickname expansion table for common English given names — bidirectional lookup. */
export const NICKNAME_GROUPS: string[][] = [
  ['robert', 'rob', 'bob', 'bobby', 'robbie'],
  ['william', 'will', 'bill', 'billy', 'liam'],
  ['richard', 'rich', 'rick', 'dick', 'ricky'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jack', 'johnny', 'jonathan'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['joseph', 'joe', 'joey'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['thomas', 'tom', 'tommy'],
  ['christopher', 'chris', 'topher'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt', 'matty'],
  ['anthony', 'tony'],
  ['edward', 'ed', 'eddie', 'ted', 'teddy'],
  ['elizabeth', 'liz', 'beth', 'betty', 'eliza', 'lisa'],
  ['margaret', 'peggy', 'meg', 'maggie', 'marge'],
  ['katherine', 'kate', 'katie', 'kathy', 'kay', 'catherine'],
  ['jennifer', 'jen', 'jenny'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['deborah', 'deb', 'debbie'],
  ['susan', 'sue', 'suzy', 'suzie'],
  ['alexander', 'alex', 'xander', 'sasha'],
  ['nicholas', 'nick', 'nicky'],
  ['samuel', 'sam', 'sammy'],
  ['benjamin', 'ben', 'benny'],
  ['stephanie', 'steph'],
  ['victoria', 'vicky', 'tori'],
  ['gregory', 'greg'],
  ['timothy', 'tim', 'timmy'],
  ['zachary', 'zach', 'zack'],
]

const NICKNAME_INDEX = new Map<string, Set<string>>()
for (const group of NICKNAME_GROUPS) {
  const set = new Set(group)
  for (const name of group) NICKNAME_INDEX.set(name, set)
}

/** True if two given names are the same identity under common nickname variation (Bob <-> Robert). */
export function isNicknameMatch(a: string, b: string): boolean {
  const an = normalizeForMatch(a)
  const bn = normalizeForMatch(b)
  if (an === bn) return true
  const group = NICKNAME_INDEX.get(an)
  return group ? group.has(bn) : false
}
