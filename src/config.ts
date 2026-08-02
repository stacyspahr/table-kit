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
  /**
   * Durable identity across nights. Optional only because it was added after
   * two apps already existed; it defaults to `<appKey>_roster`, which is right
   * for every app except Flip 7, whose collection predates the convention and
   * is called `f7_roster`.
   *
   * Naming it here rather than deriving it is what keeps the join flow free of
   * a per-app special case — and a per-app special case in kit code is the one
   * thing the seam rule forbids outright.
   */
  roster?: string
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
  /**
   * Fewest seats a game may start with. Defaults to 1 — which is to say, no
   * rule beyond "somebody is here."
   *
   * The NUMBER is the game's, never the kit's: Flip 7 needs three, Play Nine
   * and Beat the Heat play with two. A kit that knew any of those numbers
   * would be a kit that knew the games, which the seam rule forbids. All the
   * kit owns is that the rule is enforced and how far short the table is.
   */
  minPlayers?: number
  /**
   * Backend origin. **Required, and never defaulted.**
   *
   * The platform convention is that frontends read this from `VITE_PB_URL` and
   * never hardcode it, so the hostname can change with a one-line edit. A
   * default here would also bake a private backend address into a public
   * package, which the Flip 7 spec explicitly rules out — the PocketBase
   * hostname is an API endpoint and is never surfaced.
   */
  pbUrl: string
}
