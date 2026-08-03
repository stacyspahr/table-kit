import { describe, expect, it } from 'vitest'
import type PocketBase from 'pocketbase'
import { createActions } from './actions.js'
import type { Queue } from './queue.js'
import type { TableKitConfig } from './config.js'

const config: TableKitConfig = {
  appKey: 'test',
  collections: {
    games: 't_games',
    players: 't_players',
    rounds: 't_rounds',
    submissions: 't_submissions',
  },
  winner: 'highest',
  pbUrl: 'https://example.test',
}

/**
 * A client that records which collections it was asked for, and answers with
 * whatever this fake was seeded with.
 *
 * The guest is seeded EMPTY on purpose: that is exactly what PocketBase returns
 * to a guest reading a game its token is not bound to. Not an error — an empty
 * list. Which is the whole reason the bug this covers was invisible.
 */
function fakeClient(name: string, seeded: boolean) {
  const asked: string[] = []
  const client = {
    asked,
    name,
    collection(collection: string) {
      asked.push(collection)
      return {
        getOne: async () =>
          seeded ? { id: 'g1', status: 'finished' } : Promise.reject(new Error('404')),
        getFullList: async () =>
          seeded
            ? collection === 't_players'
              ? [{ id: 'p1', display_name: 'Ada', seat_order: 0, joined_round: 1 }]
              : collection === 't_rounds'
                ? [{ id: 'r1', round_number: 1, status: 'closed' }]
                : [{ id: 's1', round: 'r1', player: 'p1', computed_score: 12 }]
            : [],
      }
    },
  }
  return client
}

const queue = { pendingIn: () => [] } as unknown as Queue

describe('loadState, and which client reads the game', () => {
  it('reads through the client it is given, not the one it was built with', async () => {
    // The host screen opens a FINISHED game it owns. The guest credential on
    // that phone is bound to whichever game it last joined, so it is the wrong
    // key for this door — and it fails by returning nothing rather than by
    // complaining, which is how a host screen ends up showing "0 rounds" and
    // no reason for it.
    const guest = fakeClient('guest', false)
    const host = fakeClient('host', true)
    const actions = createActions({ pb: guest as unknown as PocketBase, config, queue })

    const state = await actions.loadState('g1', host as unknown as PocketBase)

    expect(state.players).toHaveLength(1)
    expect(state.rounds).toHaveLength(1)
    expect(state.submissions).toHaveLength(1)
    // Every read went through the host; the guest was never asked.
    expect(host.asked).toContain('t_players')
    expect(guest.asked).toHaveLength(0)
  })

  it('still defaults to the client it was built with', async () => {
    // A player's own screen passes nothing, and must keep reading as the guest.
    const guest = fakeClient('guest', true)
    const actions = createActions({ pb: guest as unknown as PocketBase, config, queue })

    await actions.loadState('g1')

    expect(guest.asked).toContain('t_games')
    expect(guest.asked).toContain('t_players')
  })
})

describe('starting the game', () => {
  /** Records the update it was asked to make, and on which client. */
  function writer() {
    const writes: { collection: string; id: string; data: Record<string, unknown> }[] = []
    const client = {
      writes,
      collection(collection: string) {
        return {
          update: async (id: string, data: Record<string, unknown>) => {
            writes.push({ collection, id, data })
            return { id, ...data }
          },
        }
      },
    }
    return client
  }

  it('deals by moving the game out of the lobby', async () => {
    const guest = writer()
    const host = writer()
    const actions = createActions({ pb: guest as unknown as PocketBase, config, queue })

    const game = await actions.startGame('g1', host as unknown as PocketBase)

    expect(host.writes).toEqual([
      { collection: 't_games', id: 'g1', data: { status: 'active' } },
    ])
    expect(game.status).toBe('active')
  })

  it('never writes as the guest, whichever client it was built with', async () => {
    // The seated host's phone holds BOTH credentials, and the kit is built on
    // the guest one. Only a host may write the games collection, so picking up
    // the built-in client here would fail at the table on the one tap that
    // starts the evening.
    const guest = writer()
    const host = writer()
    const actions = createActions({ pb: guest as unknown as PocketBase, config, queue })

    await actions.startGame('g1', host as unknown as PocketBase)

    expect(guest.writes).toHaveLength(0)
  })
})
