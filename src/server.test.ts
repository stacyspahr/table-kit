import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGate } from './server.js'

afterEach(() => vi.unstubAllGlobals())

const PB = 'https://pb.example'

const gate = () =>
  createGate({ pbUrl: PB, app: 'heat', guests: 'heat_guests', games: 'heat_games' })

const req = (authorization?: string) => ({ headers: { authorization } })

/**
 * A fake backend, routed by URL.
 *
 * Every case below is really a statement about which of these three calls the
 * gate makes and what it does with the answers, so they are worth spelling out
 * rather than hiding behind one catch-all mock.
 */
function backend(routes: Record<string, unknown | null>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    const body = key ? routes[key] : null
    if (!body) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  })
}

describe('who may ask a ruling', () => {
  it('admits an approved host holding a grant', async () => {
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': { token: 't', record: { id: 'u1', status: 'approved' } },
        'app_access/records': { items: [{ id: 'g1' }] },
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toEqual({ role: 'host', id: 'u1' })
  })

  it('refuses a user whose account is not approved yet', async () => {
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': { token: 't', record: { id: 'u1', status: 'pending' } },
        'app_access/records': { items: [{ id: 'g1' }] },
        'heat_guests/auth-refresh': null,
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toBeNull()
  })

  it('refuses an approved user with no grant for this app', async () => {
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': { token: 't', record: { id: 'u1', status: 'approved' } },
        'app_access/records': { items: [] },
        'heat_guests/auth-refresh': null,
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toBeNull()
  })

  it('admits a player sitting at a game still being played', async () => {
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': null,
        'heat_guests/auth-refresh': { token: 't', record: { id: 'p1', game: 'g9' } },
        'heat_games/records/g9': { id: 'g9', status: 'active' },
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toEqual({
      role: 'player',
      id: 'p1',
      game: 'g9',
    })
  })

  it('refuses a player whose game has finished', async () => {
    // ⚠️ The whole gate for a player. A credential from a finished night still
    // validates — the join hook lets a returning phone back in to see the final
    // card — so without this every game ever played holds a key forever.
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': null,
        'heat_guests/auth-refresh': { token: 't', record: { id: 'p1', game: 'g9' } },
        'heat_games/records/g9': { id: 'g9', status: 'finished' },
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toBeNull()
  })

  it("refuses a guest token pointed at somebody else's game", async () => {
    // The game is read with the CALLER's token, so the collection rule answers
    // this and the gate never restates it: not yours, not found, not admitted.
    vi.stubGlobal(
      'fetch',
      backend({
        'users/auth-refresh': null,
        'heat_guests/auth-refresh': { token: 't', record: { id: 'p1', game: 'other' } },
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toBeNull()
  })

  it('refuses a request with no credential at all, without calling out', async () => {
    const fetchMock = backend({})
    vi.stubGlobal('fetch', fetchMock)
    expect(await gate().verifyAsker(req())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips a Bearer prefix, since PocketBase wants the bare token', async () => {
    const fetchMock = backend({
      'users/auth-refresh': { token: 't', record: { id: 'u1', status: 'approved' } },
      'app_access/records': { items: [{ id: 'g1' }] },
    })
    vi.stubGlobal('fetch', fetchMock)
    await gate().verifyAsker(req('Bearer tok-abc'))
    expect((fetchMock.mock.calls[0]![1] as any).headers.Authorization).toBe('tok-abc')
  })

  it('treats a backend it cannot reach as no authorization', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    expect(await gate().verifyAsker(req('tok'))).toBeNull()
  })

  it('refuses to be built without a backend to check against', () => {
    expect(() =>
      createGate({ pbUrl: '', app: 'heat', guests: 'heat_guests', games: 'heat_games' }),
    ).toThrow()
  })
})
