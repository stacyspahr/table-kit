/**
 * Getting a phone from a scanned QR to a seat at the table.
 *
 * ── Why this is the kit's and not a game's ───────────────────────────────
 * The seam says the kit owns everything about a game night except how a round
 * is scored, and joining one is the first half of that sentence with nothing
 * left over. Every mechanism this uses is already the kit's — the join token,
 * `getDeviceId`, `seatChoices`, `rememberSeat`, seat claim, unclaimed seats.
 * What was left in each app was the ARRANGEMENT of things the kit already
 * owned, which is the definition of code in the wrong place.
 *
 * ── What it deliberately does NOT own ────────────────────────────────────
 * The lobby copy ("waiting for the host to deal"), what a game calls its goal,
 * and the play screen itself. Those differ per game for real reasons, and a
 * component that swallowed them would need a prop per sentence — at which
 * point it stops being shared code and becomes a configuration language.
 *
 * So an app's join screen becomes: call `bootstrapJoin`, render the kit's
 * `SeatClaim` while claiming, and render its own screens once seated.
 */

import type PocketBase from 'pocketbase'
import type { TableKitConfig } from './config.js'
import type { GameRec, PlayerRec } from './state.js'

/** The shape the roster list needs. Games carry more columns; none are read. */
export interface RosterLike {
  id: string
  display_name: string
}

export interface JoinResult<G extends GameRec> {
  game: G
  players: PlayerRec[]
  roster: RosterLike[]
  /** The round a latecomer would be joining at — never earlier than 1. */
  round: number
  /** This device already had a seat: go straight in, ask nothing. */
  seated: PlayerRec | null
}

/**
 * Exchange a join token for a game, its seats and its roster.
 *
 * ⚠️ The already-seated check is the reload recovery path and the reason the
 * join token is never stripped from the URL. iOS discards a backgrounded tab
 * and reloads it; landing back here must put the player straight back in their
 * seat rather than asking who they are for a second time mid-game.
 *
 * The roster read is allowed to fail on its own. A missing or unreadable
 * roster costs a convenience — the one-tap "I'm …" buttons — and nothing else,
 * so it must not take the whole join down with it.
 */
export async function bootstrapJoin<G extends GameRec>({
  pb,
  config,
  joinGame,
  token,
  deviceId,
  rosterFilter,
  rosterSort,
}: {
  pb: PocketBase
  config: TableKitConfig
  joinGame: (token: string, deviceId: string) => Promise<{ id: string; game: string }>
  token: string
  deviceId: string
  /**
   * Extra filter for the roster read, appended to the owner match. Games use
   * this for their own "still active" column, which differs between them —
   * `retired!=true` in one, `active=true` in another.
   */
  rosterFilter?: string
  /**
   * Sort for the roster read. Defaults to alphabetical.
   *
   * `seatChoices` caps the list it shows, so this decides WHICH names survive
   * the cap — not merely their order. A game that keeps play counters can put
   * the people most likely to be at the table on top (`-last_played`); one
   * whose roster carries no counters has nothing better than a name to sort
   * on. Same reason `rosterFilter` is a parameter: the columns differ per game
   * and the kit must not learn any of them.
   */
  rosterSort?: string
}): Promise<JoinResult<G>> {
  const c = config.collections
  const rosterCollection = c.roster ?? `${config.appKey}_roster`

  const guest = await joinGame(token, deviceId)
  const game = await pb.collection(c.games).getOne<G>(guest.game)

  const players = await pb.collection(c.players).getFullList<PlayerRec>({
    filter: `game="${game.id}"`,
    sort: 'seat_order',
  })

  const rounds = await pb.collection(c.rounds).getFullList<{ round_number: number }>({
    filter: `game="${game.id}"`,
    sort: '-round_number',
  })
  const round = rounds[0]?.round_number ?? 1

  // Either statement of "this phone holds this seat" counts. `guest` is the
  // firmer one; `device_id` survives a guest credential being reissued.
  const seated =
    players.find((s) => (s.guest && s.guest === guest.id) || (s.device_id && s.device_id === deviceId)) ??
    null

  let roster: RosterLike[] = []
  if (!seated) {
    try {
      roster = await pb.collection(rosterCollection).getFullList<RosterLike>({
        filter: `owner="${game.host_user}"${rosterFilter ? ` && ${rosterFilter}` : ''}`,
        sort: rosterSort ?? 'display_name',
      })
    } catch {
      /* no roster yet, or unreadable — costs a shortcut, never the join */
    }
  }

  return { game, players, roster, round, seated }
}

