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
  /**
   * The throwaway guest credential holding this seat, when one does.
   *
   * Both games have had this column since their players collection was
   * created; the kit simply never modelled it, because Beat the Heat's client
   * never reads it. Flip 7's does — it is how a returning phone finds which
   * seat is already its own, alongside `device_id`.
   */
  guest: string
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
 * How a game knows it is over.
 *
 * Two shapes, and they answer different questions. `points` asks "has anyone
 * got there yet" — the answer depends on how people are playing. `rounds` asks
 * "have we played them all" — the answer depends only on the calendar, and is
 * knowable in advance. That second property is the whole reason this type
 * exists: a fixed-length game can say "this is the last one" before it is
 * played, and a points game never can.
 */
export type EndCondition =
  | { type: 'points'; value: number }
  | { type: 'rounds'; value: number }

/**
 * A bare number reads as points.
 *
 * Every call site written before rounds existed passes one, so widening rather
 * than replacing keeps this a minor bump — no app has to change to take it.
 */
export type EndSpec = number | EndCondition

export const asEndCondition = (end: EndSpec): EndCondition =>
  typeof end === 'number' ? { type: 'points', value: end } : end

/** Rounds the table has banked. A round still open is not played yet. */
export function roundsPlayed<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
): number {
  return state.rounds.filter((r) => r.status === 'closed').length
}

/**
 * Rounds still to play, counting one in progress. Null when there is no
 * fixed number — a points game has no answer to give, and zero would be a lie.
 */
export function roundsLeft<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  end: EndSpec,
): number | null {
  const cond = asEndCondition(end)
  if (cond.type !== 'rounds') return null
  return Math.max(0, cond.value - roundsPlayed(state))
}

/**
 * Is the round now open the last one?
 *
 * False for a points game, always — not because it might not be, but because
 * nobody can know. This is what lets a fixed-length game rename its commit
 * button for the final round ("sign your card") while a points game leaves it
 * alone.
 */
export function isFinalRound<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  end: EndSpec,
): boolean {
  const cond = asEndCondition(end)
  if (cond.type !== 'rounds' || !state.current) return false
  return state.current.round_number >= cond.value
}

/**
 * Has the game reached its end?
 *
 * For points: scores climb in every game in the suite, so the trigger is
 * always "someone reached the goal" regardless of who ends up winning.
 * For rounds: every round has been banked.
 */
export function endReached<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  end: EndSpec,
  tally: Tally<S> = sumScores,
): boolean {
  const cond = asEndCondition(end)
  if (cond.type === 'rounds') return roundsPlayed(state) >= cond.value
  const table = totals(state, tally)
  return [...table.values()].some((v) => v >= cond.value)
}

/**
 * @deprecated Prefer {@link endReached}, which says what it means for a game
 * that ends on a round count rather than a score. Kept because both live apps
 * call it; identical behaviour.
 */
export const goalReached = endReached

/**
 * Who is level at the front, with the game still running.
 *
 * Derived from state rather than returned by whoever closed the round, so EVERY
 * device shows the tie — not just the phone that happened to tap the button.
 */
export function tieAtFront<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  winner: Winner,
  end: EndSpec,
  tally: Tally<S> = sumScores,
): PlayerRec[] {
  if (state.game.status !== 'active' || state.players.length < 2) return []
  if (!endReached(state, end, tally)) return []

  const table = totals(state, tally)
  const scores = state.players.map((p) => table.get(p.id) ?? 0)
  const best = winner === 'highest' ? Math.max(...scores) : Math.min(...scores)
  const atFront = state.players.filter((p) => (table.get(p.id) ?? 0) === best)
  return atFront.length > 1 ? atFront : []
}
