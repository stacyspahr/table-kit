/**
 * The reveal's arithmetic.
 *
 * The case that matters most is the one both apps got right by accident and
 * would have got wrong on a third: a reveal plays while the round is still in
 * `review`, so the numbers have to be readable BEFORE the round closes.
 */

import { describe, expect, it } from 'vitest'
import { revealLayout, rowsForRound, totalsAsOf } from './reveal.js'
import type { GameRec, GameState, PlayerRec, RoundRec, SubmissionRec } from './state.js'

function player(id: string, seat: number, joined = 1): PlayerRec {
  return {
    id,
    game: 'g1',
    display_name: id,
    seat_order: seat,
    device_id: '',
    guest: '',
    roster_entry: '',
    joined_round: joined,
  }
}

const round = (id: string, n: number, status: RoundRec['status']): RoundRec => ({
  id,
  game: 'g1',
  round_number: n,
  status,
})

function sub(
  roundId: string,
  playerId: string,
  score: number,
  status?: 'draft' | 'final',
): SubmissionRec {
  return {
    id: `${roundId}-${playerId}`,
    round: roundId,
    player: playerId,
    computed_score: score,
    submitted_by: playerId,
    client_uuid: `${roundId}-${playerId}`,
    created: '2026-08-01 20:00:00',
    ...(status ? { status } : {}),
  }
}

function state(
  rounds: RoundRec[],
  submissions: SubmissionRec[],
  players: PlayerRec[] = [player('ann', 1), player('bo', 2), player('cy', 3)],
): GameState<GameRec, SubmissionRec> {
  return {
    game: { id: 'g1', join_token: 't', status: 'active', host_user: 'h', created: '' },
    players,
    rounds,
    submissions,
    current: rounds.find((r) => r.status !== 'closed') ?? null,
  }
}

describe('totalsAsOf', () => {
  const rounds = [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'open')]
  const subs = [
    sub('r1', 'ann', 5),
    sub('r2', 'ann', 7),
    sub('r3', 'ann', 100),
    sub('r1', 'bo', 3),
  ]

  it('adds up the closed rounds to that point and stops', () => {
    const s = state(rounds, subs)
    expect(totalsAsOf(s, 1).get('ann')).toBe(5)
    expect(totalsAsOf(s, 2).get('ann')).toBe(12)
  })

  it('ignores a round that has not closed, however high the number', () => {
    expect(totalsAsOf(state(rounds, subs), 3).get('ann')).toBe(12)
  })

  it('is zero before anything was played', () => {
    expect(totalsAsOf(state(rounds, subs), 0).get('ann')).toBe(0)
  })

  it('leaves a half-tapped draft out', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 9, 'draft')])
    expect(totalsAsOf(s, 1).get('ann')).toBe(0)
  })
})

describe('rowsForRound', () => {
  it('reads a round still in review, because that is when the reveal plays', () => {
    // Both apps happened to get this right; a third would not have.
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'review')],
      [sub('r1', 'ann', 10), sub('r2', 'ann', 4)],
    )
    const rows = rowsForRound(s, s.rounds[1]!)
    const ann = rows.find((r) => r.player.id === 'ann')!
    expect(ann).toMatchObject({ before: 10, delta: 4, after: 14 })
  })

  it('carries a negative delta, so a board can move backwards', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'review')],
      [sub('r1', 'ann', 20), sub('r2', 'ann', -30)],
    )
    const ann = rowsForRound(s, s.rounds[1]!).find((r) => r.player.id === 'ann')!
    expect(ann).toMatchObject({ before: 20, delta: -30, after: -10 })
  })

  it('shows nothing moved for a seat that has not handed in', () => {
    const s = state([round('r1', 1, 'open')], [sub('r1', 'ann', 6)])
    const bo = rowsForRound(s, s.rounds[0]!).find((r) => r.player.id === 'bo')!
    expect(bo).toMatchObject({ before: 0, delta: 0, after: 0 })
  })

  it('leaves out a seat that had not sat down yet', () => {
    // Rendering them would slide a row in from a position they never held.
    const late = player('cy', 3, 2)
    const s = state(
      [round('r1', 1, 'review')],
      [sub('r1', 'ann', 4)],
      [player('ann', 1), late],
    )
    expect(rowsForRound(s, s.rounds[0]!).map((r) => r.player.id)).toEqual(['ann'])
  })
})

describe('revealLayout', () => {
  const rows = [
    { player: player('ann', 1), before: 10, delta: 9, after: 19 },
    { player: player('bo', 2), before: 14, delta: 1, after: 15 },
    { player: player('cy', 3), before: 12, delta: 0, after: 12 },
  ]

  it('orders a lowest-wins board best first', () => {
    const { ordered } = revealLayout(rows, { winner: 'lowest', rowHeight: 68 })
    expect(ordered.map((r) => r.player.id)).toEqual(['cy', 'bo', 'ann'])
  })

  it('orders a highest-wins board the other way', () => {
    const { ordered } = revealLayout(rows, { winner: 'highest', rowHeight: 56 })
    expect(ordered.map((r) => r.player.id)).toEqual(['ann', 'bo', 'cy'])
  })

  it('offsets each row by how far it traveled, in whole rows', () => {
    // lowest-wins. before: ann 10, cy 12, bo 14 → after: cy 12, bo 15, ann 19.
    // ann falls from slot 0 to slot 2, so she starts two rows ABOVE where she
    // will end up: (0 - 2) * 76 = -152.
    const { offsets } = revealLayout(rows, { winner: 'lowest', rowHeight: 68 })
    expect(offsets.get('ann')).toBe(-152)
    expect(offsets.get('cy')).toBe(76)
    expect(offsets.get('bo')).toBe(76)
  })

  it('honors the row height it is given', () => {
    const { offsets } = revealLayout(rows, { winner: 'lowest', rowHeight: 56, gap: 8 })
    expect(offsets.get('ann')).toBe(-128)
  })

  it('does not move a row that did not change place', () => {
    const still = [
      { player: player('ann', 1), before: 1, delta: 1, after: 2 },
      { player: player('bo', 2), before: 5, delta: 1, after: 6 },
    ]
    const { offsets } = revealLayout(still, { winner: 'lowest', rowHeight: 68 })
    expect(offsets.get('ann')).toBe(0)
    expect(offsets.get('bo')).toBe(0)
  })

  it('breaks ties on seat order in both orderings, so nothing jitters', () => {
    const tied = [
      { player: player('bo', 2), before: 0, delta: 0, after: 0 },
      { player: player('ann', 1), before: 0, delta: 0, after: 0 },
    ]
    const { ordered, offsets } = revealLayout(tied, { winner: 'lowest', rowHeight: 68 })
    expect(ordered.map((r) => r.player.id)).toEqual(['ann', 'bo'])
    expect(offsets.get('ann')).toBe(0)
    expect(offsets.get('bo')).toBe(0)
  })
})
