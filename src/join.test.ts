/**
 * Joining a game night.
 *
 * The two cases that matter are the ones a card table produces and a test
 * environment never would: everybody scanning the QR at the same moment, and a
 * phone reloading itself mid-game because iOS discarded the tab.
 */

import { describe, expect, it } from 'vitest'
import { bootstrapJoin, claimSeat, reclaimSeat, removeSeat } from './join.js'
import type { TableKitConfig } from './config.js'
import { lastHandover, type PlayerRec } from './state.js'

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
  const deleted: any[] = []
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
        delete: async (id: string) => {
          deleted.push({ name, id })
          return true
        },
      }
    },
  }
  return { pb, created, updated, deleted }
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

  it('recognizes the seat by its guest credential too', async () => {
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

  it('renames the seat and records the handover when somebody else takes over', async () => {
    // Dad goes to check on the kids; Michelle picks up his cards. The seat is
    // hers from here, and its running total comes with it.
    const { pb, updated } = fakePb({})
    await reclaimSeat({
      pb,
      config,
      seat: player('p1', { display_name: 'Dad', device_id: 'dads-phone', roster_entry: 'r-dad' }),
      deviceId: 'michelles-phone',
      takeOver: { displayName: 'Michelle', rosterEntry: 'r-michelle', round: 5 },
    })
    expect(updated[0]!.data).toMatchObject({
      device_id: 'michelles-phone',
      display_name: 'Michelle',
      // ⚠️ The durable identity follows the name. See the note in join.ts.
      roster_entry: 'r-michelle',
      handovers: [{ from: 'Dad', round: 5 }],
    })
  })

  it('appends, so a seat can change hands more than once', async () => {
    // Dad hands over on 5 and takes it back on 7. One pair of fields could not
    // say that, which is why this is an array.
    const { pb, updated } = fakePb({})
    await reclaimSeat({
      pb,
      config,
      seat: player('p1', {
        display_name: 'Michelle',
        device_id: 'michelles-phone',
        handovers: [{ from: 'Dad', round: 5 }],
      }),
      deviceId: 'dads-phone',
      takeOver: { displayName: 'Dad', rosterEntry: 'r-dad', round: 7 },
    })
    expect(updated[0]!.data.handovers).toEqual([
      { from: 'Dad', round: 5 },
      { from: 'Michelle', round: 7 },
    ])
  })

  it('does NOT log a handover when the name is unchanged', async () => {
    // Tapping your own name off the list is recovery, whichever button got you
    // here. Logging it would fill the record with events that never happened.
    const { pb, updated } = fakePb({})
    await reclaimSeat({
      pb,
      config,
      seat: player('p1', { display_name: 'Dad', device_id: 'old' }),
      deviceId: 'new',
      takeOver: { displayName: 'Dad', rosterEntry: 'r-dad', round: 5 },
    })
    expect(updated[0]!.data).not.toHaveProperty('handovers')
    expect(updated[0]!.data).not.toHaveProperty('display_name')
  })

  it('survives a seat whose handovers column holds nothing sensible', async () => {
    // It is a JSON column: an old row has no value at all.
    const { pb, updated } = fakePb({})
    await reclaimSeat({
      pb,
      config,
      seat: { ...player('p1', { display_name: 'Dad' }), handovers: undefined },
      deviceId: 'new',
      takeOver: { displayName: 'Michelle', round: 2 },
    })
    expect(updated[0]!.data.handovers).toEqual([{ from: 'Dad', round: 2 }])
  })
})

describe('lastHandover', () => {
  it('returns the most recent change of occupant', () => {
    const seat = player('p1', {
      handovers: [
        { from: 'Dad', round: 5 },
        { from: 'Michelle', round: 7 },
      ],
    })
    expect(lastHandover(seat)).toEqual({ from: 'Michelle', round: 7 })
  })

  it('returns null for a seat nobody has taken over', () => {
    expect(lastHandover(player('p1'))).toBeNull()
  })

  it('returns null rather than throwing on a malformed column', () => {
    expect(lastHandover({ ...player('p1'), handovers: 'nonsense' as any })).toBeNull()
    expect(lastHandover({ ...player('p1'), handovers: [{ nope: 1 }] as any })).toBeNull()
  })
})

describe('a seat for someone with no phone', () => {
  it('carries neither a device nor a credential', async () => {
    // That absence IS the mark of an unclaimed seat, and it is what lets
    // anyone at the table enter for it.
    const { pb, created } = fakePb({ nine_players: { list: [] } })
    await claimSeat({
      pb,
      config,
      gameId: 'g1',
      deviceId: '',
      displayName: 'Grandpa',
      round: 1,
    })
    expect(created[0]!.data).toMatchObject({ display_name: 'Grandpa', seat_order: 0 })
    expect('device_id' in created[0]!.data).toBe(false)
    // ⚠️ Writing the HOST's credential here would read as claimed by the host's
    // phone, and the seat could then never be taken over by its actual player.
    expect('guest' in created[0]!.data).toBe(false)
  })

  it('still walks past a collision, same as any other seat', async () => {
    const { pb, created } = fakePb({
      nine_players: { list: [player('p1', { seat_order: 0 })], createFailsUntil: 1 },
    })
    await claimSeat({ pb, config, gameId: 'g1', deviceId: '', displayName: 'Nana', round: 1 })
    expect(created.map((c) => c.data.seat_order)).toEqual([1, 2])
  })
})

describe('removeSeat', () => {
  const seat = player('p1', { display_name: 'Nana' })

  it('takes a seat away while the game is still in the lobby', async () => {
    const { pb, deleted } = fakePb({})
    await removeSeat({ pb, config, game: { ...game, status: 'lobby' }, seat })
    expect(deleted).toEqual([{ name: 'nine_players', id: 'p1' }])
  })

  /**
   * ⚠️ The one that matters. A seat's submissions relate to it, so deleting
   * one mid-game rewrites the night to say that player was never there —
   * every closed round's totals change and their lifetime stats lose the game.
   * Leaving mid-game is a span on the seat, not the absence of one.
   */
  it('REFUSES once the game is active, and deletes nothing', async () => {
    const { pb, deleted } = fakePb({})
    await expect(
      removeSeat({ pb, config, game: { ...game, status: 'active' }, seat }),
    ).rejects.toThrow(/before the game starts/)
    expect(deleted).toEqual([])
  })

  it('refuses on a finished game too', async () => {
    const { pb, deleted } = fakePb({})
    await expect(
      removeSeat({ pb, config, game: { ...game, status: 'finished' }, seat }),
    ).rejects.toThrow()
    expect(deleted).toEqual([])
  })
})
