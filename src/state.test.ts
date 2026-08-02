/**
 * The extraction proof.
 *
 * Ported from Flip 7's `game.test.ts`. The originals were almost entirely about
 * `brutal_target` — one submission scoring against TWO players — which is a
 * Flip 7 rule and does not belong in the kit. So those cases come across
 * inverted: instead of testing that the kit implements the rule, they test that
 * a game can SUPPLY it. If these pass, the seam is wide enough for Flip 7 to
 * migrate onto without the kit knowing anything about Flip 7.
 *
 * The rest covers what the kit does own, including the two behaviours Beat the
 * Heat needs that Flip 7 never exercised: lowest-wins, and a goal check that is
 * independent of who wins.
 */

import { describe, expect, it } from 'vitest'
import {
  asEndCondition,
  committedTotals,
  endReached,
  goalReached,
  isFinalRound,
  roundsLeft,
  roundsPlayed,
  standings,
  submissionFor,
  submittedThisRound,
  sumScores,
  tieAtFront,
  totals,
  waitingOn,
  type GameRec,
  type GameState,
  type PlayerRec,
  type RoundRec,
  type SubmissionRec,
  type Tally,
} from './state.js'

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

function round(id: string, number: number, status: RoundRec['status']): RoundRec {
  return { id, game: 'g1', round_number: number, status }
}

function sub(
  roundId: string,
  playerId: string,
  score: number,
  extra: Partial<SubmissionRec> = {},
): SubmissionRec {
  return {
    id: `${roundId}-${playerId}`,
    round: roundId,
    player: playerId,
    computed_score: score,
    submitted_by: playerId,
    client_uuid: `${roundId}-${playerId}-uuid`,
    created: '2026-07-30 20:00:00',
    ...extra,
  }
}

function state(
  rounds: RoundRec[],
  submissions: SubmissionRec[],
  players: PlayerRec[] = [player('ann', 1), player('bo', 2), player('cy', 3)],
): GameState<GameRec, SubmissionRec> {
  return {
    game: {
      id: 'g1',
      join_token: 't',
      status: 'active',
      host_user: 'h',
      created: '',
    },
    players,
    rounds,
    submissions,
    current: rounds.find((r) => r.status !== 'closed') ?? null,
  }
}

describe('totals', () => {
  it('sums each player’s own scores', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 22), sub('r1', 'bo', 14), sub('r1', 'cy', -6)],
    )
    const t = totals(s)
    expect(t.get('ann')).toBe(22)
    expect(t.get('bo')).toBe(14)
    expect(t.get('cy')).toBe(-6)
  })

  it('gives an absent player a zero rather than leaving them out', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 10)])
    expect(totals(s).get('cy')).toBe(0)
  })

  it('ignores a submission from a seat that is no longer at the table', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 30), sub('r1', 'gone', 99)])
    const t = totals(s)
    expect(t.get('ann')).toBe(30)
    expect([...t.keys()]).not.toContain('gone')
  })
})

describe('committedTotals', () => {
  it('holds an open round back so the board does not move early', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'open')],
      [sub('r1', 'ann', 20), sub('r2', 'ann', 30)],
    )
    expect(committedTotals(s).get('ann')).toBe(20)
    expect(totals(s).get('ann')).toBe(50)
  })
})

describe('a game-supplied tally', () => {
  /**
   * Flip 7's rule, living entirely outside the kit: an aimed Flip 7 takes 15
   * off the TARGET rather than adding it to the flipper, so one row scores
   * against two players.
   */
  type F7Sub = SubmissionRec & { brutal_target?: string }
  const flip7Tally: Tally<F7Sub> = (players, submissions) => {
    const out = sumScores(players, submissions)
    for (const s of submissions) {
      if (s.brutal_target && out.has(s.brutal_target)) {
        out.set(s.brutal_target, (out.get(s.brutal_target) ?? 0) - 15)
      }
    }
    return out
  }

  it('can score one submission against two players', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 30, { brutal_target: 'bo' } as Partial<SubmissionRec>), sub('r1', 'bo', 10)],
    ) as GameState<GameRec, F7Sub>

    const t = totals(s, flip7Tally)
    expect(t.get('ann')).toBe(30)
    expect(t.get('bo')).toBe(-5)
    expect(t.get('cy')).toBe(0)
  })

  it('is honoured by committedTotals too, so the penalty reveals with the round', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'open')],
      [
        sub('r1', 'bo', 20),
        sub('r2', 'ann', 30, { brutal_target: 'bo' } as Partial<SubmissionRec>),
      ],
    ) as GameState<GameRec, F7Sub>

    expect(committedTotals(s, flip7Tally).get('bo')).toBe(20)
    expect(totals(s, flip7Tally).get('bo')).toBe(5)
  })
})

