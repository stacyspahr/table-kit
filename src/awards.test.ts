/**
 * The awards engine, tested through definitions that are deliberately NOT any
 * real game's.
 *
 * The whole point of the engine is that it doesn't know what it's measuring, so
 * testing it with Beat the Heat's actual awards would prove less, not more —
 * it would only show that one game's rules work. These fake awards exercise the
 * shapes instead: ranked both ways, threshold, ineligibility, ties, and the
 * degenerate case where nobody qualifies.
 */

import { describe, expect, it } from 'vitest'
import {
  closedSubmissions,
  gameScope,
  roundScope,
  runAwards,
  submissionsByPlayer,
  type Award,
  type AwardContext,
  type AwardDef,
} from './awards.js'
import type {
  GameRec,
  GameState,
  PlayerRec,
  RoundRec,
  SubmissionRec,
} from './state.js'

function player(id: string, seat: number): PlayerRec {
  return {
    id,
    game: 'g1',
    display_name: id,
    seat_order: seat,
    device_id: '',
    guest: '',
    roster_entry: '',
    joined_round: 1,
  }
}

function round(id: string, number: number, status: RoundRec['status']): RoundRec {
  return { id, game: 'g1', round_number: number, status }
}

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
    status,
    submitted_by: playerId,
    client_uuid: `${roundId}:${playerId}`,
    created: '2026-08-01 00:00:00.000Z',
  }
}

/** Total score across the scope, or null when they scored nothing at all. */
const biggest: AwardDef = {
  key: 'biggest',
  title: 'Biggest',
  pick: 'highest',
  measure: (ctx, id) => {
    const mine = submissionsByPlayer(ctx).get(id) ?? []
    const total = mine.reduce((n, s) => n + s.computed_score, 0)
    return total > 0 ? total : null
  },
  blurb: (w) => w.map((x) => `${x.player.display_name} ${x.value}`).join(', '),
}

const smallest: AwardDef = { ...biggest, key: 'smallest', title: 'Smallest', pick: 'lowest' }

/** Everyone who never scored above 5 — true or it isn't, so no ranking. */
const steady: AwardDef = {
  key: 'steady',
  title: 'Steady',
  pick: 'all',
  measure: (ctx, id) => {
    const mine = submissionsByPlayer(ctx).get(id) ?? []
    if (mine.length === 0) return null
    const worst = Math.max(...mine.map((s) => s.computed_score))
    return worst <= 5 ? worst : null
  },
  blurb: (w) => w.map((x) => x.player.display_name).join(' and '),
}

const players = [player('a', 0), player('b', 1), player('c', 2)]
const rounds = [round('r1', 1, 'closed'), round('r2', 2, 'closed')]

function ctx(submissions: SubmissionRec[]): AwardContext {
  return { players, rounds, submissions }
}

/** Fetch by key rather than position, and fail loudly if it wasn't awarded. */
function won(list: Award[], key: string): Award {
  const found = list.find((a) => a.key === key)
  if (!found) throw new Error(`expected an award for "${key}", got: ${list.map((a) => a.key)}`)
  return found
}

const ids = (a: Award) => a.winners.map((w) => w.player.id)

describe('runAwards', () => {
  it('picks the highest and the lowest', () => {
    const run = runAwards([biggest, smallest], ctx([sub('r1', 'a', 3), sub('r1', 'b', 12), sub('r1', 'c', 7)]))

    expect(ids(won(run, 'biggest'))).toEqual(['b'])
    expect(won(run, 'biggest').winners.map((w) => w.value)).toEqual([12])
    expect(ids(won(run, 'smallest'))).toEqual(['a'])
  })

  it('shares a tie rather than inventing a winner, in seat order', () => {
    const run = runAwards([biggest], ctx([sub('r1', 'a', 9), sub('r1', 'b', 4), sub('r1', 'c', 9)]))

    expect(ids(won(run, 'biggest'))).toEqual(['a', 'c'])
    expect(won(run, 'biggest').blurb).toBe('a 9, c 9')
  })

  it('drops an award nobody is eligible for instead of handing it to nobody', () => {
    // Everybody scored zero, so "biggest" has no honest winner.
    const c = ctx([sub('r1', 'a', 0), sub('r1', 'b', 0), sub('r1', 'c', 0)])
    expect(runAwards([biggest, smallest], c)).toEqual([])
  })

  it('gives a threshold award to everyone who qualifies, unranked', () => {
    const run = runAwards([steady], ctx([sub('r1', 'a', 2), sub('r1', 'b', 40), sub('r1', 'c', 5)]))

    expect(ids(won(run, 'steady'))).toEqual(['a', 'c'])
    expect(won(run, 'steady').blurb).toBe('a and c')
  })

  it('honors `when` and keeps the definition order', () => {
    const c = ctx([sub('r1', 'a', 3), sub('r1', 'b', 12)])
    const never = { ...biggest, key: 'never', when: () => false }

    expect(runAwards([never, smallest, biggest], c).map((a) => a.key)).toEqual([
      'smallest',
      'biggest',
    ])
  })

  it('ignores a player with no submissions at all', () => {
    // c never handed anything in — not a zero, an absence.
    const run = runAwards([biggest, smallest], ctx([sub('r1', 'a', 3), sub('r1', 'b', 12)]))

    expect(ids(won(run, 'smallest'))).toEqual(['a'])
  })
})

