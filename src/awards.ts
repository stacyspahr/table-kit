/**
 * The awards engine — the part of "capture the fun" that isn't about any
 * particular game.
 *
 * A game supplies DEFINITIONS: what to measure per player, and which end of
 * that measurement is worth a name. The kit supplies the running of them —
 * eligibility, ranking, ties, and dropping the ones nobody qualified for. The
 * kit never learns what is being measured, which is what lets Beat the Heat
 * count peppers and Flip 7 count whatever Flip 7 counts through the same code.
 *
 * ── Why `measure` returns `number | null` ────────────────────────────────
 * Null means NOT ELIGIBLE, and it is a different thing from zero. "Took the
 * most cards" with nobody having taken a card should produce no award at all,
 * not a three-way tie on nothing. Every award that would be silly to hand out
 * in its degenerate case says so by returning null there, and the engine drops
 * empty awards on the floor.
 *
 * ── Why ties always share ────────────────────────────────────────────────
 * There is no tiebreak option. At a table an award is a thing you say out loud,
 * and "Nana and Grandpa both got scorched" is a fine sentence — inventing a
 * winner between two identical performances is not. Games that genuinely need
 * one can encode it in the measure.
 */

import type { GameRec, GameState, PlayerRec, RoundRec, SubmissionRec } from './state.js'

/**
 * What an award gets to look at.
 *
 * Already SCOPED by the caller: pass one round's submissions for a per-round
 * callout, a whole game's for an end-of-game award. Definitions never filter by
 * round themselves, so the same definition can be run over either.
 */
export interface AwardContext<S extends SubmissionRec = SubmissionRec> {
  players: PlayerRec[]
  rounds: RoundRec[]
  submissions: S[]
}

/**
 * `highest` / `lowest` — a ranked award, best value wins.
 * `all` — a threshold award: everyone eligible wins it, no ranking.
 *
 * The third is not a convenience. "Never took more than five in a round" is
 * true or it isn't, and ranking the people it's true of would hand it to one
 * of them for no reason.
 */
export type AwardPick = 'highest' | 'lowest' | 'all'

export interface AwardWinner {
  player: PlayerRec
  value: number
}

export interface AwardDef<S extends SubmissionRec = SubmissionRec> {
  key: string
  /** The name said out loud. */
  title: string
  /** Null for a player this award cannot apply to. */
  measure: (ctx: AwardContext<S>, playerId: string) => number | null
  pick: AwardPick
  /** Skip the award entirely — e.g. one that only means something in a points game. */
  when?: (ctx: AwardContext<S>) => boolean
  /** The line under the name. Winners are in the order the engine ranked them. */
  blurb: (winners: AwardWinner[], ctx: AwardContext<S>) => string
}

export interface Award {
  key: string
  title: string
  winners: AwardWinner[]
  blurb: string
}

/**
 * Run a set of definitions over a scoped context.
 *
 * Returns only awards somebody won, in the order the definitions were given —
 * that order is editorial (the funny one goes last) and belongs to the game,
 * not here.
 */
export function runAwards<S extends SubmissionRec>(
  defs: AwardDef<S>[],
  ctx: AwardContext<S>,
): Award[] {
  const out: Award[] = []

  for (const def of defs) {
    if (def.when && !def.when(ctx)) continue

    const eligible: AwardWinner[] = []
    for (const player of ctx.players) {
      const value = def.measure(ctx, player.id)
      if (value === null || !Number.isFinite(value)) continue
      eligible.push({ player, value })
    }
    if (eligible.length === 0) continue

    let winners: AwardWinner[]
    if (def.pick === 'all') {
      // Seat order, so a threshold award reads the same on every phone.
      winners = [...eligible].sort((a, b) => a.player.seat_order - b.player.seat_order)
    } else {
      const best =
        def.pick === 'highest'
          ? Math.max(...eligible.map((e) => e.value))
          : Math.min(...eligible.map((e) => e.value))
      winners = eligible
        .filter((e) => e.value === best)
        .sort((a, b) => a.player.seat_order - b.player.seat_order)
    }

    out.push({ key: def.key, title: def.title, winners, blurb: def.blurb(winners, ctx) })
  }

  return out
}

/**
 * Every player's submissions in one scope, keyed by player id.
 *
 * Drafts are excluded — a half-counted pile is not a performance to give
 * somebody a name for. Every player appears, including those with nothing, so a
 * measure can tell "took nothing" from "wasn't at the table".
 */
export function submissionsByPlayer<S extends SubmissionRec>(
  ctx: AwardContext<S>,
): Map<string, S[]> {
  const out = new Map<string, S[]>()
  for (const p of ctx.players) out.set(p.id, [])
  for (const s of ctx.submissions) {
    if (s.status === 'draft') continue
    out.get(s.player)?.push(s)
  }
  return out
}

/**
 * The submissions belonging to rounds the table has actually banked.
 *
 * End-of-game awards read this rather than everything: a round still open is a
 * round somebody can still change, and an award that moves is worse than no
 * award.
 */
export function closedSubmissions<S extends SubmissionRec>(
  rounds: RoundRec[],
  submissions: S[],
): S[] {
  const closed = new Set(rounds.filter((r) => r.status === 'closed').map((r) => r.id))
  return submissions.filter((s) => closed.has(s.round) && s.status !== 'draft')
}

/**
 * The scope for ONE round — what a per-round callout reads.
 *
 * Deliberately does NOT require the round to be closed. A callout plays during
 * the reveal, and the reveal runs while the round is still in review so it can
 * be corrected; waiting for closed would mean the callout never fires.
 *
 * Seats that joined later are dropped. A latecomer owes nothing for a round
 * that ran before they sat down, and leaving them in means every game has to
 * remember to return null for them in every measure it writes.
 */
export function roundScope<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
  round: RoundRec,
): AwardContext<S> {
  return {
    players: state.players.filter((p) => p.joined_round <= round.round_number),
    rounds: [round],
    submissions: state.submissions.filter(
      (s) => s.round === round.id && s.status !== 'draft',
    ),
  }
}

/**
 * The scope for the whole game — what end-of-game awards read.
 *
 * Banked rounds only, for the reason in {@link closedSubmissions}: an award
 * that moves after it has been announced is worse than no award.
 */
export function gameScope<G extends GameRec, S extends SubmissionRec>(
  state: GameState<G, S>,
): AwardContext<S> {
  return {
    players: state.players,
    rounds: state.rounds,
    submissions: closedSubmissions(state.rounds, state.submissions),
  }
}
