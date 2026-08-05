import { describe, expect, it } from 'vitest'
import { lobbyState } from './lobby.js'
import type { TableKitConfig } from './config.js'

const config = (minPlayers?: number): TableKitConfig => ({
  appKey: 'test',
  collections: {
    games: 't_games',
    players: 't_players',
    rounds: 't_rounds',
    submissions: 't_submissions',
  },
  winner: 'highest',
  pbUrl: 'https://example.test',
  ...(minPlayers === undefined ? {} : { minPlayers }),
})

describe('lobbyState', () => {
  it('holds the start until the floor is met', () => {
    expect(lobbyState(2, config(3))).toMatchObject({ canStart: false, shortBy: 1 })
  })

  it('starts once the floor is met', () => {
    expect(lobbyState(3, config(3))).toMatchObject({ canStart: true, shortBy: 0 })
  })

  it('does not go on holding a table that is over the floor', () => {
    expect(lobbyState(6, config(3))).toMatchObject({ canStart: true, shortBy: 0 })
  })

  it('still refuses an empty table when a game declares no floor', () => {
    // The default is 1, not 0. Every app carried its own `players.length === 0`
    // check before this existed; the default is that check, kept.
    expect(lobbyState(0, config())).toMatchObject({ canStart: false, shortBy: 1 })
    expect(lobbyState(1, config())).toMatchObject({ canStart: true, shortBy: 0 })
  })

  it('treats a floor below one as one', () => {
    // A game declaring 0 would otherwise be allowed to deal to nobody.
    expect(lobbyState(0, config(0))).toMatchObject({ canStart: false, minPlayers: 1 })
  })

  it('reports the floor in force, so the app can say the number', () => {
    // The sentence is the app's, but the number in it has to be the one being
    // enforced — otherwise the two drift and the message lies.
    expect(lobbyState(1, config(3))).toMatchObject({ minPlayers: 3, seated: 1, shortBy: 2 })
  })
})

/**
 * The ceiling.
 *
 * ⚠️ Absent is the COMMON case, not the fallback: only one game in the suite
 * has a hard limit. A cap invented for tidiness refuses a real game somebody
 * is sitting down to play — Flip 7's twelve is where one deck runs out, and
 * Play Nine's rulebook says a big table is no problem.
 */
describe('the ceiling', () => {
  const capped = (max: number): TableKitConfig => ({ ...config(2), maxPlayers: max })

  it('is absent by default, and absence means no ceiling', () => {
    const s = lobbyState(50, config(2))
    expect(s.full).toBe(false)
    expect(s.maxPlayers).toBeUndefined()
    expect(s.roomFor).toBe(Infinity)
  })

  it('counts the chairs left', () => {
    expect(lobbyState(7, capped(10))).toMatchObject({ full: false, roomFor: 3 })
  })

  it('is full ON the number, not past it', () => {
    expect(lobbyState(9, capped(10)).full).toBe(false)
    expect(lobbyState(10, capped(10)).full).toBe(true)
  })

  it('never reports negative room, even at a table that got over the line', () => {
    // The server check is count-then-create and not atomic, so one over is
    // possible. It must read as full, never as room for minus one.
    expect(lobbyState(11, capped(10))).toMatchObject({ full: true, roomFor: 0 })
  })

  /**
   * ⚠️ The one that matters. The number in the message and the number the
   * SERVER refuses on have to be the same number, and the server reads the
   * game's own snapshot — so this must prefer it over the config.
   */
  it("takes the game's own ceiling over the config's", () => {
    const s = lobbyState(8, capped(10), { max_players: 8 })
    expect(s.maxPlayers).toBe(8)
    expect(s.full).toBe(true)
  })

  it('falls back to the config for a game dealt before the column existed', () => {
    expect(lobbyState(10, capped(10), {}).full).toBe(true)
  })

  it('treats a zero on the game as no ceiling, which is what an empty column reads as', () => {
    const s = lobbyState(50, config(2), { max_players: 0 })
    expect(s.full).toBe(false)
    expect(s.maxPlayers).toBeUndefined()
  })

  it('leaves the floor alone', () => {
    // A full table can still be short of the floor if the cap is below it,
    // which is a misconfiguration rather than a state to design for — but it
    // must not silently flip canStart.
    expect(lobbyState(1, capped(1))).toMatchObject({ full: true, canStart: false, shortBy: 1 })
  })
})
