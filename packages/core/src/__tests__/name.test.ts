import { describe, it, expect } from 'vitest'
import { parseName, normalizeForMatch, soundex, isNicknameMatch } from '../normalize/name'

describe('parseName', () => {
  it('parses "Last, First Middle"', () => {
    expect(parseName('Smith, John Michael')).toEqual({
      last: 'Smith', first: 'John', middle: 'Michael', suffix: null, raw: 'Smith, John Michael',
    })
  })
  it('parses "First Last" and strips suffix', () => {
    const r = parseName('Robert Johnson Jr')
    expect(r.first).toBe('Robert')
    expect(r.last).toBe('Johnson')
    expect(r.suffix).toBe('Jr')
  })
})

describe('normalizeForMatch', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeForMatch("O'Brien-Smith")).toBe('obriensmith')
  })
})

describe('soundex', () => {
  it('gives Robert and Rupert the same code', () => {
    expect(soundex('Robert')).toBe(soundex('Rupert'))
  })
})

describe('isNicknameMatch', () => {
  it('matches Bob to Robert', () => {
    expect(isNicknameMatch('Bob', 'Robert')).toBe(true)
  })
  it('does not match unrelated names', () => {
    expect(isNicknameMatch('Bob', 'Steven')).toBe(false)
  })
})
