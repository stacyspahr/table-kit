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
