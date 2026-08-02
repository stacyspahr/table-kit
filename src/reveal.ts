/**
 * The reveal's arithmetic, kept apart from its animation.
 *
 * Everything here is a pure function of a round's numbers, which is the only
 * way any of it gets tested — the animation itself is timers and rAF, and a
 * card table is the only honest place to judge whether that feels right.
 *
 * ── What is in here, and what is deliberately not ─────────────────────────
 * IN: which rows exist, what each one moved by, and where each row travels
 * from and to when the board re-sorts. All of that is identical for any game
 * with a leaderboard.
 *
 * OUT: everything about how a row LOOKS. Beat the Heat draws a heat-ramped bar
 * measured against a points goal; Flip 7 draws a gradient bar against a target;
 * Play Nine draws a column of a paper scorecard with no bar at all. Those are
 * three answers to a question the kit should not be asking, so `barScale`,
 * `bandFor` and the rest stay in the games that want them.
 *
 * Both existing apps had their own copy of `revealLayout`, character-identical
 * apart from the sort direction and the row height. Those are the two
 * parameters below, and that is the whole of the difference.
 */

import type { Winner } from './config.js'
import type { GameRec, GameState, PlayerRec, SubmissionRec, Tally } from './state.js'
import { sumScores } from './state.js'
import type { RoundRec } from './state.js'

export interface RevealRow {
  player: PlayerRec
  /** Total before this round was banked. */
  before: number
  /** What this round moved them by. Negative is possible — see Play Nine. */
  delta: number
  after: number
}

/**
 * Running totals as of the end of round `n`, counting closed rounds only.
 *
 * `committedTotals` answers "where does the board stand now"; this answers
 * "where did it stand then", which is what a reveal needs in order to show a
 * row moving from somewhere to somewhere else.
 */
export function totalsAsOf<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  roundNumber: number,
  tally: Tally<S> = sumScores,
): Map<string, number> {
  const upto = new Set(
    state.rounds
      .filter((r) => r.round_number <= roundNumber && r.status === 'closed')
      .map((r) => r.id),
  )
  return tally(
    state.players,
    state.submissions.filter((s) => upto.has(s.round) && s.status !== 'draft'),
  )
}

/**
 * Everything the reveal needs about one round, from state and nothing else.
 *
 * Seats that had not sat down yet are left out — a latecomer has no `before`
 * to travel from, and rendering them at zero would show a row sliding in from
 * a position they never held.
 *
 * ⚠️ Reads the round it is given even if that round is only in `review`. The
 * reveal plays before the round closes, so requiring `closed` here would mean
 * every row's `after` equalled its `before` and nothing ever moved. What must
 * be closed is every round BEFORE it, which `totalsAsOf` enforces.
 */
export function rowsForRound<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  round: RoundRec,
  tally: Tally<S> = sumScores,
): RevealRow[] {
  const before = totalsAsOf(state, round.round_number - 1, tally)

  // This round's own movement, taken from its submissions directly rather than
  // from `totalsAsOf(n)`, precisely because the round may not be closed yet.
  const thisRound = tally(
    state.players,
    state.submissions.filter((s) => s.round === round.id && s.status !== 'draft'),
  )

  return state.players
    .filter((p) => p.joined_round <= round.round_number)
    .map((p) => {
      const b = before.get(p.id) ?? 0
      const delta = thisRound.get(p.id) ?? 0
      return { player: p, before: b, delta, after: b + delta }
    })
}

export interface RevealLayout {
  /** Rows in their FINAL order — render in this order, always. */
  ordered: RevealRow[]
  /** Player id → the y offset, in px, to start that row pushed back to. */
  offsets: Map<string, number>
}

/**
 * Where each row starts and where it ends up.
 *
 * The list is always rendered in its FINAL order; every row is then pushed back
 * to its old slot with a transform, and RELEASING those transforms is the
 * re-sort. Doing it this way means no measuring the DOM and no reordering
 * mid-animation — the only cost is that rows must be a known fixed height,
 * which is why `rowHeight` is required rather than guessed.
 *
 * Ties break on seat order in BOTH orderings, so a row never jitters between
 * two equal positions.
 */
export function revealLayout(
  rows: RevealRow[],
  opts: { winner: Winner; rowHeight: number; gap?: number },
): RevealLayout {
  const gap = opts.gap ?? 8
  const dir = opts.winner === 'highest' ? -1 : 1
  const by = (key: 'before' | 'after') => (a: RevealRow, b: RevealRow) =>
    dir * (a[key] - b[key]) || a.player.seat_order - b.player.seat_order

  const byBefore = [...rows].sort(by('before'))
  const byAfter = [...rows].sort(by('after'))
  const startIndex = new Map(byBefore.map((r, i) => [r.player.id, i]))

  return {
    ordered: byAfter,
    offsets: new Map(
      byAfter.map((r, finalIdx) => [
        r.player.id,
        ((startIndex.get(r.player.id) ?? finalIdx) - finalIdx) * (opts.rowHeight + gap),
      ]),
    ),
  }
}
