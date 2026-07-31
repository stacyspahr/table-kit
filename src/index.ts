/**
 * table-kit — the shared game-night layer.
 *
 * Everything about seats, joining, syncing, surviving a dead phone, and running
 * rounds. Nothing about how a round is scored: that is the game's job, and the
 * dependency arrow only ever points this way.
 */

import { createActions, type Actions } from './actions'
import type { TableKitConfig } from './config'
import { createClients, type Clients } from './pb'
import { createQueue, type Queue } from './queue'
import type { GameRec, SubmissionRec } from './state'

export * from './config'
export * from './session'
export * from './state'
export * from './queue'
export * from './pwa'
export * from './version'
export type { Clients } from './pb'
export type { Actions } from './actions'

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
