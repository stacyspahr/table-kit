/**
 * Game state — the pure half. No network, no PocketBase, fully testable.
 *
 * Extracted from Flip 7's `game.ts`, with its three Flip-7-specific assumptions
 * pulled out into configuration:
 *
 *  1. Collection names were hardcoded (`f7_games`, …) — now supplied by config.
 *  2. Totals hardcoded Flip 7's aimed-Flip-7 rule, where one row scores against
 *     TWO players. That is now a pluggable `Tally`; the kit's default just sums
 *     `computed_score`, and Flip 7 brings its own when it migrates.
 *  3. Winner selection assumed highest-wins. Beat the Heat is lowest-wins, so
 *     that is now `config.winner`.
 *
 * Note (3) is deliberately SEPARATE from the end trigger. In both games scores
 * climb and crossing the threshold ends the game — only the winner differs.
 * Conflating them is the bug waiting to happen when a low-wins game inherits a
 * high-wins hook.
 */

import type { Winner } from './config.js'

export interface GameRec {
  id: string
  join_token: string
  status: 'lobby' | 'active' | 'finished'
  host_user: string
  created: string
}

export interface PlayerRec {
  id: string
  game: string
  display_name: string
  seat_order: number
  /** Empty marks the seat unclaimed — a player with no phone. */
  device_id: string
  roster_entry: string
  /** Latecomers do not owe hands for rounds that ran before they sat down. */
  joined_round: number
}

export interface RoundRec {
  id: string
  game: string
  round_number: number
  status: 'open' | 'review' | 'closed'
}

export interface SubmissionRec {
  id: string
  round: string
  player: string
  computed_score: number
  /**
   * `draft` is an autosave of a pile somebody is still counting — a safety net,
   * not an answer. Absent means final, so a game with no drafts (Flip 7) needs
   * no changes.
   */
  status?: 'draft' | 'final'
  /** Who physically entered it. Differs from `player` on a proxied seat. */
  submitted_by: string
  client_uuid: string
  created: string
}

export interface GameState<
  G extends GameRec = GameRec,
  S extends SubmissionRec = SubmissionRec,
> {
  game: G
  players: PlayerRec[]
  rounds: RoundRec[]
  submissions: S[]
  current: RoundRec | null
}

/**
 * How a set of submissions becomes a score per player.
 *
 * A game supplies its own when a single submission can score against more than
 * one player. Flip 7 needs this; Beat the Heat does not.
 */
export type Tally<S extends SubmissionRec = SubmissionRec> = (
  players: PlayerRec[],
  submissions: S[],
) => Map<string, number>

/**
 * The default: each submission scores against its own player.
 *
 * Guarded against a seat removed after the fact, so a deleted player cannot
 * reappear as a phantom row on the leaderboard.
 */
export function sumScores<S extends SubmissionRec>(
  players: PlayerRec[],
  submissions: S[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of players) out.set(p.id, 0)
  for (const s of submissions) {
    if (out.has(s.player)) {
      out.set(s.player, (out.get(s.player) ?? 0) + (s.computed_score ?? 0))
    }
  }
  return out
}

/** Everything that counts as an answer — drafts are half-counted piles. */
const scored = <S extends SubmissionRec>(subs: S[]): S[] =>
  subs.filter((s) => s.status !== 'draft')

/** Running total per player id, including any round still open. */
export function totals<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  tally: Tally<S> = sumScores,
): Map<string, number> {
  return tally(state.players, scored(state.submissions))
}

/**
 * Totals from CLOSED rounds only — what the table has actually banked.
 *
 * While a round is open this is what the leaderboard shows, so a score doesn't
 * quietly slide up the board the instant someone taps submit. Scores reveal
 * together when the last one lands, which is what makes the board rearranging
 * mean something.
 */
export function committedTotals<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  tally: Tally<S> = sumScores,
): Map<string, number> {
  const closed = new Set(state.rounds.filter((r) => r.status === 'closed').map((r) => r.id))
  return tally(
    state.players,
    scored(state.submissions).filter((s) => closed.has(s.round)),
  )
}

/**
 * Player ids who have already handed in a score for the current round.
 *
 * ⚠️ Drafts do NOT count, and the distinction is load-bearing. A draft means
 * somebody picked up their pile and started tapping — the opposite of done.
 * Counting one here drops them out of `waitingOn`, so the table is told nobody
 * is outstanding while the round sits open forever, with no name on screen to
 * explain why. The server-side round hook applies the same rule; if these two
 * disagree the game stalls.
 */
export function submittedThisRound<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
): Set<string> {
  const current = state.current
  if (!current) return new Set()
  return new Set(
    state.submissions
      .filter((s) => s.round === current.id && s.status !== 'draft')
      .map((s) => s.player),
  )
}

/**
 * Who still owes a score this round — the list that creates social pressure.
 *
 * Unclaimed seats are counted like any other, which is what stops a phoneless
 * player being quietly forgotten.
 */
export function waitingOn<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
): PlayerRec[] {
  const current = state.current
  if (!current) return []
  const done = submittedThisRound(state)
  return state.players.filter(
    (p) => !done.has(p.id) && p.joined_round <= current.round_number,
  )
}

export function submissionFor<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  roundId: string,
  playerId: string,
): S | undefined {
  return state.submissions.find((s) => s.round === roundId && s.player === playerId)
}

export interface Standing {
  player: PlayerRec
  score: number
  /** 1-based, sharing a place on a tie. */
  place: number
}

/**
 * The leaderboard, best first.
 *
 * `winner` decides which end is best. Ties share a place, and seat order breaks
 * the display order so the board doesn't shuffle at random between polls.
 */
export function standings<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  winner: Winner,
  tally: Tally<S> = sumScores,
): Standing[] {
  const table = committedTotals(state, tally)
  const rows = state.players
    .map((player) => ({ player, score: table.get(player.id) ?? 0 }))
    .sort((a, b) =>
      a.score === b.score
        ? a.player.seat_order - b.player.seat_order
        : winner === 'highest'
          ? b.score - a.score
          : a.score - b.score,
    )

  let place = 0
  let lastScore: number | null = null
  return rows.map((row, i) => {
    if (lastScore === null || row.score !== lastScore) place = i + 1
    lastScore = row.score
    return { ...row, place }
  })
}

/**
 * Has anyone crossed the finish line?
 *
 * Scores climb in every game in the suite, so the trigger is always "someone
 * reached the goal" regardless of who ends up winning.
 */
export function goalReached<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  goal: number,
  tally: Tally<S> = sumScores,
): boolean {
  const table = totals(state, tally)
  return [...table.values()].some((v) => v >= goal)
}

/**
 * Who is level at the front, with the game still running.
 *
 * Derived from state rather than returned by whoever closed the round, so EVERY
 * device shows the tie — not just the phone that happened to tap the button.
 */
export function tieAtFront<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  winner: Winner,
  goal: number,
  tally: Tally<S> = sumScores,
): PlayerRec[] {
  if (state.game.status !== 'active' || state.players.length < 2) return []
  if (!goalReached(state, goal, tally)) return []

  const table = totals(state, tally)
  const scores = state.players.map((p) => table.get(p.id) ?? 0)
  const best = winner === 'highest' ? Math.max(...scores) : Math.min(...scores)
  const atFront = state.players.filter((p) => (table.get(p.id) ?? 0) === best)
  return atFront.length > 1 ? atFront : []
}
