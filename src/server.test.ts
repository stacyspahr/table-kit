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

describe('keeping the question', () => {
  const ruling = {
    question: 'can you bust on an unlucky 7?',
    thread: [
      { role: 'user', content: 'can you bust on an unlucky 7?' },
      { role: 'assistant', content: 'No.' },
    ],
    answer: 'No.',
    context: 'goal 66',
  }

  /** A backend that accepts the write, shaped so the call can be inspected. */
  const accepts = () =>
    vi.fn(async (_url: string, _init?: any) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))

  const url = (fetchMock: any) => fetchMock.mock.calls[0]![0] as string
  const posted = (fetchMock: any) => JSON.parse((fetchMock.mock.calls[0]![1] as any).body)

  it('files a host question against their account, with no game', async () => {
    const fetchMock = accepts()
    vi.stubGlobal('fetch', fetchMock)

    const kept = await gate().logRuling(req('tok'), { role: 'host', id: 'u1' }, ruling)

    expect(kept).toBe(true)
    expect(url(fetchMock)).toBe(`${PB}/api/collections/heat_rulings/records`)
    expect(posted(fetchMock)).toMatchObject({
      asked_by: 'u1',
      asked_by_guest: '',
      asker_role: 'host',
      game: '',
      status: 'new',
      digested: false,
      context: 'goal 66',
    })
  })

  it("files a player's question against the game they are sitting at", async () => {
    // The game comes free from the gate — a player was admitted BECAUSE their
    // credential is bound to a game still being played, so it never has to be
    // sent by the phone and can't be spoofed by one.
    const fetchMock = accepts()
    vi.stubGlobal('fetch', fetchMock)

    await gate().logRuling(req('tok'), { role: 'player', id: 'p1', game: 'g9' }, ruling)

    expect(posted(fetchMock)).toMatchObject({
      asked_by: '',
      asked_by_guest: 'p1',
      asker_role: 'player',
      game: 'g9',
    })
  })

  it('derives the collection from the guest prefix, not the app slug', () => {
    // Flip 7's slug is `flip7` and its collections are `f7_*`. Deriving from the
    // slug would post to a collection that does not exist — and since this
    // swallows failures, it would do so in silence, for exactly one app.
    const fetchMock = accepts()
    vi.stubGlobal('fetch', fetchMock)

    const f7 = createGate({ pbUrl: PB, app: 'flip7', guests: 'f7_guests', games: 'f7_games' })
    f7.logRuling(req('tok'), { role: 'host', id: 'u1' }, ruling)

    expect(url(fetchMock)).toContain('/f7_rulings/')
  })

  it('stays quiet when the backend refuses the write', async () => {
    // A lost question is a shame. A lost RULING is somebody standing over a hand
    // mid-argument, so nothing here is allowed to reach the caller.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    await expect(
      gate().logRuling(req('tok'), { role: 'host', id: 'u1' }, ruling),
    ).resolves.toBe(false)
  })

  it('stays quiet when the backend cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(
      gate().logRuling(req('tok'), { role: 'host', id: 'u1' }, ruling),
    ).resolves.toBe(false)
  })
})
