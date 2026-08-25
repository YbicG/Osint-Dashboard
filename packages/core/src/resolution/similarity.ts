/** Standard Jaro-Winkler string similarity, 0 (no match) to 1 (identical). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const aLen = a.length
  const bLen = b.length
  if (aLen === 0 || bLen === 0) return 0

  const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1)
  const aMatches = new Array(aLen).fill(false)
  const bMatches = new Array(bLen).fill(false)

  let matches = 0
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, bLen)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  transpositions = transpositions / 2

  const jaro = (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3

  let prefix = 0
  for (let i = 0; i < Math.min(4, aLen, bLen); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}
