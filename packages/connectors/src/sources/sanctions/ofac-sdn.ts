import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'
import { jaroWinkler, normalizeForMatch } from '@osint/core'
import { loadSdnList } from './_sdn-list'

/**
 * OFAC Specially Designated Nationals list — public-domain U.S. Treasury
 * data, free for any use (unlike OpenSanctions' CC BY-NC aggregation, see
 * plan doc). No API key. The download endpoint 302s to a signed S3 URL;
 * `fetch` follows redirects by default so this "just works."
 *
 * Fetch/parse/cache moved to `./_sdn-list.ts` so sanctions.ofac_crypto can
 * scan the same downloaded list for embedded crypto addresses without a
 * second network request — see that file's doc comment.
 */
const MATCH_THRESHOLD = 0.82

export const ofacSdnConnector = defineConnector({
  id: 'sanctions.ofac_sdn',
  name: 'OFAC Specially Designated Nationals List',
  category: 'sanctions_watchlists',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['sanctions_listing'],
  rateLimitPerMinute: 30,
  robotsPolicy: 'honor',
  tosNote: 'U.S. government public-domain data (31 CFR Part 501) — no usage restriction.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return
    const queryName = normalizeForMatch(ctx.input.fullName)
    ctx.log('Downloading/loading cached OFAC SDN list...')
    const records = await loadSdnList(ctx.fetch)

    for (const record of records) {
      const candidateName = normalizeForMatch(record.name)
      const score = jaroWinkler(queryName, candidateName)
      if (score < MATCH_THRESHOLD) continue

      yield claim('sanctions_listing', {
        listName: 'OFAC SDN',
        entityNumber: record.entNum,
        matchedName: record.name,
        sdnType: record.type,
        program: record.program,
        remarks: record.remarks,
        nameMatchScore: score,
      }, {
        confidence: score,
        rawSnippet: `${record.name} | ${record.type} | ${record.program}`,
        evidenceUrl: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${record.entNum}`,
      })
    }
  },
})
