/**
 * Game state — the async half. Everything that touches the network.
 *
 * The split from `state.ts` is deliberate: all the logic worth testing lives
 * over there, pure, and this file is thin enough to read in one sitting.
 */

import type PocketBase from 'pocketbase'
import type { TableKitConfig } from './config.js'
import type { Queue } from './queue.js'
import type {
  GameRec,
  GameState,
  PlayerRec,
  RoundRec,
  SubmissionRec,
  SubmissionStatus,
} from './state.js'

export interface Actions<G extends GameRec, S extends SubmissionRec> {
  /**
   * Read a whole game.
   *
   * ⚠️ Defaults to the GUEST client, which is bound to one game — its token
   * carries the game it joined, and every rule that admits a guest admits it
   * only for that game. Reading any OTHER game with it comes back EMPTY rather
   * than failing, so a screen that swallows errors shows a blank board and no
   * reason for it.
   *
   * A host screen must therefore pass `pbHost`, which the rules admit for
   * every game it owns. That is the whole reason this takes a client.
   */
  loadState(gameId: string, client?: PocketBase): Promise<GameState<G, S>>
  submit(opts: { round: RoundRec; player: PlayerRec; submittedBy: PlayerRec; payload: Record<string, unknown>; score: number }): string
  save(opts: {
    round: RoundRec
    player: PlayerRec
    submittedBy: PlayerRec
    payload: Record<string, unknown>
    score: number
    /** `false` autosaves a draft; `true` hands the round in. */
    final: boolean
  }): void
  /** The idempotency key for one seat's entry in one round. */
  entryKey(roundId: string, playerId: string): string
  /**
   * Deal. The lobby is over and the table is playing.
   *
   * ⚠️ Takes a HOST client, and requires it — there is no guest default the way
   * `loadState` has one. Only a host may write the games collection, so a guest
   * client here fails rather than doing nothing, and a signature that let one
   * through would be an invitation to find that out at a card table.
   *
   * The host's own phone is the one holding that client, which is what lets the
   * button live in the host's SEAT rather than only on the host screen. Before
   * this, the seated host was shown "deal when everyone has scanned in" on a
   * screen with no way to deal.
   */
  startGame(gameId: string, client: PocketBase): Promise<G>
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

  async function loadState(gameId: string, client: PocketBase = pb): Promise<GameState<G, S>> {
    const [game, players, rounds] = await Promise.all([
      client.collection(c.games).getOne<G>(gameId),
      client.collection(c.players).getFullList<PlayerRec>({
        filter: `game="${gameId}"`,
        sort: 'seat_order',
      }),
      client.collection(c.rounds).getFullList<RoundRec>({
        filter: `game="${gameId}"`,
        sort: 'round_number',
      }),
    ])

    const roundIds = rounds.map((r) => `round="${r.id}"`).join(' || ')
    const submissions = roundIds
      ? await client.collection(c.submissions).getFullList<S>({ filter: roundIds })
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
   * The key for one seat's entry in one round.
   *
   * Derived, never random, and that is the whole design. It is the same value
   * for every autosave and for the final hand-in, so all of them collapse into
   * one queued write; and it matches the (round, player) uniqueness the schema
   * already enforces, so a proxied seat resolves as last-write-wins instead of
   * dying as a conflict.
   */
  function entryKey(roundId: string, playerId: string): string {
    return `${roundId}:${playerId}`
  }

  /**
   * Save a seat's entry — an autosaved draft, or the final hand-in.
   *
   * Both are the same write to the same row, differing only in `status`, which
   * is why there is one function rather than two. Like `submit` it does not
   * await the network: a dropout must never cost somebody the pile they just
   * counted.
   *
   * Prefer this to `submit` for anything a player builds up over time.
   */
  function save(opts: {
    round: RoundRec
    player: PlayerRec
    submittedBy: PlayerRec
    payload: Record<string, unknown>
    score: number
    final: boolean
    /**
     * A game's own intermediate state, when it has one. Wins over `final`.
     *
     * Oh Hell writes `bid` here: the bid is recorded and the hand has not been
     * played, which is neither a draft (nobody is mid-tap) nor an answer (no
     * tricks have been taken). Games without one leave it alone and `final`
     * decides, which is why nothing else in the suite changed.
     *
     * ⚠️ Anything other than `final` is NOT an answer — see {@link isAnswer}.
     * Rounds will not close on it and the reveal will not fire on it, which is
     * the point.
     */
    status?: SubmissionStatus
  }): void {
    const proxied = opts.submittedBy.id !== opts.player.id
    queue.upsert(c.submissions, entryKey(opts.round.id, opts.player.id), {
      round: opts.round.id,
      player: opts.player.id,
      submitted_by: opts.submittedBy.id,
      computed_score: opts.score,
      status: opts.status ?? (opts.final ? 'final' : 'draft'),
      ...opts.payload,
      ...(proxied ? { proxy_reason: 'declared' } : {}),
    })
  }

  /** See the note on the interface — the client is required, and must be a host. */
  async function startGame(gameId: string, client: PocketBase): Promise<G> {
    return client.collection(c.games).update<G>(gameId, { status: 'active' })
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

  return { loadState, submit, save, entryKey, startGame, closeRound, openNextRound, rematch }
}