describe('waitingOn', () => {
  it('lists everyone who still owes a score', () => {
    const s = state([round('r1', 1, 'open')], [sub('r1', 'ann', 10)])
    expect(waitingOn(s).map((p) => p.id)).toEqual(['bo', 'cy'])
  })

  it('counts an unclaimed seat like any other, so nobody is forgotten', () => {
    const seats = [player('ann', 1), player('nophone', 2)]
    const s = state([round('r1', 1, 'open')], [sub('r1', 'ann', 10)], seats)
    expect(waitingOn(s).map((p) => p.id)).toEqual(['nophone'])
  })

  it('does not chase a latecomer for rounds that ran before they sat down', () => {
    const seats = [player('ann', 1), player('late', 2, 3)]
    const s = state([round('r2', 2, 'open')], [], seats)
    expect(waitingOn(s).map((p) => p.id)).toEqual(['ann'])
  })

  it('is empty when no round is open', () => {
    expect(waitingOn(state([round('r1', 1, 'closed')], []))).toEqual([])
  })
})

describe('submittedThisRound / submissionFor', () => {
  it('reports who is in for the open round only', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'open')],
      [sub('r1', 'bo', 5), sub('r2', 'ann', 10)],
    )
    expect([...submittedThisRound(s)]).toEqual(['ann'])
    expect(submissionFor(s, 'r1', 'bo')?.computed_score).toBe(5)
    expect(submissionFor(s, 'r2', 'bo')).toBeUndefined()
  })
})

describe('standings', () => {
  const s = state(
    [round('r1', 1, 'closed')],
    [sub('r1', 'ann', 40), sub('r1', 'bo', 12), sub('r1', 'cy', 27)],
  )

  it('puts the highest first for a highest-wins game', () => {
    expect(standings(s, 'highest').map((r) => r.player.id)).toEqual(['ann', 'cy', 'bo'])
  })

  it('puts the lowest first for a lowest-wins game', () => {
    // Beat the Heat. Flip 7 never exercised this path.
    expect(standings(s, 'lowest').map((r) => r.player.id)).toEqual(['bo', 'cy', 'ann'])
  })

  it('shares a place on a tie and breaks display order by seat', () => {
    const tied = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 10), sub('r1', 'bo', 10), sub('r1', 'cy', 30)],
    )
    const rows = standings(tied, 'lowest')
    expect(rows.map((r) => r.player.id)).toEqual(['ann', 'bo', 'cy'])
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3])
  })
})

describe('goalReached', () => {
  /**
   * The trigger is the same in both directions: scores climb, and crossing the
   * number ends the game. Only the WINNER differs. Conflating the two is the
   * bug waiting to happen when a low-wins game inherits a high-wins hook.
   */
  it('fires on the biggest score regardless of who is winning', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 66), sub('r1', 'bo', 12)],
    )
    expect(goalReached(s, 66)).toBe(true)
  })

  it('does not fire below the goal', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 65)])
    expect(goalReached(s, 66)).toBe(false)
  })
})

describe('tieAtFront', () => {
  it('finds a tie at the low end for a lowest-wins game', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 12), sub('r1', 'bo', 12), sub('r1', 'cy', 70)],
    )
    expect(tieAtFront(s, 'lowest', 66).map((p) => p.id)).toEqual(['ann', 'bo'])
  })

  it('finds a tie at the high end for a highest-wins game', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 70), sub('r1', 'bo', 70), sub('r1', 'cy', 5)],
    )
    expect(tieAtFront(s, 'highest', 66).map((p) => p.id)).toEqual(['ann', 'bo'])
  })

  it('is empty while nobody has reached the goal', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 10), sub('r1', 'bo', 10)])
    expect(tieAtFront(s, 'lowest', 66)).toEqual([])
  })

  it('is empty when the game is already finished', () => {
    const s = state(
      [round('r1', 1, 'closed')],
      [sub('r1', 'ann', 70), sub('r1', 'bo', 70)],
    )
    s.game.status = 'finished'
    expect(tieAtFront(s, 'highest', 66)).toEqual([])
  })
})

/**
 * Drafts. Added in v0.2.0 with autosave, and every one of these was a real bug
 * in the first cut: a half-counted pile read as an answer.
 */
