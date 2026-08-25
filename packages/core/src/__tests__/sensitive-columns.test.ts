import { describe, it, expect } from 'vitest'
import { isSensitiveColumnName, detectSensitiveColumns, maskSensitiveValue, maskRecord } from '../pii/sensitive-columns'

describe('isSensitiveColumnName', () => {
  it('flags the SSN-Searcher reference schema\'s sensitive columns', () => {
    for (const header of ['ssn', 'dob', 'alt1DOB', 'alt2DOB', 'alt3DOB']) {
      expect(isSensitiveColumnName(header)).toBe(true)
    }
  })

  it('flags common casing/separator variants', () => {
    for (const header of ['SSN', 'Social_Security_Number', 'social-security-number', 'tax_id', 'TIN', 'DriversLicense', 'Driver License #', 'Account Number', 'Credit Card Number', 'Date of Birth']) {
      expect(isSensitiveColumnName(header)).toBe(true)
    }
  })

  it('does not flag identifying-but-searchable fields', () => {
    for (const header of ['firstname', 'lastname', 'middlename', 'address', 'city', 'st', 'zip', 'phone1', 'aka1fullname', 'county_name']) {
      expect(isSensitiveColumnName(header)).toBe(false)
    }
  })
})

describe('detectSensitiveColumns', () => {
  it('returns only the sensitive subset, preserving original casing', () => {
    const headers = ['ID', 'firstname', 'lastname', 'dob', 'address', 'ssn']
    expect(detectSensitiveColumns(headers)).toEqual(['dob', 'ssn'])
  })
})

describe('maskSensitiveValue', () => {
  it('keeps the last 4 characters of a long value', () => {
    expect(maskSensitiveValue('123456789')).toBe('•••••6789')
  })

  it('fully redacts short values', () => {
    expect(maskSensitiveValue('1234')).toBe('••••')
  })

  it('passes through null/empty as empty string', () => {
    expect(maskSensitiveValue(null)).toBe('')
    expect(maskSensitiveValue('')).toBe('')
  })
})

describe('maskRecord', () => {
  it('masks only the listed sensitive columns', () => {
    const data = { firstname: 'John', ssn: '123456789', dob: '1990-01-01' }
    expect(maskRecord(data, ['ssn', 'dob'])).toEqual({
      firstname: 'John',
      ssn: '•••••6789',
      dob: '••••••1-01',
    })
  })
})
