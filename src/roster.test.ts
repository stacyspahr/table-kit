import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSeats, recalledSeats, rememberSeat, seatChoices } from './roster.js'

const APP = 'testgame'

function entry(id: string, display_name: string) {
  return { id, display_name }
}

function seat(id: string, display_name: string, extra: Record<string, unknown> = {}) {
  return { id, display_name, device_id: '', roster_entry: '', ...extra }
}

/** A roster long enough to be the problem this module exists for. */
const LONG = [
  'Michelle', 'Zak', 'Nana', 'Grandpa', 'Ruth', 'Dave',
  'Katie', 'Sam', 'Priya', 'Otis', 'Bev', 'Marco',
].map((n, i) => entry(`r${i}`, n))

beforeEach(() => {
  forgetSeats(APP)
})

describe('this phone remembers', () => {
  it('has nothing to say on a phone that has never played', () => {
    expect(recalledSeats(APP)).toEqual([])
  })

  it('remembers the last person to sit down, and only them', () => {
    rememberSeat(APP, { id: 'r1', display_name: 'Zak' })
    rememberSeat(APP, { id: 'r0', display_name: 'Michelle' })
    expect(recalledSeats(APP).map((s) => s.display_name)).toEqual(['Michelle'])
  })

  it('lets a mis-tap correct itself instead of accumulating', () => {
    // The whole reason this is one and not three. Tapping the wrong name used
    // to mean the phone offered two people from then on, with no way back
    // short of the "not me" hatch. Picking your own name once puts it right.
    rememberSeat(APP, { id: 'r0', display_name: 'Michelle' })
    rememberSeat(APP, { id: 'r1', display_name: 'Zak' })
    expect(recalledSeats(APP).map((s) => s.display_name)).toEqual(['Zak'])
    rememberSeat(APP, { id: 'r0', display_name: 'Michelle' })
    expect(recalledSeats(APP).map((s) => s.display_name)).toEqual(['Michelle'])
  })

  it('treats a re-spelling as the same person, not a second one', () => {
    rememberSeat(APP, { id: 'r0', display_name: 'Michelle' })
    rememberSeat(APP, { id: 'r0', display_name: 'michelle' })
    expect(recalledSeats(APP).map((s) => s.display_name)).toEqual(['michelle'])
  })

  it('shows the newest to a phone that still holds several from before', () => {
    // No migration: a phone that stored three under the old cap sorts by
    // recency and takes the top one, then shrinks to one the next time anybody
    // sits down on it.
    localStorage.setItem(
      `${APP}_recent_seats`,
      JSON.stringify([
        { id: 'r0', display_name: 'Michelle', at: 100 },
        { id: 'r1', display_name: 'Zak', at: 300 },
        { id: 'r2', display_name: 'Nana', at: 200 },
      ]),
    )
    expect(recalledSeats(APP).map((s) => s.display_name)).toEqual(['Zak'])
  })

  it('ignores a blank name rather than storing an unusable row', () => {
    rememberSeat(APP, { display_name: '   ' })
    expect(recalledSeats(APP)).toEqual([])
  })

  it('does not leak between games installed on the same phone', () => {
    rememberSeat(APP, { display_name: 'Michelle' })
    expect(recalledSeats('othergame')).toEqual([])
  })

  it('survives garbage in storage', () => {
    localStorage.setItem(`${APP}_recent_seats`, '{not json')
    expect(recalledSeats(APP)).toEqual([])
    localStorage.setItem(`${APP}_recent_seats`, '"a string"')
    expect(recalledSeats(APP)).toEqual([])
  })
})

