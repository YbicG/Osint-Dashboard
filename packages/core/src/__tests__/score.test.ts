import { describe, it, expect } from 'vitest'
import { scorePersonMatch } from '../resolution/score'

describe('scorePersonMatch', () => {
  it('auto-merges exact name + exact DOB + shared phone', () => {
    const r = scorePersonMatch({
      nameA: 'John Smith', nameB: 'John Smith',
      dobA: '1985-04-12', dobB: '1985-04-12',
      phonesA: ['+15125550100'], phonesB: ['+15125550100'],
    })
    expect(r.decision).toBe('auto_merge')
  })

  it('rejects same last name, different first name, conflicting full DOB', () => {
    const r = scorePersonMatch({
      nameA: 'John Smith', nameB: 'Steven Smith',
      dobA: '1985-04-12', dobB: '1990-01-01',
    })
    expect(r.decision).toBe('reject')
  })

  it('flags nickname + address overlap for review, not auto-merge', () => {
    const r = scorePersonMatch({
      nameA: 'Bob Johnson', nameB: 'Robert Johnson',
      addressesA: ['123 Main St, Austin, TX'], addressesB: ['123 Main Street, Austin, TX'],
    })
    expect(r.decision).toBe('needs_review')
    expect(r.matchedOn).toContain('name:nickname')
  })

  it('does not blow up with no shared signal', () => {
    const r = scorePersonMatch({ nameA: 'Alice Brown', nameB: 'Zack Green' })
    expect(r.decision).toBe('reject')
    expect(r.score).toBe(0)
  })
})
