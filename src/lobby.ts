/**
 * The lobby: who is at the table yet, and whether that is enough to deal.
 *
 * ── Why this is the kit's ────────────────────────────────────────────────
 * Watching seats arrive and deciding a game may start are both "everything
 * about a game night except how a round is scored." Neither needs to know what
 * a Flip 7 is. What stays with the game is the WORDING — "deal the first
 * round" against "tee off" — and the floor itself, which is a fact about the
 * game's rules and arrives through config.
 */

import type PocketBase from 'pocketbase'
import type { TableKitConfig } from './config.js'
import type { PlayerRec } from './state.js'

export interface LobbyState {
  /** Enough seats to deal. */
  canStart: boolean
  /** How many more are needed. Zero once the floor is met. */
  shortBy: number
  /** The floor actually in force, after the default. */
  minPlayers: number
  seated: number
}

/**
 * Measure a lobby against the game's floor.
 *
 * Pure, and separate from the polling below, because the host screen and the
 * player's lobby both need this answer and only one of them is doing the
 * fetching. A default of 1 rather than 0 means the "start with an empty table"
 * case is closed even for a game that never declares a floor — which is what
 * every app relied on before this existed, expressed as a rule instead of as a
 * `players.length === 0` check copied into each of them.
 */
export function lobbyState(seated: number, config: TableKitConfig): LobbyState {
  const minPlayers = Math.max(1, config.minPlayers ?? 1)
  const shortBy = Math.max(0, minPlayers - seated)
  return { canStart: shortBy === 0, shortBy, minPlayers, seated }
}

/**
 * Read the seats currently at a game.
 *
 * Sorted by seat order so the list a host is watching only ever grows at the
 * bottom. A name that jumps position as someone else joins reads as a bug, and
 * at a table people are watching for their OWN name to appear.
 */
export async function fetchSeats(
  pb: PocketBase,
  config: TableKitConfig,
  gameId: string,
): Promise<PlayerRec[]> {
  return pb.collection(config.collections.players).getFullList<PlayerRec>({
    filter: `game="${gameId}"`,
    sort: 'seat_order',
  })
}
