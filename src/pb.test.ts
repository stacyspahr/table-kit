import { beforeEach, describe, expect, it } from 'vitest'
import { createClients } from './pb.js'
import type { TableKitConfig } from './config.js'

const config = (appKey: string): TableKitConfig => ({
  appKey,
  collections: {
    games: `${appKey}_games`,
    players: `${appKey}_players`,
    rounds: `${appKey}_rounds`,
    submissions: `${appKey}_submissions`,
  },
  winner: 'highest',
  pbUrl: 'https://example.test',
})

beforeEach(() => {
  localStorage.clear()
})

/**
 * ⚠️ These key names are a CONTRACT with every phone already carrying a
 * session, not an implementation detail.
 *
 * Rename one and every host is signed out — and getting back in means waiting
 * on an emailed code, which at a table on a Friday night is the end of the
 * game. Every player loses their seat at the same time.
 *
 * Pinned because Flip 7 arrived at these names from its own hand-rolled
 * clients (`flip7_host`, `flip7_guest`) and its migration onto `createKit` was
 * only safe because `${appKey}_host` lands on the identical string.
 */
describe('where a session is kept', () => {
  it('keys the host store off the app slug', () => {
    const { pbHost } = createClients(config('flip7'))
    pbHost.authStore.save('token', { id: 'u1' } as never)
    expect(localStorage.getItem('flip7_host')).not.toBeNull()
  })

  it('keys the guest store off the app slug', () => {
    const { pbGuest } = createClients(config('flip7'))
    pbGuest.authStore.save('token', { id: 'g1' } as never)
    expect(localStorage.getItem('flip7_guest')).not.toBeNull()
  })

  /**
   * A host is a platform user; a player is a throwaway guest credential, and
   * the host is also a player. One device holds both at once, so a single
   * shared store would sign someone out of their own seat the moment they
   * logged in to host.
   */
  it('keeps the host and the guest in different stores', () => {
    const { pbHost, pbGuest } = createClients(config('heat'))
    pbHost.authStore.save('host-token', { id: 'u1' } as never)
    pbGuest.authStore.save('guest-token', { id: 'g1' } as never)

    expect(localStorage.getItem('heat_host')).toContain('host-token')
    expect(localStorage.getItem('heat_guest')).toContain('guest-token')
  })

  it('keeps two games on one phone from treading on each other', () => {
    const flip7 = createClients(config('flip7'))
    const heat = createClients(config('heat'))
    flip7.pbHost.authStore.save('flip7-token', { id: 'u1' } as never)
    heat.pbHost.authStore.save('heat-token', { id: 'u1' } as never)

    expect(localStorage.getItem('flip7_host')).toContain('flip7-token')
    expect(localStorage.getItem('heat_host')).toContain('heat-token')
  })

  it('points at the backend it was configured with', () => {
    const { url } = createClients(config('flip7'))
    expect(url).toBe('https://example.test')
  })
})
