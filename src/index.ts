/**
 * table-kit — the shared game-night layer.
 *
 * Everything about seats, joining, syncing, surviving a dead phone, and running
 * rounds. Nothing about how a round is scored: that is the game's job, and the
 * dependency arrow only ever points this way.
 */

import { createActions, type Actions } from './actions.js'
import type { TableKitConfig } from './config.js'
import { createClients, type Clients } from './pb.js'
import { createQueue, type Queue } from './queue.js'
import type { GameRec, SubmissionRec } from './state.js'

export * from './awards.js'
export * from './config.js'
export * from './nights.js'
export * from './session.js'
export * from './state.js'
export * from './queue.js'
export * from './roster.js'
export * from './pwa.js'
export * from './version.js'
export type { Clients } from './pb.js'
export type { Actions } from './actions.js'

export interface TableKit<G extends GameRec, S extends SubmissionRec>
  extends Clients,
    Actions<G, S> {
  config: TableKitConfig
  queue: Queue
  /** Release timers and listeners. Rarely needed outside tests. */
  destroy(): void
}

/**
 * Wire up a game.
 *
 * Guest client by default: everything played through the kit is done by a
 * seated player, host included. The host client is exposed separately for the
 * few screens that genuinely need platform auth.
 */
export function createKit<G extends GameRec = GameRec, S extends SubmissionRec = SubmissionRec>(
  config: TableKitConfig,
): TableKit<G, S> {
  const clients = createClients(config)
  const queue = createQueue({ appKey: config.appKey, pb: clients.pbGuest })
  const actions = createActions<G, S>({ pb: clients.pbGuest, config, queue })

  return {
    ...clients,
    ...actions,
    config,
    queue,
    destroy() {
      queue.destroy()
    },
  }
}
