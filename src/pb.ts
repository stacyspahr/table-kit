/**
 * PocketBase clients.
 *
 * Extracted from Flip 7, parameterised by app key so each game gets its own
 * auth stores and its own join endpoint on the shared backend.
 */

import PocketBase, { LocalAuthStore } from 'pocketbase'
import type { TableKitConfig } from './config.js'

export interface Clients {
  /** Platform user. Hosts only. */
  pbHost: PocketBase
  /** Throwaway per-game credential. Everyone at the table. */
  pbGuest: PocketBase
  url: string
  /** Swap a join token for a guest credential. The only way into a game. */
  joinGame(token: string, deviceId: string): Promise<{ id: string; game: string }>
}

export function createClients(config: TableKitConfig): Clients {
  const url = config.pbUrl

  /**
   * TWO clients, two auth stores — deliberately.
   *
   * A host is a platform user; a player is a throwaway guest credential. The
   * host is also a player (they occupy a seat like anyone else), so one device
   * can legitimately hold both at once. A single shared auth store would make
   * logging in as host silently sign you out of your own seat.
   */
  const pbHost = new PocketBase(url, new LocalAuthStore(`${config.appKey}_host`))
  const pbGuest = new PocketBase(url, new LocalAuthStore(`${config.appKey}_guest`))

  // Rapid screen changes cancel in-flight requests otherwise, which shows up as
  // spurious errors mid-game.
  pbHost.autoCancellation(false)
  pbGuest.autoCancellation(false)

  async function joinGame(token: string, deviceId: string) {
    const res = await fetch(`${url}/api/${config.appKey}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, device_id: deviceId }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(data?.message || "That join link isn't valid.")
    }
    pbGuest.authStore.save(data.token, data.record)
    return data.record as { id: string; game: string }
  }

  return { pbHost, pbGuest, url, joinGame }
}
