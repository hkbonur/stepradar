import { describe, expect, it } from 'vitest'
import { PLATFORM_HANDLES, bareHandle, handleOf } from './platforms'

describe('handleOf', () => {
  it('writes a handle the way its platform does', () => {
    expect(handleOf({ platform: 'x', handle: 'ada_builds' })).toBe('@ada_builds')
    expect(handleOf({ platform: 'reddit', handle: 'ada_builds' })).toBe('u/ada_builds')
    expect(handleOf({ platform: 'hackernews', handle: 'pg' })).toBe('pg')
    expect(handleOf({ platform: 'linkedin', handle: 'ada-lovelace' })).toBe('in/ada-lovelace')
  })
})

describe('PLATFORM_HANDLES', () => {
  it('holds each platform to its own handle rules, keeping the case Hacker News reads', () => {
    expect(PLATFORM_HANDLES.hackernews.pattern.test('pg')).toBe(true)
    expect(PLATFORM_HANDLES.hackernews.pattern.test('Animats')).toBe(true)
    expect(PLATFORM_HANDLES.x.pattern.test('ada.automates')).toBe(false)
    expect(PLATFORM_HANDLES.x.pattern.test('a'.repeat(16))).toBe(false)
    expect(PLATFORM_HANDLES.reddit.pattern.test('ab')).toBe(false)
    expect(PLATFORM_HANDLES.linkedin.pattern.test('ada-lovelace-42')).toBe(true)
  })
})

describe('bareHandle', () => {
  it("drops the prefix the account's own platform writes, and only that one", () => {
    expect(bareHandle(' @ada_builds ', 'x')).toBe('ada_builds')
    expect(bareHandle('u/Ada_Builds', 'reddit')).toBe('Ada_Builds')
    expect(bareHandle('@ada', 'reddit')).toBe('@ada')
    expect(bareHandle('pg', 'hackernews')).toBe('pg')
  })
})
