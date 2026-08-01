/**
 * Night grouping — mostly one question asked several ways: does a game that
 * finished after midnight stay with the evening it belonged to?
 *
 * Times here are written as local times on purpose. The whole feature is about
 * what a person at a table would call the evening, and that is a local-clock
 * question; testing it in UTC would test the wrong thing.
 */

import { describe, expect, it } from 'vitest'
import { groupByNight, nightKey, nightLabel, parseStamp, timeOfDay } from './nights.js'

/** A local-time Date, written the way a person would say it. */
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min)

/** The PocketBase stamp for a local moment — space instead of T, in UTC. */
function stamp(date: Date): string {
  return date.toISOString().replace('T', ' ')
}

describe('nightKey', () => {
  it('files an evening under its own date', () => {
    expect(nightKey(at(2026, 7, 31, 20, 15))).toBe('2026-07-31')
  })

  it('files a morning game under that morning, not the night before', () => {
    // The 11:15am game that started all this. It is today's, and 5am is what
    // makes it today's rather than last night's.
    expect(nightKey(at(2026, 7, 31, 11, 15))).toBe('2026-07-31')
  })

  it('keeps a game that ran past midnight with the evening that produced it', () => {
    expect(nightKey(at(2026, 8, 1, 0, 40))).toBe('2026-07-31')
    expect(nightKey(at(2026, 8, 1, 4, 59))).toBe('2026-07-31')
  })

  it('starts a new night at 5am', () => {
    expect(nightKey(at(2026, 8, 1, 5, 0))).toBe('2026-08-01')
  })
})

describe('nightLabel', () => {
  const now = at(2026, 7, 31, 21, 0)

  it('says Today, not Tonight — a morning game is not part of an evening', () => {
    expect(nightLabel('2026-07-31', now)).toBe('Today')
    // And it reads the same at 9am, when "Tonight" would have been nonsense.
    expect(nightLabel('2026-07-31', at(2026, 7, 31, 9, 0))).toBe('Today')
  })

  it('still says Today at 1am, because the night has not rolled over', () => {
    expect(nightLabel('2026-07-31', at(2026, 8, 1, 1, 0))).toBe('Today')
  })

  it('calls the one before Yesterday', () => {
    expect(nightLabel('2026-07-30', now)).toBe('Yesterday')
  })

  it('dates anything older, without the year when it is this one', () => {
    // Not asserting the exact wording — it is formatted by the reader's locale,
    // and pinning "Fri, Jul 24" would only be testing that this machine is
    // American.
    const label = nightLabel('2026-07-24', now)
    expect(label).toContain('24')
    expect(label).not.toContain('2026')
  })

  it('includes the year once it is a different one', () => {
    expect(nightLabel('2025-12-19', now)).toContain('2025')
  })
})

describe('groupByNight', () => {
  it('groups an evening that crossed midnight into one night, newest first', () => {
    const games = [
      { id: 'late', created: stamp(at(2026, 8, 1, 0, 30)) },
      { id: 'second', created: stamp(at(2026, 7, 31, 22, 10)) },
      { id: 'first', created: stamp(at(2026, 7, 31, 20, 0)) },
      { id: 'week-ago', created: stamp(at(2026, 7, 24, 20, 0)) },
    ]

    const nights = groupByNight(games, at(2026, 8, 1, 1, 0))

    expect(nights.map((n) => n.key)).toEqual(['2026-07-31', '2026-07-24'])
    expect(nights[0]?.items.map((g) => g.id)).toEqual(['late', 'second', 'first'])
    expect(nights[0]?.label).toBe('Today')
  })

  it('keeps a morning game and an evening game on the same day together', () => {
    const games = [
      { id: 'evening', created: stamp(at(2026, 7, 31, 20, 0)) },
      { id: 'morning', created: stamp(at(2026, 7, 31, 11, 15)) },
    ]
    const nights = groupByNight(games, at(2026, 7, 31, 21, 0))
    expect(nights).toHaveLength(1)
    expect(nights[0]?.items).toHaveLength(2)
  })

  it('groups by the local day, not the UTC one', () => {
    // Deliberately spanning nearly the whole local day. In ANY timezone with a
    // non-zero offset these two fall on different UTC dates, so a UTC-keyed
    // implementation splits them into two nights and this fails. A narrower
    // span (say 7pm and 11pm) would shift to the same UTC day together and the
    // test would pass while proving nothing.
    const games = [
      { id: 'late', created: stamp(at(2026, 7, 31, 23, 30)) },
      { id: 'early', created: stamp(at(2026, 7, 31, 6, 30)) },
    ]
    const nights = groupByNight(games, at(2026, 7, 31, 23, 45))
    expect(nights).toHaveLength(1)
    expect(nights[0]?.items).toHaveLength(2)
  })

  it('orders nights newest first even when the input is not', () => {
    const games = [
      { id: 'old', created: stamp(at(2026, 7, 24, 20, 0)) },
      { id: 'new', created: stamp(at(2026, 7, 31, 20, 0)) },
    ]
    const nights = groupByNight(games, at(2026, 7, 31, 22, 0))
    expect(nights.map((n) => n.key)).toEqual(['2026-07-31', '2026-07-24'])
  })

  it('handles an empty history without inventing a night', () => {
    expect(groupByNight([], at(2026, 8, 1, 1, 0))).toEqual([])
  })
})

describe('parsing', () => {
  it("reads PocketBase's space-separated stamp rather than choking on it", () => {
    // The T-less form is what the API actually returns; Safari may refuse it
    // unless it is normalised first.
    const noon = timeOfDay(stamp(at(2026, 7, 31, 12, 0)))
    expect(noon).not.toBe('Invalid Date')
    expect(noon).toMatch(/12/)
  })

  it('reads a plain ISO stamp too, which is what a Date round trip gives', () => {
    // Flip 7's client stores `toISOString()` output in places. Both forms have
    // to land on the same moment or the two apps would group differently again.
    const iso = at(2026, 7, 31, 20, 0).toISOString()
    expect(parseStamp(iso).getTime()).toBe(at(2026, 7, 31, 20, 0).getTime())
  })
})
