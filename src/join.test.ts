/**
 * Joining a game night.
 *
 * The two cases that matter are the ones a card table produces and a test
 * environment never would: everybody scanning the QR at the same moment, and a
 * phone reloading itself mid-game because iOS discarded the tab.
 */

import { describe, expect, it } from 'vitest'
import { bootstrapJoin, claimSeat, reclaimSeat } from './join.js'
import type { TableKitConfig } from './config.js'
import type { PlayerRec } from './state.js'

const config: TableKitConfig = {
  appKey: 'nine',
  collections: {
    games: 'nine_games',
    players: 'nine_players',
    rounds: 'nine_rounds',
    submissions: 'nine_submissions',
  },
  winner: 'lowest',
  pbUrl: 'https://example.invalid',
}

function player(id: string, over: Partial<PlayerRec> = {}): PlayerRec {
  return {
    id,
    game: 'g1',
    display_name: id,
    seat_order: 0,
    device_id: '',
    guest: '',
    roster_entry: '',
    joined_round: 1,
    ...over,
  }
}

/** A PocketBase stand-in. Each collection gets whatever the test hands it. */
function fakePb(tables: Record<string, any>, authId = 'guest1') {
  const created: any[] = []
  const updated: any[] = []
  const pb: any = {
    authStore: { record: { id: authId } },
    collection(name: string) {
      const t = tables[name] ?? {}
      return {
        getOne: async () => t.one ?? {},
        getFullList: async () => {
          if (t.throws) throw new Error('nope')
          return t.list ?? []
        },
        create: async (data: any) => {
          created.push({ name, data })
          if (t.createFailsUntil && created.length <= t.createFailsUntil) {
            throw new Error('seat taken')
          }
          return { id: `p${created.length}`, ...data }
        },
        update: async (id: string, data: any) => {
          updated.push({ name, id, data })
          return { ...player(id), ...data }
        },
      }
    },
  }
  return { pb, created, updated }
}

const game = { id: 'g1', join_token: 't', status: 'active', host_user: 'host1', created: '' }

describe('bootstrapJoin', () => {
  const base = {
    nine_games: { one: game },
    nine_rounds: { list: [{ round_number: 4 }] },
    nine_roster: { list: [{ id: 'r1', display_name: 'Ann' }] },
  }

  it('puts a phone straight back in the seat it already holds', async () => {
    // ⚠️ The reload recovery path. iOS discards a backgrounded tab; landing
    // back here must not ask who they are for a second time mid-game.
    const mine = player('p1', { device_id: 'dev-a' })
    const { pb } = fakePb({ ...base, nine_players: { list: [mine] } })
    const r = await bootstrapJoin({
      pb,
      config,
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-a',
    })
    expect(r.seated?.id).toBe('p1')
  })

  it('recognises the seat by its guest credential too', async () => {
    // device_id can change when a guest credential is reissued; either
    // statement of "this phone holds this seat" counts.
    const mine = player('p1', { guest: 'guest1', device_id: 'old-device' })
    const { pb } = fakePb({ ...base, nine_players: { list: [mine] } })
    const r = await bootstrapJoin({
      pb,
      config,
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-new',
    })
    expect(r.seated?.id).toBe('p1')
  })

  it('asks who you are when this phone holds nothing', async () => {
    const { pb } = fakePb({ ...base, nine_players: { list: [player('p1', { device_id: 'other' })] } })
    const r = await bootstrapJoin({
      pb,
      config,
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-a',
    })
    expect(r.seated).toBeNull()
    expect(r.roster.map((x) => x.display_name)).toEqual(['Ann'])
    // The round a latecomer would be joining at.
    expect(r.round).toBe(4)
  })

  it('joins anyway when the roster cannot be read', async () => {
    // An unreadable roster costs the one-tap shortcut and nothing else. It must
    // never take the whole join down with it.
    const { pb } = fakePb({
      ...base,
      nine_players: { list: [] },
      nine_roster: { throws: true },
    })
    const r = await bootstrapJoin({
      pb,
      config,
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-a',
    })
    expect(r.roster).toEqual([])
    expect(r.game.id).toBe('g1')
  })

  it('starts at round 1 when nothing has been dealt', async () => {
    const { pb } = fakePb({ ...base, nine_rounds: { list: [] }, nine_players: { list: [] } })
    const r = await bootstrapJoin({
      pb,
      config,
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-a',
    })
    expect(r.round).toBe(1)
  })

  it('reads the roster collection named in config, not one derived from the app key', async () => {
    // Flip 7's is `f7_roster`, which predates the convention. Deriving the name
    // would need a per-app special case in kit code — the one thing the seam
    // rule forbids outright.
    const reads: string[] = []
    const { pb } = fakePb({ ...base, nine_players: { list: [] } })
    const inner = pb.collection.bind(pb)
    pb.collection = (n: string) => {
      reads.push(n)
      return inner(n)
    }
    await bootstrapJoin({
      pb,
      config: { ...config, collections: { ...config.collections, roster: 'f7_roster' } },
      joinGame: async () => ({ id: 'guest1', game: 'g1' }),
      token: 'tok',
      deviceId: 'dev-a',
    })
    expect(reads).toContain('f7_roster')
    expect(reads).not.toContain('nine_roster')
  })
})

