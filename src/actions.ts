/**
 * Game state — the async half. Everything that touches the network.
 *
 * The split from `state.ts` is deliberate: all the logic worth testing lives
 * over there, pure, and this file is thin enough to read in one sitting.
 */

import type PocketBase from 'pocketbase'
import type { TableKitConfig } from './config.js'
import type { Queue } from './queue.js'
import type { GameRec, GameState, PlayerRec, RoundRec, SubmissionRec } from './state.js'

export interface Actions<G extends GameRec, S extends SubmissionRec> {
  loadState(gameId: string): Promise<GameState<G, S>>
  submit(opts: { round: RoundRec; player: PlayerRec; submittedBy: PlayerRec; payload: Record<string, unknown>; score: number }): string
  closeRound(state: GameState<G, S>): Promise<void>
  openNextRound(state: GameState<G, S>): Promise<void>
  rematch(game: G, players: PlayerRec[], freshToken: string, carry: Record<string, unknown>): Promise<G>
}

export function createActions<G extends GameRec = GameRec, S extends SubmissionRec = SubmissionRec>(deps: {
  pb: PocketBase
  config: TableKitConfig
  queue: Queue
}): Actions<G, S> {
  const { pb, config, queue } = deps
  const c = config.collections

  async function loadState(gameId: string): Promise<GameState<G, S>> {
    const [game, players, rounds] = await Promise.all([
      pb.collection(c.games).getOne<G>(gameId),
      pb.collection(c.players).getFullList<PlayerRec>({
        filter: `game="${gameId}"`,
        sort: 'seat_order',
      }),
      pb.collection(c.rounds).getFullList<RoundRec>({
        filter: `game="${gameId}"`,
        sort: 'round_number',
      }),
    ])

    const roundIds = rounds.map((r) => `round="${r.id}"`).join(' || ')
    const submissions = roundIds
      ? await pb.collection(c.submissions).getFullList<S>({ filter: roundIds })
      : []

    const current = rounds.find((r) => r.status !== 'closed') ?? null
    return { game, players, rounds, submissions, current }
  }

  /**
   * Hand in a score.
   *
   * Goes through the queue, so this does NOT await the network and cannot fail
   * from a dropout — it returns the idempotency key immediately. The caller is
   * expected to merge `queue.pendingIn()` into local state so the player sees
   * their entry land and `waitingOn` stops listing them.
   *
   * The score is computed by the game and passed in; the kit never scores.
   */
  function submit(opts: {
    round: RoundRec
    player: PlayerRec
    submittedBy: PlayerRec
    payload: Record<string, unknown>
    score: number
  }): string {
    const proxied = opts.submittedBy.id !== opts.player.id
    return queue.enqueue(c.submissions, {
      round: opts.round.id,
      player: opts.player.id,
      submitted_by: opts.submittedBy.id,
      computed_score: opts.score,
      ...opts.payload,
      ...(proxied ? { proxy_reason: 'declared' } : {}),
    })
  }

  /**
   * Close the round. That is ALL the client does.
   *
   * Whether the game is over, and opening the next round, are decided by a
   * server-side hook. Players are anonymous guests who cannot write to the
   * games collection, so a client that closed the winning round could not mark
   * the game finished. Doing it server-side also makes it race-proof: two
   * people tapping at once can't both open round N+1.
   *
   * Not queued, on purpose — see the note at the top of `queue.ts`.
   */
  async function closeRound(state: GameState<G, S>): Promise<void> {
    const round = state.current
    if (!round) return
    await pb.collection(c.rounds).update(round.id, { status: 'closed' })
  }

  /**
   * Recovery: the game is running but nothing is open to play into.
   *
   * Shouldn't happen while the hook owns round creation, but a game stranded
   * this way has no other route back, and a dead end mid-evening is far worse
   * than a spare button.
   */
  async function openNextRound(state: GameState<G, S>): Promise<void> {
    const highest = state.rounds.reduce((m, r) => Math.max(m, r.round_number), 0)
    await pb.collection(c.rounds).create({
      game: state.game.id,
      round_number: highest + 1,
      status: 'open',
    })
  }

  /**
   * Another game with the same people, without anyone re-scanning.
   *
   * The new game INHERITS the finished game's join token, so every phone still
   * holding `/?j=<token>` is holding a valid link again — their tabs pick it up
   * on the next poll and they're dealt straight in. The old game takes a fresh
   * random token, which also invalidates it, so a screenshot of the original QR
   * can't reopen a finished night.
   *
   * Order matters: the unique index on join_token means the old game has to let
   * go of it before the new one can take it.
   *
   * `carry` is whatever game-specific settings should come across — Flip 7's
   * mode and target, Beat the Heat's goal type and value.
   */
  async function rematch(
    game: G,
    players: PlayerRec[],
    freshToken: string,
    carry: Record<string, unknown>,
  ): Promise<G> {
    const token = game.join_token

    await pb.collection(c.games).update(game.id, { join_token: freshToken })

    let next: G
    try {
      next = await pb.collection(c.games).create<G>({
        join_token: token,
        host_user: game.host_user,
        // Straight into play — the table is already sitting there.
        status: 'active',
        ...carry,
      })
    } catch (e) {
      // Put the token back rather than leaving the old game unreachable.
      await pb.collection(c.games).update(game.id, { join_token: token }).catch(() => {})
      throw e
    }

    await pb.collection(c.rounds).create({
      game: next.id,
      round_number: 1,
      status: 'open',
    })

    for (const p of players) {
      await pb.collection(c.players).create({
        game: next.id,
        display_name: p.display_name,
        seat_order: p.seat_order,
        device_id: p.device_id,
        roster_entry: p.roster_entry || undefined,
        joined_round: 1,
      })
    }

    return next
  }

  return { loadState, submit, closeRound, openNextRound, rematch }
}
