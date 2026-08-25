/**
 * County court/jail/property portals cluster into a handful of software
 * families (see plan doc) — one parameterized adapter per family, driven by
 * this registry, covers all of them. This file is seeded with a
 * representative sample per family (enough to prove the pattern and be
 * genuinely useful) rather than the full ~3,000-county sweep, which is a
 * data-entry task (Phase 4 backlog), not an architecture problem: adding a
 * county is adding one object below, never new code.
 */
export type PortalFamily =
  | 'tyler_odyssey'
  | 'journal_ecourt'
  | 'thomson_reuters_ctrack'
  | 'equivant_courtview'
  | 'jailtracker'
  | 'zuercher'
  | 'qpublic_schneider'
  | 'vision_government'

export interface CountyPortal {
  state: string // USPS code
  county: string
  family: PortalFamily
  baseUrl: string
  /** Family-specific quirks (a different search-form field name, a session-token preflight, etc.) — kept as a loose bag rather than typed per-family to avoid an explosion of near-duplicate interfaces. */
  quirks?: Record<string, string>
}

export const COUNTY_PORTAL_REGISTRY: CountyPortal[] = [
  { state: 'TX', county: 'Travis', family: 'tyler_odyssey', baseUrl: 'https://odysseypa.traviscountytx.gov' },
  { state: 'TX', county: 'Tarrant', family: 'tyler_odyssey', baseUrl: 'https://odyssey.tarrantcounty.com' },
  { state: 'IN', county: 'Marion', family: 'tyler_odyssey', baseUrl: 'https://mycase.in.gov' },
  { state: 'IL', county: 'Cook', family: 'journal_ecourt', baseUrl: 'https://www.cookcountyclerkofcourt.org' },
  { state: 'CA', county: 'Los Angeles', family: 'journal_ecourt', baseUrl: 'https://www.lacourt.org' },
  { state: 'FL', county: 'Miami-Dade', family: 'thomson_reuters_ctrack', baseUrl: 'https://www2.miami-dadeclerk.com' },
  { state: 'OH', county: 'Franklin', family: 'equivant_courtview', baseUrl: 'https://fcdcfcjs.co.franklin.oh.us' },
  { state: 'KY', county: 'Fayette', family: 'jailtracker', baseUrl: 'https://www.jailtracker.com/jailtracker/Facility/Fayette' },
  { state: 'MO', county: 'Greene', family: 'zuercher', baseUrl: 'https://www.greenecountymo.gov' },
  { state: 'GA', county: 'Fulton', family: 'qpublic_schneider', baseUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=Fulton' },
  { state: 'MA', county: 'Suffolk', family: 'vision_government', baseUrl: 'https://gis.vgsi.com/suffolkma' },
]

export function findCountyPortals(state?: string, county?: string): CountyPortal[] {
  return COUNTY_PORTAL_REGISTRY.filter(
    (p) => (!state || p.state === state) && (!county || p.county.toLowerCase() === county.toLowerCase()),
  )
}

export function portalsByFamily(family: PortalFamily): CountyPortal[] {
  return COUNTY_PORTAL_REGISTRY.filter((p) => p.family === family)
}
