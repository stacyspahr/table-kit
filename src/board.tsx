/**
 * The table, mid-game, for somebody who is not entering a card.
 *
 * ── The problem this exists for ──────────────────────────────────────────
 * Nothing in the kit ever required the host to play — `lobbyState` counts
 * seats and not hosts, the round-close button is on every phone, and the
 * server flips a round to review on its own the moment every owing seat is
 * final. The resilience contract says it outright: nothing requires the host
 * mid-game.
 *
 * But every screen that SHOWED the game needed a seat. A host who sat one out
 * got a list of names and a join code, and no way to see the score — so
 * "sitting this one out" meant "watching nothing," and the sensible thing at a
 * family table (keep score for four people, don't take a hand) was the one
 * arrangement the apps could not do.
 *
 * This is the read of the table that needs no seat.
 *
 * ── Why the numbers are not the kit's ────────────────────────────────────
 * `format` exists because a total means something different in every game:
 * `+4` in Play Nine, a plain count in Flip 7, a pepper tally in Beat the Heat.
 * The kit orders the board and marks who is still owing — both facts about a
 * game night — and the game says what a number looks like. Take that away and
 * this component would have to learn what strokes are.
 */

import type { ReactNode } from 'react'
import { lastHandover, owesIn, type Standing } from './state.js'
import type { PlayerRec } from './state.js'

export function TableBoard({
  standings,
  done,
  format,
  emptyNote,
  round,
  sittingOutLabel = 'sitting out',
  onPick,
}: {
  /** From `standings` — already in board order, ties sharing a place. */
  standings: Standing[]
  /**
   * Who has handed this round in. Everyone else gets the open mark.
   *
   * ⚠️ Build this from FINAL submissions only. A draft is not an answer, and a
   * board that ticks a seat off on an autosave tells the table it is waiting
   * for nobody while somebody is still holding a card.
   */
  done: Set<string>
  /** The game's own rendering of a total. */
  format: (score: number) => ReactNode
  /** Shown instead of the board before anybody has a total. */
  emptyNote?: ReactNode
  /**
   * The round in play. Supply it and seats that are sitting out are marked.
   *
   * ⚠️ The mark matters more than it looks. Without it a row with no tick reads
   * as "still to hand in", so a table waits on somebody who went to bed — which
   * is the exact confusion sitting out exists to end.
   */
  round?: number
  /** What this game calls it. "sitting out", "out this hand". */
  sittingOutLabel?: string
  /**
   * Makes the rows tappable. Omit and the board is a board.
   *
   * ⚠️ Only ever pass this from an explicit MODE the reader turned on. A tap on
   * a name already means "that's me" on the claim screen and "enter for them"
   * on the play screens; a third meaning on a board somebody is only reading
   * is a mis-tap waiting to happen, and this one lands on a seat's standing in
   * the game.
   */
  onPick?: (player: PlayerRec) => void
}) {
  if (standings.length === 0) {
    return emptyNote ? <p className="fine">{emptyNote}</p> : null
  }

  return (
    <ul className="list tk-board">
      {standings.map((row) => (
        <li key={row.player.id}>
          {(() => {
            const Row = onPick ? 'button' : 'span'
            return (
          <Row
            className="row"
            {...(onPick
              ? {
                  onClick: () => onPick(row.player),
                  'aria-label': `Change ${row.player.display_name}'s seat`,
                }
              : {})}
          >
            {/* The same two marks the play screens use. Not a spinner and not
                a colour: this gets read across a table by somebody who is not
                holding the phone. */}
            <span className="tk-board-tick" aria-hidden="true">
              {/* A seat that owes nothing gets neither mark. An empty circle
                  beside somebody who has gone to bed reads as "still to hand
                  in", which is the confusion this whole flag exists to end. */}
              {round !== undefined && !owesIn(row.player, round)
                ? ''
                : done.has(row.player.id)
                  ? '✓'
                  : '○'}
            </span>
            <span className="row-main">
              {row.player.display_name}
              {round !== undefined && !owesIn(row.player, round) && (
                <span className="pill">{sittingOutLabel}</span>
              )}
            </span>
            <span className="row-note">{format(row.score)}</span>
          </Row>
            )
          })()}
        </li>
      ))}
    </ul>
  )
}

/**
 * The seats still owing a card this round, by name.
 *
 * Separate from the board because it answers a different question — the board
 * says where everyone stands, this says who the table is waiting on — and
 * because it is the sentence a host reads out loud.
 */
export function WaitingOn({
  players,
  none,
}: {
  players: PlayerRec[]
  /** What to say when nobody is owing. Omit to render nothing. */
  none?: ReactNode
}) {
  if (players.length === 0) return none ? <p className="fine center-text">{none}</p> : null
  return (
    <p className="fine center-text">
      Waiting on {players.map((p) => p.display_name).join(', ')}.
    </p>
  )
}

/**
 * Who took a seat over from whom, and when.
 *
 * ── Why this has to be shown at all ──────────────────────────────────────
 * When a seat changes hands it takes the new occupant's name, because the
 * board's job is to say who is holding the cards right now. That is the right
 * call and it is also, on its own, a quiet rewrite: the earlier rounds end up
 * filed under a name that did not play them, and the share card credits the
 * wrong person just as surely as leaving the old name would have.
 *
 * Renaming without saying so does not fix the problem, it moves it. This is the
 * half that makes it honest, and it belongs on a screen with room for a
 * sentence — the end of the game — rather than squeezed into a name column on
 * every phone for the rest of the night.
 *
 * Renders nothing at all on the ordinary night where nobody swapped, which is
 * almost all of them.
 */
export function Handovers({
  players,
  unit,
  heading = 'Seats that changed hands',
}: {
  players: PlayerRec[]
  /**
   * What this game calls a round, singular. `hole` in Play Nine, `round` in
   * the other two. The kit knows the fact and never the word.
   */
  unit: string
  heading?: ReactNode
}) {
  const swapped = players
    .map((p) => ({ p, h: lastHandover(p) }))
    .filter((x): x is { p: PlayerRec; h: NonNullable<ReturnType<typeof lastHandover>> } => !!x.h)

  if (swapped.length === 0) return null

  return (
    <section className="card">
      <h2>{heading}</h2>
      <ul className="list tk-handovers">
        {swapped.map(({ p, h }) => (
          <li key={p.id}>
            <span className="fine">
              {p.display_name} took over from {h.from} on {unit} {h.round}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
