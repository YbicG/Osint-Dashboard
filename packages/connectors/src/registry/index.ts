import type { ConnectorDefinition } from '../sdk/types'
import type { SearchInput } from '@osint/contracts'

import { ofacSdnConnector } from '../sources/sanctions/ofac-sdn'
import { fbiWantedConnector } from '../sources/federal/fbi-wanted'
import { secEdgarFullTextConnector } from '../sources/federal/sec-edgar-fulltext'
import { courtListenerConnector } from '../sources/federal/courtlistener'
import { usernameEnumerationConnector } from '../sources/digital/username-enumeration'
import { rdapConnector } from '../sources/digital/rdap'
import { certificateTransparencyConnector } from '../sources/digital/certificate-transparency'
import { ipGeolocationConnector } from '../sources/digital/ip-geolocation'
import { twilioLookupConnector } from '../sources/consumer_api/twilio-lookup'

// Phase 4 batch — see docs/PLAN.md. Each of these was independently
// live-verified against its real endpoint (several caught the source
// having moved or never having existed as originally assumed — see each
// file's header comment for the research trail) and ships with a
// fixture-based test using a recorded real response.
import { nhtsaVinConnector } from '../sources/federal/nhtsa-vin'
import { usaSpendingConnector } from '../sources/federal/usaspending'
import { propublicaNonprofitConnector } from '../sources/federal/propublica-nonprofit'
import { npiRegistryConnector } from '../sources/federal/npi-registry'
import { hhsOigExclusionsConnector } from '../sources/federal/hhs-oig-exclusions'
import { ssaDeathIndexConnector } from '../sources/federal/ssa-death-index'
import { faaAirmenConnector } from '../sources/federal/faa-airmen'
import { fccUlsConnector } from '../sources/federal/fcc-uls'
import { openCorporatesConnector } from '../sources/consumer_api/opencorporates'
import { shodanConnector } from '../sources/consumer_api/shodan'
import { unConsolidatedConnector } from '../sources/sanctions/un-consolidated'
import { ukHmtConnector } from '../sources/sanctions/uk-hmt'

// Wave 1 (see docs/PLAN.md M2) — closing the zero-coverage input types
// (email, address, license_plate, crypto_wallet, docket_number) called out
// by the search bar's dropdown. courtListenerConnector/rdapConnector are
// existing connectors widened in place rather than duplicated.
import { gravatarConnector } from '../sources/digital/gravatar'
import { censusGeocoderConnector } from '../sources/federal/census-geocoder'
import { nycOpenViolationsConnector } from '../sources/courts/nyc-open-violations'
import { licensedPlateLookupConnector } from '../sources/courts/licensed-plate-lookup'
import { mempoolSpaceConnector } from '../sources/digital/mempool-space'
import { ofacCryptoConnector } from '../sources/sanctions/ofac-crypto'
import { nanpaGeographyConnector } from '../sources/digital/nanpa-geography'
import { keybaseConnector } from '../sources/digital/keybase'
import { hackernewsConnector } from '../sources/digital/hackernews'
import { gitlabUserConnector } from '../sources/digital/gitlab-user'
import { dnsEmailDeliverabilityConnector } from '../sources/digital/dns-email-deliverability'
import { dnsRecordsConnector } from '../sources/digital/dns-records'
import { githubEmailConnector } from '../sources/digital/github-email'
import { blockscoutEvmConnector } from '../sources/digital/blockscout-evm'
import { internetdbShodanConnector } from '../sources/digital/internetdb-shodan'
import { bopInmateConnector } from '../sources/federal/bop-inmate'
import { finraBrokercheckConnector } from '../sources/federal/finra-brokercheck'

/**
 * The full connector catalog. This is the single place a new connector gets
 * registered — everything else (the worker's execution loop, the admin
 * console's source list, the planner below) derives from this array.
 */
export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  ofacSdnConnector,
  fbiWantedConnector,
  secEdgarFullTextConnector,
  courtListenerConnector,
  usernameEnumerationConnector,
  rdapConnector,
  certificateTransparencyConnector,
  ipGeolocationConnector,
  twilioLookupConnector,

  nhtsaVinConnector,
  usaSpendingConnector,
  propublicaNonprofitConnector,
  npiRegistryConnector,
  hhsOigExclusionsConnector,
  ssaDeathIndexConnector,
  faaAirmenConnector,
  fccUlsConnector,
  openCorporatesConnector,
  shodanConnector,
  unConsolidatedConnector,
  ukHmtConnector,

  gravatarConnector,
  censusGeocoderConnector,
  nycOpenViolationsConnector,
  licensedPlateLookupConnector,
  mempoolSpaceConnector,
  ofacCryptoConnector,
  nanpaGeographyConnector,
  keybaseConnector,
  hackernewsConnector,
  gitlabUserConnector,
  dnsEmailDeliverabilityConnector,
  dnsRecordsConnector,
  githubEmailConnector,
  blockscoutEvmConnector,
  internetdbShodanConnector,
  bopInmateConnector,
  finraBrokercheckConnector,
]

export function getConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.id === id)
}

/**
 * The fan-out plan for a search: every enabled connector whose `accepts`
 * includes this input's type. Jurisdiction narrowing (state/county hints on
 * person_name/address inputs) is applied by the portal-family connectors
 * themselves once those are registered (see registry/jurisdictions.ts) —
 * this planner only handles the type-compatibility dimension.
 */
export function planConnectors(input: SearchInput, opts?: { includeDisabled?: boolean }): ConnectorDefinition[] {
  return CONNECTOR_REGISTRY.filter(
    (c) => c.accepts.includes(input.type) && (opts?.includeDisabled || c.enabledByDefault),
  )
}

export * from '../sdk/types'
export * from '../sdk/http'
export * from '../sdk/claim-helpers'
export * from './jurisdictions'
