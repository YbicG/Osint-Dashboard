import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { faaAirmenConnector } from '../sources/federal/faa-airmen'

/**
 * Fixture is a real (small) ZIP archive built the same way the live
 * registry.faa.gov file is: a PKZIP central directory wrapping deflated
 * PILOT_BASIC.csv / PILOT_CERT.csv entries. Its rows are copied verbatim
 * from a live download of https://registry.faa.gov/database/CS082026.zip
 * captured 2026-08-24 (not synthesized data) — just trimmed down to three
 * airmen so the fixture stays tiny. This exercises the connector's own
 * hand-rolled zip reader end to end, not just the CSV parsing.
 */
const fixtureZip = readFileSync(fileURLToPath(new URL('../fixtures/faa-airmen-sample.zip', import.meta.url)))

function makeCtx(fullName: string) {
  const fakeFetch = (async () => new Response(fixtureZip, {
    status: 200,
    headers: { 'content-type': 'application/x-zip-compressed' },
  })) as unknown as typeof fetch

  return {
    input: { type: 'person_name' as const, fullName },
    fetch: fakeFetch,
    log: () => {},
    apiKey: () => null,
  }
}

describe('faaAirmenConnector', () => {
  it('parses the real zip structure and emits one claim per certificate row for a matched airman', async () => {
    const ctx = makeCtx('Robert Kelly Blake')
    const claims = []
    for await (const c of faaAirmenConnector.run(ctx)) claims.push(c)

    // The fixture's A0000014 (Blake) holds two certificate rows: a Pilot/ATP
    // cert and a Flight Engineer cert — both should surface as separate claims.
    expect(claims).toHaveLength(2)
    for (const c of claims) expect(c.predicate).toBe('professional_license')

    const values = claims.map((c) => c.value as Record<string, unknown>)
    const pilotClaim = values.find((v) => v.certificateTypeCode === 'P')
    const engineerClaim = values.find((v) => v.certificateTypeCode === 'E')

    expect(pilotClaim).toBeDefined()
    expect(pilotClaim!.licenseType).toBe('Pilot')
    expect(pilotClaim!.certificateLevel).toBe('Airline Transport Pilot')
    expect(pilotClaim!.city).toBe('FORT LAUDERDALE')
    expect(pilotClaim!.state).toBe('FL')
    expect(pilotClaim!.ratings).toEqual(['A/ASEL', 'A/ASES', 'A/AMEL'])
    expect(pilotClaim!.typeRatings).toEqual(['A/B-737', 'A/DC-9', 'A/LR-JET'])
    expect(pilotClaim!.faaUniqueId).toBe('A0000014')

    expect(engineerClaim).toBeDefined()
    expect(engineerClaim!.licenseType).toBe('Flight Engineer')
    // Type 'E' has no pilot-level decode — level column is blank for this row.
    expect(engineerClaim!.certificateLevel).toBeNull()
  })

  it('decodes a Private Pilot level and a Flight Instructor expiration date correctly', async () => {
    const chapinCtx = makeCtx('William Vernon Chapin')
    const chapinClaims = []
    for await (const c of faaAirmenConnector.run(chapinCtx)) chapinClaims.push(c)
    expect(chapinClaims).toHaveLength(1)
    const chapinValue = chapinClaims[0]!.value as Record<string, unknown>
    expect(chapinValue.certificateLevel).toBe('Private Pilot')
    expect(chapinValue.ratings).toEqual(['P/ASEL', 'P/GL'])

    const mcgradyCtx = makeCtx('Kevin Patrick Mcgrady')
    const mcgradyClaims = []
    for await (const c of faaAirmenConnector.run(mcgradyCtx)) mcgradyClaims.push(c)
    expect(mcgradyClaims).toHaveLength(1)
    const mcgradyValue = mcgradyClaims[0]!.value as Record<string, unknown>
    expect(mcgradyValue.licenseType).toBe('Flight Instructor (CFI)')
    expect(mcgradyValue.certificateExpirationDate).toBe('10312026')
  })

  it('does not match an unrelated name', async () => {
    const ctx = makeCtx('Zzyzx Qwerty Unrelated')
    const claims = []
    for await (const c of faaAirmenConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
  })

  it('ignores non-person_name search inputs without fetching anything', async () => {
    let fetchCalled = false
    const ctx = {
      input: { type: 'domain' as const, value: 'example.com' },
      fetch: (async () => { fetchCalled = true; return new Response('') }) as unknown as typeof fetch,
      log: () => {},
      apiKey: () => null,
    }
    const claims = []
    for await (const c of faaAirmenConnector.run(ctx)) claims.push(c)
    expect(claims).toHaveLength(0)
    expect(fetchCalled).toBe(false)
  })
})
