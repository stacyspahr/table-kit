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
  committedTotals,
  goalReached,
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
