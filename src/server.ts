/**
 * The kit's server surface — `table-kit/server`.
 *
 * Runs in a Vercel function, not in a browser: no DOM, no React, no PocketBase
 * SDK. Just `fetch` against the backend's REST API, which is why it can be
 * imported by a serverless handler without dragging the client kit in behind
 * it.
 *
 * ── What it is for ────────────────────────────────────────────────────────
 * An endpoint that spends money — the rules adviser — cannot be open, and each
 * scorer had written the same gate by hand. This is that gate, once.
 *
 * ── Who is admitted, and on what evidence ─────────────────────────────────
 * A HOST is a platform user with an approved account and a grant for this app.
 * Straightforward, and it was the whole gate until a real game night showed
 * what it cost: a rules argument mid-hand had to be typed by the one person
 * signed in, so the host became a bottleneck at the worst possible moment.
 *
 * A PLAYER is anonymous but not unidentified. Joining by QR mints a throwaway
 * guest credential bound to exactly ONE game, and PocketBase will say whether
 * it is real. So "is this phone sitting at a game that is still being played"
 * is answerable, and it is the right question.
 *
 * ⚠️ The ACTIVE-GAME check is the whole gate for a player, and it is not
 * optional. A credential from a finished night still validates — every join
 * hook lets a returning phone back in so it can see the final card — so
 * admitting on the credential alone would leave every game ever played holding
 * a key to this endpoint forever.
 *
 * ⚠️ Nothing here trusts the token's CONTENTS. The token is handed back to
 * PocketBase, and PocketBase says whether it is real, whose it is, and what it
 * can see. The game is even read with the caller's own token rather than a
 * privileged one, so the collection rule that says "a guest sees only its own
 * game" does the scoping and this file never restates it.
 */

/** Only the shape this needs. A Vercel request satisfies it; so does a test. */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>
}

export interface Asker {
  role: 'host' | 'player'
  /** The user id or guest id, for logging. */
  id: string
  /** The game a player is sitting at. Absent for a host. */
  game?: string
}

export interface GateOptions {
  /** The PocketBase base URL. No default — a backend hostname is never guessed. */
  pbUrl: string
  /** The app slug in `app_access`, e.g. `heat`. */
  app: string
  /** The game's guest auth collection, e.g. `heat_guests`. */
  guests: string
  /** The game's games collection, e.g. `heat_games`. */
  games: string
  /** The platform's user collection. */
  users?: string
  /** The grants collection. */
  grants?: string
  /**
   * A role the grant must carry, if the app wants to insist on one.
   *
   * ⚠️ Unset by default, deliberately. All three scorers checked only that a
   * grant row EXISTS, and quietly adding `role="editor"` here would lock out
   * any host whose row predates roles — the sort of change that is invisible
   * until somebody at a table can't do the thing they did last week.
   */
  role?: string
}

export interface Gate {
  /** The platform user record if this is an approved, granted host. */
  verifyHost(req: AuthedRequest): Promise<Record<string, any> | null>
  /** The guest record if this token belongs to a game still being played. */
  verifyPlayer(req: AuthedRequest): Promise<Record<string, any> | null>
  /** Either of the above, host first — it is the stronger claim and the cheaper check. */
  verifyAsker(req: AuthedRequest): Promise<Asker | null>
}

function bearer(req: AuthedRequest): string {
  const raw = req?.headers?.authorization
  const header = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return header.startsWith('Bearer ') ? header.slice(7) : header
}

export function createGate(opts: GateOptions): Gate {
  const {
    pbUrl,
    app,
    guests,
    games,
    users = 'users',
    grants = 'app_access',
    role,
  } = opts

  if (!pbUrl) throw new Error('createGate needs pbUrl — the backend is never guessed.')

  async function verifyHost(req: AuthedRequest) {
    const token = bearer(req)
    if (!token) return null

    try {
      // auth-refresh both validates the token and hands back the record, so one
      // round trip answers "is this real" and "who is it".
      const authRes = await fetch(`${pbUrl}/api/collections/${users}/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
      })
      if (!authRes.ok) return null

      const auth = await authRes.json()
      const user = auth?.record
      if (!user?.id || user.status !== 'approved') return null

      // Same convention the apps use: read your own grant row.
      const filter = encodeURIComponent(
        `user="${user.id}" && app="${app}"` + (role ? ` && role="${role}"` : ''),
      )
      const grantRes = await fetch(
        `${pbUrl}/api/collections/${grants}/records?perPage=1&filter=${filter}`,
        { headers: { Authorization: auth.token || token } },
      )
      if (!grantRes.ok) return null

      const rows = await grantRes.json()
      return rows?.items?.length ? user : null
    } catch {
      // A backend that can't be reached is not an authorization.
      return null
    }
  }

  async function verifyPlayer(req: AuthedRequest) {
    const token = bearer(req)
    if (!token) return null

    try {
      const authRes = await fetch(`${pbUrl}/api/collections/${guests}/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
      })
      if (!authRes.ok) return null

      const auth = await authRes.json()
      const guest = auth?.record
      if (!guest?.id || !guest.game) return null

      const gameRes = await fetch(
        `${pbUrl}/api/collections/${games}/records/${guest.game}`,
        { headers: { Authorization: auth.token || token } },
      )
      if (!gameRes.ok) return null

      const game = await gameRes.json()
      return game?.status === 'active' ? guest : null
    } catch {
      return null
    }
  }

  async function verifyAsker(req: AuthedRequest): Promise<Asker | null> {
    const host = await verifyHost(req)
    if (host) return { role: 'host', id: host.id }

    const player = await verifyPlayer(req)
    if (player) return { role: 'player', id: player.id, game: player.game }

    return null
  }

  return { verifyHost, verifyPlayer, verifyAsker }
}
