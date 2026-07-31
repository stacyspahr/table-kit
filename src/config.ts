/**
 * What a game tells the kit about itself.
 *
 * Everything here is a knob a second game would need to turn. If a field would
 * be identical for every game in the suite, it does not belong in this file —
 * it belongs hardcoded in the kit.
 */

/** Who wins when the game ends. Flip 7 is `highest`; Beat the Heat is `lowest`. */
export type Winner = 'highest' | 'lowest'

export interface Collections {
  games: string
  players: string
  rounds: string
  submissions: string
}

export interface TableKitConfig {
  /**
   * Short app slug. Drives the storage key prefix, the two auth store names,
   * and the `/api/<appKey>/…` endpoints. `flip7`, `heat`, …
   */
  appKey: string
  collections: Collections
  /**
   * Which end of the leaderboard wins.
   *
   * Note this is SEPARATE from the end trigger. In both games scores climb and
   * crossing the threshold ends the game — what differs is only who is declared
   * the winner. Conflating the two is the bug waiting to happen when a
   * low-wins game reuses a high-wins hook.
   */
  winner: Winner
  /** Defaults to the shared platform PocketBase. */
  pbUrl?: string
}

export const DEFAULT_PB_URL = 'https://spahrfamily.duckdns.org'