describe('scoping', () => {
  it('never lets a draft become a performance', () => {
    const c = ctx([sub('r1', 'a', 3), sub('r1', 'b', 99, 'draft')])
    const run = runAwards([biggest], c)

    expect(ids(won(run, 'biggest'))).toEqual(['a'])
    expect(submissionsByPlayer(c).get('b')).toEqual([])
  })

  it('closedSubmissions keeps only banked rounds', () => {
    const all = [sub('r1', 'a', 3), sub('r2', 'a', 5), sub('r3', 'a', 100)]
    const withOpen = [...rounds, round('r3', 3, 'open')]

    expect(closedSubmissions(withOpen, all).map((s) => s.round)).toEqual(['r1', 'r2'])
  })

  it('closedSubmissions drops drafts inside a closed round', () => {
    const all = [sub('r1', 'a', 3), sub('r1', 'b', 4, 'draft')]
    expect(closedSubmissions(rounds, all).map((s) => s.player)).toEqual(['a'])
  })
})

/**
 * The two scopes.
 *
 * The engine was already scope-agnostic — these build the two scopes every game
 * actually wants, so a per-round callout and an end-of-game award are the same
 * machinery pointed at different submissions rather than two hand-written
 * systems per app.
 */
describe('scopes', () => {
  function gs(
    rounds: RoundRec[],
    submissions: SubmissionRec[],
    players: PlayerRec[] = [player('ann', 1), player('bo', 2)],
  ): GameState<GameRec, SubmissionRec> {
    return {
      game: { id: 'g1', join_token: 't', status: 'active', host_user: 'h', created: '' },
      players,
      rounds,
      submissions,
      current: rounds.find((r) => r.status !== 'closed') ?? null,
    }
  }

  const r1 = round('r1', 1, 'closed')
  const r2 = round('r2', 2, 'review')

  it('scopes a callout to one round, ignoring every other round', () => {
    const s = gs([r1, r2], [sub('r1', 'ann', 9), sub('r2', 'ann', 4), sub('r2', 'bo', 7)])
    const ctx = roundScope(s, r2)
    expect(ctx.rounds).toEqual([r2])
    expect(ctx.submissions.map((x) => [x.player, x.computed_score])).toEqual([
      ['ann', 4],
      ['bo', 7],
    ])
  })

  it('fires a callout on a round still in review, because that is when the reveal plays', () => {
    // Waiting for `closed` would mean the callout never appears — the reveal
    // runs while the round is still correctable.
    const s = gs([r2], [sub('r2', 'ann', 4)])
    expect(roundScope(s, r2).submissions).toHaveLength(1)
  })

  it('leaves a half-counted pile out of a callout', () => {
    const s = gs([r2], [sub('r2', 'ann', 4, 'draft'), sub('r2', 'bo', 7, 'final')])
    expect(roundScope(s, r2).submissions.map((x) => x.player)).toEqual(['bo'])
  })

  it('drops a seat that had not sat down yet', () => {
    const late: PlayerRec = { ...player('cy', 3), joined_round: 2 }
    const s = gs([r1], [sub('r1', 'ann', 9)], [player('ann', 1), late])
    expect(roundScope(s, r1).players.map((p) => p.id)).toEqual(['ann'])
    expect(roundScope(s, round('r2', 2, 'open')).players.map((p) => p.id)).toEqual([
      'ann',
      'cy',
    ])
  })

  it('gives end-of-game awards only what the table has banked', () => {
    const s = gs([r1, r2], [sub('r1', 'ann', 9), sub('r2', 'ann', 4)])
    const ctx = gameScope(s)
    expect(ctx.rounds).toEqual([r1, r2])
    expect(ctx.submissions.map((x) => x.computed_score)).toEqual([9])
  })

  it('keeps every seat in the game scope, latecomers included', () => {
    const late: PlayerRec = { ...player('cy', 3), joined_round: 2 }
    const s = gs([r1], [sub('r1', 'ann', 9)], [player('ann', 1), late])
    expect(gameScope(s).players.map((p) => p.id)).toEqual(['ann', 'cy'])
  })
})