/**
 * Take a new seat, past whoever else is sitting down at the same moment.
 *
 * Seats are unique on (game, seat_order) and people scan the QR together, so
 * the player list this screen loaded with is stale the instant anyone else
 * claims. Re-read first, then walk the seat number up past collisions rather
 * than handing the player a button that just fails.
 *
 * ── An EMPTY `deviceId` makes a phoneless seat ───────────────────────────
 * The host adds one from the lobby for someone playing without a phone. It is
 * deliberately the same function and the same retry: a phoneless player is a
 * seat like any other, they appear in `waitingOn` like any other, and so they
 * cannot be quietly forgotten at the end of a round. A second code path is
 * exactly how they would be.
 *
 * An unclaimed seat carries neither `device_id` nor `guest` — that absence IS
 * the mark of it being unclaimed, and it is what lets anyone at the table
 * enter for it, or take it over later through `reclaimSeat`.
 */
export async function claimSeat({
  pb,
  config,
  gameId,
  deviceId,
  displayName,
  round,
  rosterEntry,
  attempts = 5,
}: {
  pb: PocketBase
  config: TableKitConfig
  gameId: string
  /** Empty makes an unclaimed seat — someone playing without a phone. */
  deviceId: string
  displayName: string
  round: number
  rosterEntry?: string
  attempts?: number
}): Promise<PlayerRec> {
  const c = config.collections
  const trimmed = displayName.trim()
  if (!trimmed) throw new Error('A seat needs a name.')

  let latest: PlayerRec[] = []
  try {
    latest = await pb.collection(c.players).getFullList<PlayerRec>({
      filter: `game="${gameId}"`,
      sort: 'seat_order',
    })
  } catch {
    /* fall through on whatever the caller already had */
  }

  let seat = latest.length ? Math.max(...latest.map((p) => p.seat_order ?? 0)) + 1 : 0
  let lastError: unknown = null

  for (let i = 0; i < attempts; i++) {
    try {
      return await pb.collection(c.players).create<PlayerRec>({
        game: gameId,
        display_name: trimmed,
        seat_order: seat,
        // A latecomer owes nothing for rounds that ran before they sat down.
        joined_round: round,
        // Both omitted for a phoneless seat. Writing the HOST's credential onto
        // one would be actively wrong: it would read as claimed by the host's
        // phone, and the seat could never be taken over by its actual player.
        ...(deviceId ? { device_id: deviceId, guest: pb.authStore.record?.id } : {}),
        ...(rosterEntry ? { roster_entry: rosterEntry } : {}),
      })
    } catch (e) {
      lastError = e
      seat += 1
    }
  }
  throw lastError
}

/**
 * Take a seat away again, before the game has started.
 *
 * ── Why a delete is right HERE and wrong everywhere else ─────────────────
 * In the lobby a seat holds nothing. Nobody has scored, so removing one costs
 * a name and a `seat_order`, and the commonest reason to want it is the
 * commonest thing that goes wrong at this point in the evening — somebody
 * tapped the wrong name, or a seat got added for a person who then turned up
 * with their own phone.
 *
 * ⚠️ **Once a card has been dealt this is the wrong operation and it is not
 * offered.** A seat's submissions relate to it, so deleting one mid-game
 * rewrites the night to say that player was never there: every closed round's
 * totals change, the share card loses a row, and their lifetime stats lose the
 * game. Somebody leaving mid-game is a real thing that needs a real answer —
 * see `docs/SEATS_SPEC.md`, where it is a SPAN on the seat rather than the
 * absence of one — and it is deliberately not this function.
 *
 * ⚠️ **The status check here is a guard, not a gate.** The collection's
 * `deleteRule` is HOST with no status clause, so a host client can delete a
 * seat at any point in a game whatever this says. What stops that today is
 * that nothing offers it; the rule itself is worth tightening to
 * `game.status = "lobby"` when the seats migration next runs.
 */
export async function removeSeat<G extends GameRec>({
  pb,
  config,
  game,
  seat,
}: {
  pb: PocketBase
  config: TableKitConfig
  /** Read for its status. Passed whole so the caller cannot forget it. */
  game: G
  seat: PlayerRec
}): Promise<void> {
  if (game.status !== 'lobby') {
    throw new Error('A seat can only be taken away before the game starts.')
  }
  await pb.collection(config.collections.players).delete(seat.id)
}

/**
 * Take back a seat that already exists.
 *
 * Two cases, one code path, deliberately. A returning player on a NEW phone
 * has a different `device_id` — if an occupied seat weren't reclaimable they
 * would be locked out, and making a fresh seat would split their score in two.
 * And it is how a phoneless seat gets a phone halfway through the evening.
 */
export async function reclaimSeat({
  pb,
  config,
  seat,
  deviceId,
}: {
  pb: PocketBase
  config: TableKitConfig
  seat: PlayerRec
  deviceId: string
}): Promise<PlayerRec> {
  return pb.collection(config.collections.players).update<PlayerRec>(seat.id, {
    device_id: deviceId,
    guest: pb.authStore.record?.id,
  })
}
