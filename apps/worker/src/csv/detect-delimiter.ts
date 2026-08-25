const CANDIDATES = [',', ';', '\t', '|'] as const

/**
 * Picks the delimiter that occurs most often in a sample line (typically
 * the header row). Falls back to comma when nothing else appears — the
 * overwhelmingly common case, and a safe default even for a single-column
 * file (0 occurrences of every candidate, comma still wins the tie).
 */
export function detectDelimiter(sampleLine: string): string {
  let best: string = ','
  let bestCount = -1
  for (const candidate of CANDIDATES) {
    const count = sampleLine.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}
