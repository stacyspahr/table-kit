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
 * scorer had written the same gate by hand. This is that gate, once. It also
 * carries the triage adviser's prompt (`triage-prompt.ts`), for the same
 * reason and with the same no-SDK rule: a prompt and a schema are strings.
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

export * from './triage-prompt.js'

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

/**
 * A question and what it was answered with, on its way to being kept.
 *
 * The shape is the kit's rather than each game's because no game has an opinion
 * about it — `context` is the only field whose MEANING is per-game (the goal for
 * Beat the Heat, the mode for Flip 7), and it is a string either way.
 */
export interface RulingRecord {
  /**
   * The question as the person typed it.
   *
   * ⚠️ Capture this BEFORE any table context is prefixed onto the last user
   * turn. The endpoints splice "[This table is playing: …]" into the message
   * they send, and logging after that stores the prefix as though somebody had
   * typed it — which reads as noise in a digest and poisons the grouping.
   */
  question: string
  /**
   * The whole conversation, including the answer.
   *
   * Follow-ups are where the real question usually lands ("what if the row only
   * had one card in it?"), so the opening turn alone routinely misreads what was
   * being asked. It is a few kilobytes; store it.
   */
  thread: { role: string; content: string }[]
  /** What the model ruled. ⚠️ A draft for the rulebook, never a rule. */
  answer: string
  /** What was sent as table context. An answer read without it can look wrong. */
  context?: string | null
  /**
   * The night it came from. Defaults to the game the asker is sitting at.
   *
   * Nullable because the rules sheet also opens from the host home with no game
   * in play, which is a perfectly good moment to wonder about something.
   */
  game?: string | null
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
  /**
   * Where rulings are kept. Defaults to the guest collection's prefix —
   * `heat_guests` → `heat_rulings` — so a new app configures nothing.
   *
   * ⚠️ Derived from `guests` and NOT from `app` on purpose: Flip 7's app slug is
   * `flip7` but its collections are `f7_*`, so `${app}_rulings` would name a
   * collection that does not exist, and the log would fail silently for exactly
   * one app.
   */
  rulings?: string
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
  /**
   * Keep a question and the ruling it got. Returns whether it was kept.
   *
   * ⚠️ Never throws and never rethrows. A question that failed to log is a
   * question lost; a ruling that failed to ARRIVE is somebody standing over a
   * hand mid-argument. The second is worse, so this swallows everything and the
   * caller ignores the result.
   */
  logRuling(req: AuthedRequest, asker: Asker, ruling: RulingRecord): Promise<boolean>
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
    rulings = `${guests.replace(/_guests$/, '')}_rulings`,
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

  /**
   * The questions people ask are the highest-signal thing these apps produce —
   * a question is a hole in the rulebook with a person standing in it — and
   * until now every one of them was answered and thrown away.
   *
   * Written with the ASKER's own token, like everything else here, so no
   * privileged credential has to sit in a Vercel project. The consequence is
   * worth stating plainly: the create rule has to admit guests, so somebody at
   * the table could POST a row this endpoint never saw. Reads stay host-only,
   * the stakes are a family game night, and the alternative is a per-app hook
   * route — which is the one thing this design exists to avoid.
   */
  async function logRuling(
    req: AuthedRequest,
    asker: Asker,
    ruling: RulingRecord,
  ): Promise<boolean> {
    const token = bearer(req)
    if (!token) return false

    try {
      const res = await fetch(`${pbUrl}/api/collections/${rulings}/records`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // A host and a player are different KINDS of record — one is an
          // account, one is a throwaway credential — so they get a field each
          // rather than one relation that can't decide what it points at.
          asked_by: asker.role === 'host' ? asker.id : '',
          asked_by_guest: asker.role === 'player' ? asker.id : '',
          asker_role: asker.role,
          game: ruling.game ?? asker.game ?? '',
          question: ruling.question,
          thread: ruling.thread,
          answer: ruling.answer,
          context: ruling.context ?? '',
          // `status` is what somebody DECIDED; `digested` is whether they were
          // ever told. Two different questions, so two fields — collapsing them
          // makes "new but already emailed" unrepresentable.
          status: 'new',
          digested: false,
        }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  return { verifyHost, verifyPlayer, verifyAsker, logRuling }
}
