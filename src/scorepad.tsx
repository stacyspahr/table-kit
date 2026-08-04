/**
 * The score pad — every round the table has banked, for anybody who wants to
 * look back at one.
 *
 * ── The question it answers ───────────────────────────────────────────────
 * "Wow, Michelle. What happened on that last round?" That is a question about
 * ONE ROUND, asked out loud, two rounds later. Until this, the only way to
 * answer it was memory: the reveal plays once and is gone, and the board only
 * ever shows totals, so the round somebody wants to relitigate is exactly the
 * information the app threw away.
 *
 * ── Why it is not a grid ──────────────────────────────────────────────────
 * The obvious build is rounds down, players across, a spreadsheet. Play Nine
 * already refused that and its reasoning holds for every game in the suite:
 * nine columns plus names plus totals does not fit a phone without squeezing a
 * name, and the house rule is that a name never gets squeezed. A twelve-round
 * Beat the Heat game is worse.
 *
 * It also answers the wrong question. Nobody scans a grid; they want one round,
 * the one that just went badly, laid out the way the board lays it out. So this
 * pages through rounds one at a time and every screen looks like a board the
 * table has already learned to read.
 *
 * ── CLOSED ROUNDS ONLY, and this one is not negotiable ────────────────────
 * The round in play is not in here, ever. Every game in the suite hides other
 * seats' entries until the round closes, because the scores landing together IS
 * the reveal — a score pad that included the open round would be a hole in that
 * wall reachable from every phone at the table, and it would spend the reveal
 * for nothing. `closedRounds` below is the only place rounds are selected, so
 * there is one line to be careful about rather than several.
 *
 * ── Who sees it ───────────────────────────────────────────────────────────
 * Everybody. It reads state the phone already holds and shows nothing a player
 * did not watch happen, so gating it on being the host would be ceremony. The
 * question it exists for is one a GUEST asks.
 *
 * ── Editing stays where it was ────────────────────────────────────────────
 * Only the most recently closed round can be corrected, and that rule belongs
 * to the app rather than to this file — an edit to round 2 can retroactively
 * change who crossed the line and ended the night. So the pad takes `fixable`
 * as the single round the caller is willing to reopen and marks every other
 * round read-only. Pass nothing and the whole pad is read-only, which is what
 * a finished game wants.
 */

import { useState, type ReactNode } from 'react'
import type { GameRec, GameState, SubmissionRec, Tally } from './state.js'
import { sumScores } from './state.js'
import type { PlayerRec, RoundRec } from './state.js'
import { rowsForRound, type RevealRow } from './reveal.js'
import type { Winner } from './config.js'

/**
 * Banked rounds, newest first.
 *
 * Newest first because the round people ask about is almost always the one that
 * just happened, and a pad that opens on round 1 makes the common case a dozen
 * taps. Round 1 is still there; it is just at the end, where it belongs.
 */
export function closedRounds(rounds: RoundRec[]): RoundRec[] {
  return rounds
    .filter((r) => r.status === 'closed')
    .sort((a, b) => b.round_number - a.round_number)
}

/** `+12`, `-3`, `0`. Games with a better word for zero pass their own. */
export function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}

export function ScorePad<G extends GameRec, S extends SubmissionRec>({
  state,
  winner,
  tally = sumScores,
  roundNoun = 'Round',
  meId,
  fixable,
  onFix,
  onClose,
  formatDelta = signed,
  empty = 'Nothing has been scored yet.',
}: {
  state: GameState<G, S>
  /** Which end of the board is winning — orders each round's rows. */
  winner: Winner
  tally?: Tally<S>
  /** "Round" for most, "Hole" for Play Nine. */
  roundNoun?: string
  /** Marks your own row, exactly as the board does. */
  meId?: string
  /** The one round the caller will let somebody correct, if any. */
  fixable?: RoundRec
  onFix?: (player: PlayerRec, round: RoundRec) => void
  onClose: () => void
  formatDelta?: (delta: number) => string
  empty?: ReactNode
}) {
  const banked = closedRounds(state.rounds)

  // An INDEX into `banked` rather than a round id, so that a round closing
  // while the pad is open does not leave the pad pointing at nothing. Index 0
  // is the newest, which is where it opens.
  const [at, setAt] = useState(0)

  if (banked.length === 0) {
    return (
      <section className="card tk-pad">
        <p className="fine">{empty}</p>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </section>
    )
  }

  const round = banked[Math.min(at, banked.length - 1)]!
  const canFix = Boolean(fixable && onFix && fixable.id === round.id)

  // Ordered as the board orders itself at that moment, so the pad reads like a
  // screen everybody already knows rather than like a report. Ties break on
  // seat order, the same way everywhere in the kit, so nothing jitters.
  const dir = winner === 'highest' ? -1 : 1
  const rows: RevealRow[] = rowsForRound(state, round, tally).sort(
    (a, b) => dir * (a.after - b.after) || a.player.seat_order - b.player.seat_order,
  )

  // "Back" walks toward round 1, which is FORWARD through a newest-first list.
  // The arrows are labeled for the rounds, never for the array.
  const older = at < banked.length - 1
  const newer = at > 0

  return (
    <section className="card tk-pad">
      <header className="tk-pad-head">
        <button
          className="btn ghost tk-pad-step"
          disabled={!older}
          onClick={() => setAt((i) => i + 1)}
          aria-label={`Show the ${roundNoun.toLowerCase()} before this one`}
        >
          ‹
        </button>
        <h2>
          {roundNoun} {round.round_number}
        </h2>
        <button
          className="btn ghost tk-pad-step"
          disabled={!newer}
          onClick={() => setAt((i) => i - 1)}
          aria-label={`Show the ${roundNoun.toLowerCase()} after this one`}
        >
          ›
        </button>
      </header>

      <ul className="list">
        {rows.map((r) => {
          const mine = r.player.id === meId
          /*
           * ⚠️ The running total goes UNDER the name, not beside the delta, and
           * that is a width decision made on a real phone rather than a taste
           * one. Name, delta, total and a tappable chevron is four things on a
           * 375px row, and the first delta that was a WORD rather than a number
           * — "untouched" — pushed the chevron onto a line of its own with
           * nothing beside it. Squeezing the name to fix it is the one move the
           * house rules forbid.
           *
           * Stacked, it also says the right thing. The delta is the answer to
           * the question the pad gets opened for, so it is the big number on
           * the right; the total is context, so it sits quiet under the name
           * exactly where a row note belongs.
           */
          const body = (
            <>
              <span className="row-main">
                {r.player.display_name}
                <span className="row-note tk-pad-total">{r.after} so far</span>
              </span>
              <span className="tk-pad-delta">{formatDelta(r.delta)}</span>
            </>
          )
          return (
            <li key={r.player.id}>
              {canFix ? (
                <button
                  className={`row tappable ${mine ? 'mine' : ''}`}
                  onClick={() => onFix!(r.player, round)}
                >
                  {body}
                </button>
              ) : (
                <div className={`row ${mine ? 'mine' : ''}`}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Two lines, and only ever one of them. The editable round says what a
          tap does; every other round says why there is nothing to tap, because
          a list of rows that look almost tappable and aren't is worse than a
          sentence. */}
      <p className="fine">
        {canFix
          ? 'Found a card after it was scored? Tap a seat to enter that pile again — the board updates for everyone.'
          : `Scored and banked. Only the latest ${roundNoun.toLowerCase()} can still be changed.`}
      </p>

      <button className="btn ghost" onClick={onClose}>
        Close
      </button>
    </section>
  )
}