describe('drafts are not answers', () => {
  const base = () => ({
    game: { id: 'g', join_token: 't', status: 'active' as const, host_user: 'u', created: '' },
    players: [
      { id: 'p1', game: 'g', display_name: 'Ada', seat_order: 0, device_id: 'a', guest: '', roster_entry: '', joined_round: 1 },
      { id: 'p2', game: 'g', display_name: 'Bob', seat_order: 1, device_id: 'b', guest: '', roster_entry: '', joined_round: 1 },
    ],
    rounds: [{ id: 'r1', game: 'g', round_number: 1, status: 'open' as const }],
    submissions: [],
    current: { id: 'r1', game: 'g', round_number: 1, status: 'open' as const },
  })

  const sub = (id: string, player: string, score: number, status?: 'draft' | 'final') => ({
    id, round: 'r1', player, computed_score: score,
    submitted_by: player, client_uuid: '', created: '', ...(status ? { status } : {}),
  })

  it('still waits on a player who is only part-way through counting', () => {
    // The bug this exists for: Ada picks up her pile, taps two cards, and the
    // autosave drops her out of waitingOn. The table is told nobody is
    // outstanding while the round never advances, with no name to explain it.
    const state = { ...base(), submissions: [sub('s1', 'p1', 4, 'draft')] }
    expect(waitingOn(state).map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(submittedThisRound(state).has('p1')).toBe(false)
  })

  it('stops waiting once that draft is handed in', () => {
    const state = { ...base(), submissions: [sub('s1', 'p1', 4, 'final')] }
    expect(waitingOn(state).map((p) => p.id)).toEqual(['p2'])
  })

  it('keeps a half-counted pile off the totals and out of the goal check', () => {
    const state = { ...base(), submissions: [sub('s1', 'p1', 40, 'draft')] }
    expect(totals(state).get('p1')).toBe(0)
    expect(goalReached(state, 30)).toBe(false)
  })

  it('treats a submission with no status at all as final', () => {
    // Flip 7 has no drafts and never sets the field. It must not suddenly stop
    // counting when it migrates onto the kit.
    const state = { ...base(), submissions: [sub('s1', 'p1', 12)] }
    expect(waitingOn(state).map((p) => p.id)).toEqual(['p2'])
    expect(totals(state).get('p1')).toBe(12)
  })

  it('leaves a draft out of the banked board', () => {
    const state = {
      ...base(),
      rounds: [{ id: 'r1', game: 'g', round_number: 1, status: 'closed' as const }],
      current: null,
      submissions: [sub('s1', 'p1', 9, 'draft'), sub('s2', 'p2', 3, 'final')],
    }
    const board = standings(state, 'lowest')
    expect(board.map((r) => [r.player.id, r.score])).toEqual([['p1', 0], ['p2', 3]])
  })
})

/**
 * The end condition.
 *
 * Two shapes behind one check, and the reason for the type is the third
 * function: a fixed-length game can say "this is the last one" BEFORE it is
 * played, and a points game can never know. Everything Play Nine needs to
 * rename its final button rests on that asymmetry.
 */
describe('end conditions', () => {
  const nine = { type: 'rounds' as const, value: 3 }

  it('reads a bare number as points, so nothing written before rounds breaks', () => {
    expect(asEndCondition(66)).toEqual({ type: 'points', value: 66 })
    expect(asEndCondition(nine)).toBe(nine)
  })

  it('counts only banked rounds as played', () => {
    const s = state([round('r1', 1, 'closed'), round('r2', 2, 'open')], [])
    expect(roundsPlayed(s)).toBe(1)
  })

  it('counts a round in progress as still to play', () => {
    const s = state([round('r1', 1, 'closed'), round('r2', 2, 'open')], [])
    expect(roundsLeft(s, nine)).toBe(2)
  })

  it('gives no answer for a points game rather than a misleading zero', () => {
    const s = state([round('r1', 1, 'open')], [])
    expect(roundsLeft(s, 66)).toBeNull()
  })

  it('never reports a negative number of rounds left', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'closed'),
       round('r4', 4, 'closed')],
      [],
    )
    expect(roundsLeft(s, nine)).toBe(0)
  })

  it('knows the last round while it is still being played', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'open')],
      [],
    )
    expect(isFinalRound(s, nine)).toBe(true)
    expect(endReached(s, nine)).toBe(false)
  })

  it('does not call an earlier round final', () => {
    const s = state([round('r1', 1, 'closed'), round('r2', 2, 'open')], [])
    expect(isFinalRound(s, nine)).toBe(false)
  })

  it('never calls a round final in a points game, because nobody could know', () => {
    const s = state([round('r1', 1, 'open')], [sub('r1', 'ann', 90)])
    expect(isFinalRound(s, 66)).toBe(false)
  })

  it('has no final round when nothing is open — there is nothing left to sign', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'closed')],
      [],
    )
    expect(isFinalRound(s, nine)).toBe(false)
    expect(endReached(s, nine)).toBe(true)
  })

  it('ends a points game on the score, ignoring how many rounds it took', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 70)])
    expect(endReached(s, { type: 'points', value: 66 })).toBe(true)
    expect(endReached(s, { type: 'rounds', value: 9 })).toBe(false)
  })

  it('ends a rounds game on the count, however low the scores are', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'closed')],
      [sub('r1', 'ann', 1)],
    )
    expect(endReached(s, nine)).toBe(true)
  })

  it('still answers to the old name with a bare goal', () => {
    const s = state([round('r1', 1, 'closed')], [sub('r1', 'ann', 70)])
    expect(goalReached(s, 66)).toBe(true)
  })

  it('finds a tie at the front of a game that ran out of rounds', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'closed')],
      [sub('r1', 'ann', 30), sub('r2', 'bo', 30), sub('r3', 'cy', 44)],
    )
    expect(tieAtFront(s, 'lowest', nine).map((p) => p.id)).toEqual(['ann', 'bo'])
  })

  it('leaves a tie alone while rounds remain', () => {
    const s = state(
      [round('r1', 1, 'closed'), round('r2', 2, 'open')],
      [sub('r1', 'ann', 30), sub('r1', 'bo', 30)],
    )
    expect(tieAtFront(s, 'lowest', nine)).toEqual([])
  })
})
