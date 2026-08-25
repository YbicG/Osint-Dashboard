import { defineConnector } from '../../sdk/index'
import { claim } from '../../sdk/claim-helpers'

/** Public JSON API, no key required. https://www.fbi.gov/wanted/api */
const FBI_WANTED_API = 'https://api.fbi.gov/wanted/v1/list'

interface FbiWantedItem {
  uid: string
  title: string
  description: string | null
  subjects: string[] | null
  status: string | null
  publication: string | null
  url: string | null
  images: { original: string }[] | null
  dates_of_birth_used: string[] | null
  place_of_birth: string | null
  aliases: string[] | null
  race: string | null
  sex: string | null
  reward_text: string | null
}

interface FbiWantedResponse {
  items: FbiWantedItem[]
}

export const fbiWantedConnector = defineConnector({
  id: 'federal.fbi_wanted',
  name: 'FBI Wanted',
  category: 'federal',
  costType: 'free',
  transport: 'http',
  jurisdictionScope: 'national',
  accepts: ['person_name'],
  emits: ['wanted_listing', 'alias', 'photo'],
  rateLimitPerMinute: 20,
  robotsPolicy: 'honor',
  tosNote: 'Public FBI.gov API, intended for public consumption.',
  requiresApiKey: null,
  enabledByDefault: true,

  async *run(ctx) {
    if (ctx.input.type !== 'person_name') return

    const url = new URL(FBI_WANTED_API)
    url.searchParams.set('title', ctx.input.fullName)

    const res = await ctx.fetch(url.toString())
    if (!res.ok) {
      ctx.log(`FBI Wanted API returned ${res.status}`)
      return
    }
    const data = (await res.json()) as FbiWantedResponse

    for (const item of data.items ?? []) {
      yield claim('wanted_listing', {
        uid: item.uid,
        title: item.title,
        status: item.status,
        description: item.description,
        rewardText: item.reward_text,
        placeOfBirth: item.place_of_birth,
        race: item.race,
        sex: item.sex,
        datesOfBirthUsed: item.dates_of_birth_used ?? [],
      }, {
        confidence: 0.7, // title match only — FBI's API doesn't expose a name-similarity score
        rawSnippet: item.description?.slice(0, 500) ?? null,
        evidenceUrl: item.url,
      })

      for (const alias of item.aliases ?? []) {
        yield claim('alias', alias, { confidence: 0.6, evidenceUrl: item.url })
      }
      const photo = item.images?.[0]?.original
      if (photo) yield claim('photo', { url: photo }, { confidence: 0.7, evidenceUrl: item.url })
    }
  },
})