describe('claimSeat', () => {
  it('takes the next seat after the ones already sitting', async () => {
    const { pb, created } = fakePb({
      nine_players: { list: [player('p1', { seat_order: 0 }), player('p2', { seat_order: 1 })] },
    })
    await claimSeat({
      pb,
      config,
      gameId: 'g1',
      deviceId: 'dev-a',
      displayName: '  Michelle ',
      round: 3,
    })
    expect(created[0]!.data).toMatchObject({
      display_name: 'Michelle',
      seat_order: 2,
      device_id: 'dev-a',
      // A latecomer owes nothing for holes played before they sat down.
      joined_round: 3,
      guest: 'guest1',
    })
  })

  it('walks past a collision when two people sit down at once', async () => {
    // Seats are unique on (game, seat_order) and everyone scans the QR
    // together, so the list this screen loaded with is stale immediately.
    const { pb, created } = fakePb({
      nine_players: { list: [player('p1', { seat_order: 0 })], createFailsUntil: 2 },
    })
    const seat = await claimSeat({
      pb,
      config,
      gameId: 'g1',
      deviceId: 'dev-a',
      displayName: 'Zak',
      round: 1,
    })
    expect(created.map((c) => c.data.seat_order)).toEqual([1, 2, 3])
    expect(seat.seat_order).toBe(3)
  })

  it('gives up rather than looping forever', async () => {
    const { pb } = fakePb({ nine_players: { list: [], createFailsUntil: 99 } })
    await expect(
      claimSeat({ pb, config, gameId: 'g1', deviceId: 'd', displayName: 'Zak', round: 1 }),
    ).rejects.toThrow()
  })

  it('refuses a nameless seat', async () => {
    const { pb } = fakePb({ nine_players: { list: [] } })
    await expect(
      claimSeat({ pb, config, gameId: 'g1', deviceId: 'd', displayName: '   ', round: 1 }),
    ).rejects.toThrow(/name/i)
  })

  it('links the roster entry when the name came from the roster', async () => {
    const { pb, created } = fakePb({ nine_players: { list: [] } })
    await claimSeat({
      pb,
      config,
      gameId: 'g1',
      deviceId: 'd',
      displayName: 'Ann',
      round: 1,
      rosterEntry: 'r1',
    })
    expect(created[0]!.data.roster_entry).toBe('r1')
  })

  it('leaves roster_entry off entirely for a typed name', async () => {
    // The server hook creates the entry after the fact; sending an empty
    // relation would be a write of nothing.
    const { pb, created } = fakePb({ nine_players: { list: [] } })
    await claimSeat({ pb, config, gameId: 'g1', deviceId: 'd', displayName: 'New', round: 1 })
    expect('roster_entry' in created[0]!.data).toBe(false)
  })
})

describe('reclaimSeat', () => {
  it('moves an existing seat onto this phone', async () => {
    // One path for two cases: a returning player on a new phone, and a
    // phoneless seat getting a phone halfway through the evening.
    const { pb, updated } = fakePb({})
    await reclaimSeat({
      pb,
      config,
      seat: player('p1', { device_id: 'old-phone' }),
      deviceId: 'new-phone',
    })
    expect(updated[0]).toMatchObject({
      name: 'nine_players',
      id: 'p1',
      data: { device_id: 'new-phone', guest: 'guest1' },
    })
  })
})
