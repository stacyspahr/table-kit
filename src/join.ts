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
        sort: 'display_name',
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
        device_id: deviceId,
        guest: pb.authStore.record?.id,
        // A latecomer owes nothing for rounds that ran before they sat down.
        joined_round: round,
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