describe('what the seat-claim screen shows', () => {
  it('caps the list and reports the rest as findable', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [] })
    expect(c.list).toHaveLength(6)
    expect(c.hiddenCount).toBe(6)
    expect(c.searchable).toBe(true)
  })

  it('shows a short roster whole, with no search box', () => {
    const c = seatChoices({ roster: LONG.slice(0, 4), seated: [], recalled: [] })
    expect(c.list).toHaveLength(4)
    expect(c.hiddenCount).toBe(0)
    expect(c.searchable).toBe(false)
  })

  it('lifts a remembered name out of the list and onto a button', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [],
      recalled: [{ id: 'r8', display_name: 'Priya', at: 2 }],
    })
    expect(c.suggested.map((s) => s.display_name)).toEqual(['Priya'])
    expect(c.list.map((s) => s.display_name)).not.toContain('Priya')
  })

  it('matches a remembered name that was typed in, with no id to go on', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [],
      recalled: [{ id: '', display_name: 'priya', at: 1 }],
    })
    expect(c.suggested.map((s) => s.display_name)).toEqual(['Priya'])
  })

  it('follows the id when the roster name was since edited', () => {
    const c = seatChoices({
      roster: [entry('r0', 'Michelle S')],
      seated: [],
      recalled: [{ id: 'r0', display_name: 'Michelle', at: 1 }],
    })
    expect(c.suggested.map((s) => s.display_name)).toEqual(['Michelle S'])
  })

  it('drops anyone already sitting — that is the other section\'s job', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [seat('p1', 'michelle')],
      recalled: [],
    })
    expect(c.list.map((s) => s.display_name)).not.toContain('Michelle')
  })

  it('offers a waiting seat back before offering to make a new one', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [seat('p1', 'Nana')],
      recalled: [{ id: 'r2', display_name: 'Nana', at: 1 }],
    })
    expect(c.reclaimable.map((s) => s.id)).toEqual(['p1'])
    // And not also as a fresh claim, which would split her score in two.
    expect(c.suggested).toEqual([])
  })

  it('matches a waiting seat by roster link when the name reads differently', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [seat('p1', 'Nana B', { roster_entry: 'r2' })],
      recalled: [{ id: 'r2', display_name: 'Nana', at: 1 }],
    })
    expect(c.reclaimable.map((s) => s.id)).toEqual(['p1'])
  })

  it('never offers one seat to two remembered names', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [seat('p1', 'Nana')],
      recalled: [
        { id: '', display_name: 'Nana', at: 2 },
        { id: '', display_name: 'nana', at: 1 },
      ],
    })
    expect(c.reclaimable).toHaveLength(1)
  })
})

describe('searching', () => {
  it('finds a name anywhere in the roster, not just the visible part', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: 'mar' })
    expect(c.list.map((s) => s.display_name)).toEqual(['Marco'])
  })

  it('matches on any part of the name and ignores case', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: 'AV' })
    expect(c.list.map((s) => s.display_name)).toEqual(['Dave'])
  })

  it('shows every match rather than capping the answer', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: 'a', limit: 2 })
    expect(c.list.length).toBeGreaterThan(2)
    expect(c.hiddenCount).toBe(0)
  })

  it('keeps the box on screen while the query narrows past the cap', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: 'zzz' })
    expect(c.list).toEqual([])
    expect(c.searchable).toBe(true)
  })

  it('puts suggestions away while typing', () => {
    const c = seatChoices({
      roster: LONG,
      seated: [seat('p1', 'Nana')],
      recalled: [
        { id: 'r8', display_name: 'Priya', at: 2 },
        { id: 'r2', display_name: 'Nana', at: 1 },
      ],
      query: 'p',
    })
    expect(c.suggested).toEqual([])
    expect(c.reclaimable).toEqual([])
    expect(c.list.map((s) => s.display_name)).toContain('Priya')
  })

  it('puts the names that start with the query on top', () => {
    // Both are honest hits for "p"; only one of them looks like an answer.
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: 'p' })
    expect(c.list.map((s) => s.display_name)).toEqual(['Priya', 'Grandpa'])
  })

  it('treats a query of only spaces as no query', () => {
    const c = seatChoices({ roster: LONG, seated: [], recalled: [], query: '   ' })
    expect(c.list).toHaveLength(6)
    expect(c.hiddenCount).toBe(6)
  })
})
