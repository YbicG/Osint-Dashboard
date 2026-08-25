import { describe, it, expect } from 'vitest'
import type { Claim, Predicate, ClaimValue, SearchInput } from '@osint/contracts'
import { deriveInputs } from '../pivot/derive'

const PERSON_ORIGIN: SearchInput = { type: 'person_name', fullName: 'Jane Q Public' }

function makeClaim(predicate: Predicate, value: ClaimValue, confidence = 0.8): Claim {
  return {
    id: 'c0000000-0000-0000-0000-000000000000',
    subjectEntityId: 'e0000000-0000-0000-0000-000000000000',
    objectEntityId: null,
    predicate,
    value,
    sourceId: 's0000000-0000-0000-0000-000000000000',
    collectionRunId: 'r0000000-0000-0000-0000-000000000000',
    observedAt: null,
    collectedAt: new Date('2026-01-01T00:00:00Z'),
    confidence,
    rawSnippet: null,
    evidenceUrl: null,
    screenshotSha256: null,
    retractedAt: null,
    retractedReason: null,
  }
}

describe('deriveInputs', () => {
  it('derives both an email and a username input from an email_address claim', () => {
    const derived = deriveInputs(makeClaim('email_address', 'jane.public@example.com'), PERSON_ORIGIN)
    expect(derived.map((d) => d.input)).toContainEqual({ type: 'email', value: 'jane.public@example.com', stateHint: undefined })
    expect(derived.some((d) => d.input.type === 'username' && d.input.value === 'jane.public')).toBe(true)
  })

  it('skips the username derivation for a stop-listed local part', () => {
    const derived = deriveInputs(makeClaim('email_address', 'info@example.com'), PERSON_ORIGIN)
    expect(derived.some((d) => d.input.type === 'username')).toBe(false)
    expect(derived.some((d) => d.input.type === 'email')).toBe(true)
  })

  it('applies a confidence penalty to the derived username vs. the email', () => {
    const derived = deriveInputs(makeClaim('email_address', 'jane.public@example.com', 0.8), PERSON_ORIGIN)
    const email = derived.find((d) => d.input.type === 'email')!
    const username = derived.find((d) => d.input.type === 'username')!
    expect(email.confidence).toBe(0.8)
    expect(username.confidence).toBeCloseTo(0.56, 5)
  })

  it('derives an E.164 phone_e164 input from a phone_number claim', () => {
    const derived = deriveInputs(makeClaim('phone_number', '(512) 555-0134'), PERSON_ORIGIN)
    expect(derived).toHaveLength(1)
    expect(derived[0]!.input).toEqual({ type: 'phone_e164', value: '+15125550134', stateHint: undefined })
  })

  it('returns nothing for an unparseable phone number rather than throwing', () => {
    const derived = deriveInputs(makeClaim('phone_number', 'not-a-phone-number'), PERSON_ORIGIN)
    expect(derived).toEqual([])
  })

  it('derives an address input from a current_address claim at or above the confidence gate', () => {
    const derived = deriveInputs(
      makeClaim('current_address', { matchedAddress: '123 Main St, Austin, TX 78701', state: 'TX' }, 0.9),
      PERSON_ORIGIN,
    )
    expect(derived).toHaveLength(1)
    expect(derived[0]!.input).toMatchObject({ type: 'address', raw: '123 Main St, Austin, TX 78701', stateHint: 'TX' })
  })

  it('does not derive an address below the 0.6 confidence gate', () => {
    const derived = deriveInputs(makeClaim('current_address', { matchedAddress: '123 Main St' }, 0.5), PERSON_ORIGIN)
    expect(derived).toEqual([])
  })

  it('derives a domain input from domain_registration and subdomain claims', () => {
    expect(deriveInputs(makeClaim('domain_registration', 'example.com'), PERSON_ORIGIN)[0]?.input).toEqual({
      type: 'domain', value: 'example.com', stateHint: undefined,
    })
    expect(deriveInputs(makeClaim('subdomain', 'mail.example.com'), PERSON_ORIGIN)[0]?.input).toEqual({
      type: 'domain', value: 'mail.example.com', stateHint: undefined,
    })
  })

  it('derives ip_address inputs from ip_address_seen but skips private/loopback ranges', () => {
    const publicIp = deriveInputs(makeClaim('ip_address_seen', { ip: '93.184.216.34' }), PERSON_ORIGIN)
    expect(publicIp).toHaveLength(1)
    expect(publicIp[0]!.input).toEqual({ type: 'ip_address', value: '93.184.216.34', stateHint: undefined })

    const privateIp = deriveInputs(makeClaim('ip_address_seen', { ip: '10.0.0.5' }), PERSON_ORIGIN)
    expect(privateIp).toEqual([])

    const loopback = deriveInputs(makeClaim('ip_address_seen', { ip: '127.0.0.1' }), PERSON_ORIGIN)
    expect(loopback).toEqual([])
  })

  it('derives ip_address inputs from a dns_record claim carrying multiple resolved values', () => {
    const derived = deriveInputs(
      makeClaim('dns_record', { recordType: 'A', values: ['93.184.216.34', '10.1.1.1', 'not-an-ip-hostname.example.com'] }),
      PERSON_ORIGIN,
    )
    // 10.1.1.1 is private (skipped); the hostname string fails the IP-shape check (skipped)
    expect(derived).toHaveLength(1)
    expect(derived[0]!.input).toMatchObject({ value: '93.184.216.34' })
  })

  it('derives a username input from username_presence and social_profile claims', () => {
    expect(deriveInputs(makeClaim('username_presence', { platform: 'github', username: 'janeq' }), PERSON_ORIGIN)[0]?.input)
      .toEqual({ type: 'username', value: 'janeq', stateHint: undefined })
    expect(deriveInputs(makeClaim('social_profile', { platform: 'gitlab', username: 'janeq' }), PERSON_ORIGIN)[0]?.input)
      .toEqual({ type: 'username', value: 'janeq', stateHint: undefined })
  })

  it('derives vin and license_plate inputs from a vehicle_registration claim', () => {
    const derived = deriveInputs(
      makeClaim('vehicle_registration', { vin: '1HGCM82633A004352', plate: 'ABC1234', plateState: 'ny' }),
      PERSON_ORIGIN,
    )
    expect(derived).toContainEqual(expect.objectContaining({ input: { type: 'vin', value: '1HGCM82633A004352', stateHint: undefined } }))
    expect(derived).toContainEqual(expect.objectContaining({ input: { type: 'license_plate', value: 'ABC1234', stateHint: 'NY' } }))
  })

  it('ignores a malformed VIN rather than deriving garbage', () => {
    const derived = deriveInputs(makeClaim('vehicle_registration', { vin: 'not-seventeen-chars' }), PERSON_ORIGIN)
    expect(derived).toEqual([])
  })

  it('derives a docket_number input from court predicates, skipping a null docketNumber', () => {
    const withDocket = deriveInputs(makeClaim('court_case', { caseName: 'State v. Doe', docketNumber: '1:23-cv-00456' }), PERSON_ORIGIN)
    expect(withDocket[0]?.input).toEqual({ type: 'docket_number', value: '1:23-cv-00456', stateHint: undefined })

    const withoutDocket = deriveInputs(makeClaim('court_case', { caseName: 'State v. Doe', docketNumber: null }), PERSON_ORIGIN)
    expect(withoutDocket).toEqual([])
  })

  it('derives a person_name input from a high-confidence full_name claim, gated at 0.75', () => {
    const highConfidence = deriveInputs(makeClaim('full_name', 'John Q Public', 0.8), { type: 'phone_e164', value: '+15125550134' })
    expect(highConfidence[0]?.input).toEqual({ fullName: 'John Q Public', type: 'person_name' })

    const lowConfidence = deriveInputs(makeClaim('full_name', 'John Q Public', 0.7), { type: 'phone_e164', value: '+15125550134' })
    expect(lowConfidence).toEqual([])
  })

  it('re-scopes a jurisdiction_fips claim into a narrower address input carrying state/county hints', () => {
    const addressOrigin: SearchInput = { type: 'address', raw: '123 Main St, Austin, TX 78701' }
    const derived = deriveInputs(
      makeClaim('jurisdiction_fips', { stateName: 'Texas', countyName: 'Travis County' }),
      addressOrigin,
    )
    expect(derived).toHaveLength(1)
    expect(derived[0]!.input).toEqual({
      type: 'address', raw: '123 Main St, Austin, TX 78701', stateHint: 'TX', countyHint: 'Travis County',
    })
  })

  it('does not derive person_name from relationship predicates (relative_of/spouse_of/associate_of)', () => {
    expect(deriveInputs(makeClaim('relative_of', { relatedEntityLabel: 'John Q Public' }, 0.9), PERSON_ORIGIN)).toEqual([])
    expect(deriveInputs(makeClaim('spouse_of', { relatedEntityLabel: 'John Q Public' }, 0.9), PERSON_ORIGIN)).toEqual([])
    expect(deriveInputs(makeClaim('associate_of', { relatedEntityLabel: 'John Q Public' }, 0.9), PERSON_ORIGIN)).toEqual([])
  })

  it('does not derive from crypto_transaction (counterparty explosion guard)', () => {
    expect(deriveInputs(makeClaim('crypto_transaction', { counterparty: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, 0.9), PERSON_ORIGIN)).toEqual([])
  })

  it('never derives an input identical to the search that produced the claim (loop prevention)', () => {
    const derived = deriveInputs(makeClaim('email_address', 'origin@example.com'), { type: 'email', value: 'origin@example.com' })
    expect(derived.some((d) => d.input.type === 'email' && d.input.value === 'origin@example.com')).toBe(false)
  })

  it('is total: an unparseable/garbage claim value returns [] instead of throwing', () => {
    expect(() => deriveInputs(makeClaim('current_address', 12345 as unknown as ClaimValue), PERSON_ORIGIN)).not.toThrow()
    expect(() => deriveInputs(makeClaim('vehicle_registration', 'just a string' as unknown as ClaimValue), PERSON_ORIGIN)).not.toThrow()
    expect(() => deriveInputs(makeClaim('jurisdiction_fips', {}), PERSON_ORIGIN)).not.toThrow()
  })

  it('returns [] for a predicate with no derivation rule', () => {
    expect(deriveInputs(makeClaim('age', 42), PERSON_ORIGIN)).toEqual([])
  })
})
