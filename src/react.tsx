/**
 * The kit's React surface — `table-kit/react`.
 *
 * Deliberately a SEPARATE entry point. Everything under `table-kit` proper is
 * framework-free and stays that way: seats, sync, the offline queue and the
 * awards engine have no business knowing what renders them, and a future
 * consumer that isn't a React app must still be able to import the core
 * without pulling React in behind it.
 *
 * `react` and `qrcode` are optional peers for the same reason. Import this
 * module and you need both; import the core and you need neither.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type PocketBase from 'pocketbase'
import QRCode from 'qrcode'
import { joinUrl, keepAwake } from './session.js'
import { watchForUpdates } from './version.js'
import { recalledSeats, rememberSeat, seatChoices } from './roster.js'
import { fetchSeats, lobbyState, type LobbyState } from './lobby.js'
import type { TableKitConfig } from './config.js'
import type { RosterLike } from './join.js'
import type { PlayerRec } from './state.js'

/**
 * The full-screen join QR.
 *
 * Reachable at ANY point during a game, not just at creation — latecomers are
 * normal, and phones die mid-game. Any joined player can show it, not only the
 * host: the token isn't secret from people already at the table, and routing
 * every stranded player through the host makes the host a bottleneck mid-hand.
 *
 * Players scan with their phone's own camera app straight off the lock screen.
 * There is deliberately no in-app scanner — that would require already having
 * the app open, which is the thing we're avoiding.
 *
 * Every class it renders is the kit's own, so it arrives already wearing
 * whichever game imported it. See the `.qr-*` block in styles.css.
 */
export function QrPanel({
  token,
  gameName,
  onClose,
}: {
  token: string
  /** The game's human name. Used in the share sheet: "Join the … game". */
  gameName: string
  onClose: () => void
}) {
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState(false)
  const url = joinUrl(token)

  useEffect(() => {
    QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      // Four modules of white, which is what the QR spec asks for. It used to
      // be one — enough that most phones coped, and exactly the thing that
      // stops coping at an angle, in bad light, across a table. The card
      // behind it is the app's own light surface rather than pure white, so
      // this border is the whole quiet zone; it does not get to borrow the
      // surface underneath.
      margin: 4,
      // Plain black on white regardless of theme — a tinted QR is a QR that
      // some phone in the room fails to read.
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [url])

  // A phone that sleeps between latecomers means waking and re-opening this for
  // every single arrival.
  useEffect(() => {
    const awake = keepAwake()
    return () => awake.stop()
  }, [])

  // Some phone will fail to scan — glare, a cracked lens, an ancient Android.
  // The share sheet sends the raw link instead. Not a typed code; just the link.
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Join the ${gameName} game`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="qr-screen">
      <div className="qr-card">
        <h2>Scan to join</h2>
        <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="qr-help">Point your phone's camera at this — no app needed.</p>
      </div>
      <div className="qr-actions">
        <button className="btn ghost" onClick={share}>
          {copied ? 'Link copied' : 'Send the link instead'}
        </button>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

/**
 * "New version available — tap to update."
 *
 * In from day one in every app rather than bolted on later, because nobody at
 * a card table will ever force-quit an installed app to pick up a fix.
 *
 * `buildId` is a prop rather than a global because it is injected at BUILD
 * time by each app's bundler (`__BUILD_ID__`), and a package cannot read
 * another package's compile-time define.
 *
 * Was duplicated in both apps, and had already drifted: Beat the Heat used the
 * kit's `watchForUpdates`, Flip 7 still carried its own copy of the polling —
 * so a fix to one was not a fix to the other. That is the whole argument for
 * this file.
 */
export function UpdateBanner({
  buildId,
  label = '🔄 New version available — tap to update',
}: {
  buildId: string
  label?: string
}) {
  const [stale, setStale] = useState(false)

  useEffect(() => watchForUpdates({ buildId, onStale: () => setStale(true) }), [buildId])

  if (!stale) return null
  return (
    <button className="update-banner" onClick={() => window.location.reload()}>
      {label}
    </button>
  )
}

/**
 * Host sign-in by emailed code — the platform convention, never a password
 * form.
 *
 * Players never see this screen. They scan a QR and play anonymously; only
 * hosts hold an account.
 *
 * There is deliberately no invite flow here. An unknown email creates a
 * PENDING account with no access, which is the intended front door: a
 * superuser approves in the Platform · Access panel, and nothing on this
 * screen can shortcut that.
 *
 * `brand` is the app's own lockup, rendered above the form. It is a prop
 * because a sign-in page that introduces the app differently from the app
 * itself is where "which one is this again" starts.
 */
export function HostLogin({
  pb,
  brand,
  onDone,
}: {
  pb: { collection(name: string): any }
  brand?: ReactNode
  onDone: () => void
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [otpId, setOtpId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)

  // One flow for everyone: create the account if it doesn't exist yet (ignoring
  // an "already registered" error), then email a code. New and returning people
  // do exactly the same thing, so there's no wrong door to pick.
  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      try {
        // PocketBase requires a password on a new account, but nobody ever uses
        // one — sign-in is the emailed code. So it's a throwaway nobody sees.
        const secret = `${crypto.randomUUID()}Aa1!`
        await pb.collection('users').create({
          email: email.trim(),
          password: secret,
          passwordConfirm: secret,
          name: name.trim() || email.trim().split('@')[0],
        })
      } catch {
        /* already registered — carry on to the code */
      }
      const req = await pb.collection('users').requestOTP(email.trim())
      setOtpId(req.otpId)
      setCode('')
      setStep('code')
    } catch (ex: any) {
      setError(
        ex?.response?.message || 'Could not send a code. Double-check the email address.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError('')
    setBusy(true)
    try {
      const req = await pb.collection('users').requestOTP(email.trim())
      setOtpId(req.otpId)
      setResent(true)
      window.setTimeout(() => setResent(false), 3000)
    } catch {
      setError('Could not resend the code.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await pb.collection('users').authWithOTP(otpId, code.trim())
      onDone()
    } catch {
      setError("That code didn't work. Check it, or send a fresh one.")
      setBusy(false)
    }
  }

  return (
    <div className="screen center">
      {brand}

      {step === 'email' ? (
        <form className="card" onSubmit={sendCode}>
          <h2>Host sign in</h2>
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Stacy"
              autoComplete="name"
              autoFocus
            />
          </label>
          <label>
            Email
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn big" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
          <p className="fine">
            New or returning — we'll send a 6-digit code. Players don't sign in;
            they scan the QR you show them.
          </p>
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <h2>Enter your code</h2>
          <p className="fine" style={{ marginTop: 0 }}>
            We emailed a 6-digit code to <strong>{email}</strong>. It expires in
            15 minutes.
          </p>
          <label>
            Code
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              /* Lets iOS offer the code straight from the Mail notification. */
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn big" disabled={busy || code.length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={resend}>
            {resent ? 'Code sent' : 'Send a new code'}
          </button>
          <button
            className="linklike"
            type="button"
            onClick={() => {
              setStep('email')
              setError('')
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  )
}

/** Signed in, approved, but holding no grant for THIS app. */
export function NoAccess({ appName, onLogout }: { appName: string; onLogout: () => void }) {
  return (
    <div className="screen center">
      <div className="card">
        <h2>No access yet</h2>
        <p>
          Your account doesn't have {appName} access. Stacy grants it in the
          Platform · Access panel.
        </p>
        <button className="btn ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  )
}

/**
 * "Are you sure?", as a card rather than a dialog.
 *
 * ── Why not a modal ──────────────────────────────────────────────────────
 * Every app in the suite already asks this question, and every one of them
 * answers it the same way: swap the thing you tapped for a card that states
 * what is about to happen and offers two buttons. No overlay, no scroll lock,
 * nothing that can end up behind the iOS keyboard or trap a page that was
 * mid-scroll. This is that shape, extracted, so the fourth game does not have
 * to rediscover it.
 *
 * ── The two jobs, which are not the same ─────────────────────────────────
 * A confirm in front of something DESTRUCTIVE is a brake — see `tone:
 * 'danger'`. A confirm in front of something merely UNEXPECTED is a teacher:
 * the first time somebody taps a seat that isn't theirs, this is where they
 * find out entering for other people is a thing the app does on purpose. Write
 * `body` for the second case even when using it for the first.
 *
 * The confirm button carries the VERB, never "Yes" — read on its own, out of
 * context, across a table, "Yes" says nothing about what is about to happen.
 */
export function Confirm({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Never mind',
  tone = 'normal',
  onConfirm,
  onCancel,
}: {
  title: string
  /** What happens, and why you might want it. Optional — a clear title can stand alone. */
  body?: ReactNode
  /** The verb. "Enter for Michelle", "Delete this game" — never "Yes". */
  confirmLabel: string
  cancelLabel?: string
  tone?: 'normal' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const danger = tone === 'danger'
  return (
    <section className={`card ${danger ? 'danger-card' : ''}`}>
      <h2>{title}</h2>
      {body && <p className="fine">{body}</p>}
      <button
        className={`btn big ${danger ? 'danger' : 'primary'}`}
        onClick={onConfirm}
        autoFocus
      >
        {confirmLabel}
      </button>
      <button className="btn ghost" onClick={onCancel}>
        {cancelLabel}
      </button>
    </section>
  )
}

/** Account exists, nobody has approved it yet. */
export function Pending({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="screen center">
      <div className="card">
        <h2>Waiting for approval</h2>
        <p>Your account is created but not approved yet.</p>
        <button className="btn ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  )
}

interface InviteRec {
  id: string
  email: string
  role: string
}

/**
 * Invite someone to host their own game nights.
 *
 * The platform's access model in one component: ANYONE may put a name forward,
 * but the invite only attaches a role — the person stays PENDING until a
 * superuser approves them in the Platform · Access panel, because every app
 * rule requires an approved status. So anyone can nominate and exactly one
 * person decides who actually gets in.
 *
 * Players are never invited and never appear here. They scan a QR and play
 * with no account at all.
 *
 * ⚠️ `navigator.share` is called INSIDE the click's activation window, before
 * awaiting the save. Await first and iOS has already decided the gesture is
 * over, and silently refuses to open the sheet. Both apps learned this the
 * hard way; keeping the order is the point of sharing the code.
 */
export function InviteHost({
  pb,
  collection,
  appName,
  url,
  inviteText,
}: {
  pb: { collection(name: string): any }
  /** The app's invites collection — `nine_invites`, `heat_invites`, … */
  collection: string
  appName: string
  /** Where the invitee should open the app. */
  url: string
  /** Override the shared message. The default explains installing it. */
  inviteText?: (email: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [invites, setInvites] = useState<InviteRec[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  async function load() {
    try {
      setInvites(await pb.collection(collection).getFullList({ sort: '-created' }))
    } catch {
      /* no access, or the collection isn't there — stay quiet rather than
         putting an error in front of someone who didn't ask for a list */
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const defaultText = (clean: string) =>
    `You're invited to host ${appName} game nights.\n\nOpen this link, tap the Share button and choose "Add to Home Screen," then open the ${appName} icon and tap "Host sign in" with this email (${clean}) — you'll get a 6-digit code. Your access switches on once Stacy approves it.`

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const clean = email.trim().toLowerCase()
    const text = (inviteText ?? defaultText)(clean)
    const createP = pb.collection(collection).create({ email: clean, role: 'editor' })
    // See the warning above: share BEFORE awaiting the save.
    try {
      if (navigator.share) await navigator.share({ title: appName, text, url })
      else await navigator.clipboard.writeText(url)
    } catch {
      /* share canceled — the invite is still saved */
    }
    try {
      await createP
      setSent(clean)
      setEmail('')
      await load()
    } catch (ex: any) {
      setError(ex?.response?.message || 'Could not send that invite.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="linklike center-text" onClick={() => setOpen(true)}>
        Invite someone to host
      </button>
    )
  }

  return (
    <section className="card">
      <h2>Invite a host</h2>
      <p className="fine" style={{ marginTop: 0 }}>
        They'll be able to run their own games. Players don't need this — they
        just scan your code.
      </p>

      {sent && (
        <p className="fine">
          Invited <strong>{sent}</strong>. Text Stacy to switch on their access —
          until then they'll see "Waiting for approval" when they sign in.
        </p>
      )}

      <form onSubmit={invite}>
        <label>
          Their email
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@email.com"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy || !email.trim()}>
          {busy ? 'Inviting…' : 'Create invite & share'}
        </button>
      </form>

      {invites.length > 0 && (
        <>
          <h2>
            Waiting to sign up <span className="count">{invites.length}</span>
          </h2>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="row">
                  <span className="row-main">{i.email}</span>
                  <button
                    className="linklike"
                    onClick={async () => {
                      try {
                        await pb.collection(collection).delete(i.id)
                        await load()
                      } catch {
                        setError('Could not cancel that invite.')
                      }
                    }}
                  >
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="btn ghost" onClick={() => setOpen(false)}>
        Done
      </button>
    </section>
  )
}

/**
 * "Who are you?" — the screen a guest sees after scanning, and very often the
 * only one that ever introduces the app to them.
 *
 * Every decision about WHAT to offer lives in `seatChoices`; this renders it.
 * Four ways to a seat, in the order a person would try them:
 *
 *   1. A name this phone has sat down as before — one tap.
 *   2. A seat already at THIS table matching a name the phone knows, usually
 *      the phoneless one the host added ahead of time. Offered above the roster
 *      because taking it beats claiming a second seat, which would split the
 *      player's score across two rows.
 *   3. The roster, searchable once it is long enough to be worth typing over.
 *   4. Typing a name, for someone new.
 *
 * Nothing here knows what game it is in, which is why it can live in the kit —
 * the only game-shaped thing on screen is `brand`, and that is a slot.
 */
export function SeatClaim({
  appKey,
  players,
  roster,
  onClaim,
  onReclaim,
  brand,
}: {
  appKey: string
  players: PlayerRec[]
  roster: RosterLike[]
  onClaim: (name: string, rosterEntry?: string) => Promise<void>
  onReclaim: (seat: PlayerRec) => Promise<void>
  brand?: ReactNode
}) {
  const [typing, setTyping] = useState(false)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [confirm, setConfirm] = useState<PlayerRec | null>(null)

  // What this phone knew when the screen opened. Read ONCE: nothing writes to
  // it while the screen is up, and re-reading every render would churn the
  // suggestions under whoever is in the middle of reading them.
  const [recalled] = useState(() => recalledSeats(appKey))

  const { suggested, reclaimable, list, hiddenCount, searchable } = seatChoices({
    roster,
    seated: players,
    recalled,
    query,
  })
  const anyToPick = suggested.length + reclaimable.length + list.length > 0

  // Always surface a failure. A rejected write must never leave the button
  // looking merely inert — the player taps, nothing happens, and there is
  // nothing on screen to tell them why.
  async function run(fn: () => Promise<void>, remember: { id?: string; display_name: string }) {
    setBusy(true)
    setFailed('')
    try {
      await fn()
      // Next time this phone opens a join link it can offer the name straight
      // away. A typed-in name has no roster entry yet — the server hook makes
      // one after the write — so the name carries the match on its own.
      rememberSeat(appKey, remember)
    } catch (e: any) {
      setFailed(e?.response?.message || e?.message || "That didn't save. Tap to try again.")
    } finally {
      setBusy(false)
    }
  }

  if (confirm) {
    return (
      <div className="screen center">
        <div className="card">
          <h2>Play as {confirm.display_name}?</h2>
          <p className="fine">
            {confirm.device_id
              ? "That seat is already on someone's phone. If it's yours, take it back — your score comes with you."
              : 'That seat was added for someone without a phone. Take it and it becomes yours.'}
          </p>
          {failed && <p className="error">{failed}</p>}
          <button
            className="btn big"
            disabled={busy}
            onClick={() =>
              run(() => onReclaim(confirm), {
                id: confirm.roster_entry,
                display_name: confirm.display_name,
              })
            }
          >
            {busy ? 'Taking the seat…' : "Yes, that's me"}
          </button>
          <button className="btn ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      {brand}

      {!typing && (suggested.length > 0 || reclaimable.length > 0) && (
        <section className="card">
          {failed && <p className="error">{failed}</p>}
          {reclaimable.map((p) => (
            <button
              key={p.id}
              className="btn big"
              disabled={busy}
              onClick={() =>
                p.device_id
                  ? setConfirm(p)
                  : run(() => onReclaim(p), {
                      id: p.roster_entry,
                      display_name: p.display_name,
                    })
              }
            >
              I'm {p.display_name}
            </button>
          ))}
          {suggested.map((r) => (
            <button
              key={r.id}
              className="btn big"
              disabled={busy}
              onClick={() =>
                run(() => onClaim(r.display_name, r.id), {
                  id: r.id,
                  display_name: r.display_name,
                })
              }
            >
              I'm {r.display_name}
            </button>
          ))}
          <p className="fine">Last played on this phone.</p>
        </section>
      )}

      {!typing && (list.length > 0 || searchable) && (
        <section className="card">
          {(suggested.length > 0 || reclaimable.length > 0) && <h2>Or someone else</h2>}
          {failed && suggested.length === 0 && reclaimable.length === 0 && (
            <p className="error">{failed}</p>
          )}
          {/* Only once the list is long enough to be worth typing over. Never
              autofocused — a keyboard that throws itself up is exactly the
              fussing this screen exists to remove. */}
          {searchable && (
            <label>
              Find your name
              <input
                value={query}
                maxLength={40}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a letter or two"
              />
            </label>
          )}
          <ul className="list big-list">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  className="row"
                  disabled={busy}
                  onClick={() =>
                    run(() => onClaim(r.display_name, r.id), {
                      id: r.id,
                      display_name: r.display_name,
                    })
                  }
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
          {query.trim() && list.length === 0 && <p className="fine">No one by that name.</p>}
          {hiddenCount > 0 && (
            <p className="fine">
              {hiddenCount} more {hiddenCount === 1 ? 'name' : 'names'} — type a letter to find
              them.
            </p>
          )}
        </section>
      )}

      {typing ? (
        <section className="card">
          <label>
            Your name
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Michelle"
            />
          </label>
          {failed && <p className="error">{failed}</p>}
          <button
            className="btn big"
            disabled={busy || !name.trim()}
            onClick={() => run(() => onClaim(name), { display_name: name.trim() })}
          >
            {busy ? 'Taking a seat…' : "That's me"}
          </button>
          {anyToPick && (
            <button className="btn ghost" onClick={() => setTyping(false)}>
              Back to the list
            </button>
          )}
        </section>
      ) : (
        <button className="btn big" onClick={() => setTyping(true)}>
          {anyToPick ? "My name isn't here" : 'Type your name'}
        </button>
      )}

      {players.length > 0 && (
        <section className="card">
          <h2>Already sitting</h2>
          {/* The instruction belongs here once, not repeated onto every row — a
              per-row "tap to take" pill is wide enough to squeeze a name down
              to an ellipsis on a 375px phone, and the name is the whole point
              of the row. */}
          <p className="fine">Tap your name to take that seat.</p>
          <ul className="list">
            {players.map((p) => (
              <li key={p.id}>
                <button className="row" onClick={() => setConfirm(p)}>
                  <span className="row-main">{p.display_name}</span>
                  {!p.device_id && <span className="pill">no phone</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/**
 * Watch a lobby fill up.
 *
 * A lobby that shows nothing until the game starts is dead space, and the host
 * is left guessing whether the quiet means everyone has scanned in or that
 * nobody has. Polling rather than realtime for the reason the play screen
 * already gives: a three-second tick is invisible at a card table, and the kit
 * dropped realtime deliberately.
 *
 * `active` exists so the poll stops the moment the game leaves the lobby. An
 * interval that outlives the screen it belongs to is how a finished game keeps
 * talking to the server all evening.
 */
export function useLobby({
  pb,
  config,
  gameId,
  active,
  intervalMs = 3000,
  initial = [],
}: {
  pb: PocketBase
  config: TableKitConfig
  gameId: string | undefined
  active: boolean
  intervalMs?: number
  /** Seats already loaded, so the list never flashes empty on mount. */
  initial?: PlayerRec[]
}): LobbyState & { players: PlayerRec[]; refresh: () => Promise<void> } {
  const [players, setPlayers] = useState<PlayerRec[]>(initial)

  const refresh = useCallback(async () => {
    if (!gameId) return
    try {
      setPlayers(await fetchSeats(pb, config, gameId))
    } catch {
      /* transient — the next tick tries again, and a stale list is far better
         than an empty one under someone watching for their own name */
    }
  }, [pb, config, gameId])

  useEffect(() => {
    if (!active || !gameId) return
    void refresh()
    const id = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(id)
  }, [active, gameId, intervalMs, refresh])

  return { ...lobbyState(players.length, config), players, refresh }
}

/**
 * A seat with no phone of its own.
 *
 * ── Why the kit owns the MARK ────────────────────────────────────────────
 * Because three apps were about to say the same thing three ways. "No phone"
 * is one of the load-bearing facts at a card table — it is the difference
 * between a seat that will fill itself in and one somebody has to volunteer
 * for — and a fact that important cannot look like a different fact depending
 * on which scorer is open.
 *
 * A glyph rather than the words. It went onto the leaderboard first, where
 * there was no room for two words beside a name, a tick, a total and a bar —
 * and the lobbies kept the text pill on the grounds that they had the space.
 * That lasted one screenshot. The space was never the argument: a fact that
 * important should not change shape between the screen where you meet it and
 * the screen where you act on it, and the lobby is where you meet it.
 *
 * `currentColor`, so it takes the color of whatever it is set beside without an
 * app having to style it.
 */
export function NoPhone({ title = 'no phone' }: { title?: string }) {
  return (
    <svg
      className="tk-no-phone"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* A plain handset with a line through it, and plain is the point. An
          earlier cut broke the outline at the corners the slash crosses, on the
          theory that it would read as struck through rather than smudged. At
          17px it read as neither — just a damaged rectangle. The slash runs
          past the body at both ends, which is what makes it a slash and not a
          crack. */}
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  )
}

/**
 * The seats, as they arrive.
 *
 * Names only. What the lobby SAYS around this list — what the game is called,
 * what it is played to, whose turn it is to deal — stays with the game, which
 * is why nothing here takes a sentence.
 */
export function LobbySeats({ players }: { players: PlayerRec[] }) {
  return (
    <ul className="list tk-lobby-seats">
      {players.map((p) => (
        <li key={p.id}>
          {/* Beside the NAME, not out at the right edge where the text pill
              used to sit. The mark belongs to the person: a lobby row has
              nothing on its right-hand side, so a pill there floated alone in
              open space with nothing to anchor it. */}
          <span className="row-main">
            {p.display_name}
            {!p.device_id && <NoPhone />}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Hand the round in on its own once everybody's score is down.
 *
 * ── Who may arm this ─────────────────────────────────────────────────────
 * Exactly one device, and the kit does not pick which. Every phone in the game
 * renders the same "score the round" button, so arming this everywhere would
 * have every phone at the table fire the same close at the same instant — and
 * a round close is not a no-op on the server, it opens the next round. The app
 * passes `armed` true on ONE device (the host's) and false on the rest.
 *
 * ── Why a touch cancels ──────────────────────────────────────────────────
 * The first non-negotiable is that the game is played on the table. Fifteen
 * seconds after the last score lands, the table is often still talking about
 * the hand — so any touch anywhere stops the clock and hands the pace back to
 * the room. It stays stopped until the round is over; re-arming after someone
 * has said "wait" is the app arguing with them.
 */
export function useAutoSubmit({
  armed,
  seconds = 15,
  onFire,
}: {
  armed: boolean
  seconds?: number
  onFire: () => void
}): { running: boolean; progress: number; remaining: number; cancel: () => void } {
  const [progress, setProgress] = useState(1)
  const [cancelled, setCancelled] = useState(false)

  // Held in a ref so a caller that rebuilds its handler every render — which is
  // most of them — doesn't restart the countdown on every tick it causes.
  const fire = useRef(onFire)
  fire.current = onFire

  const running = armed && !cancelled

  // Disarming resets, so the next round starts with a full ring rather than
  // whatever was left on screen when this one closed.
  useEffect(() => {
    if (!armed) {
      setCancelled(false)
      setProgress(1)
    }
  }, [armed])

  useEffect(() => {
    if (!running) return
    const cancel = () => setCancelled(true)
    // Capture phase: the tap that cancels must not also be the tap that lands
    // on whatever is underneath it.
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('keydown', cancel, true)
    return () => {
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('keydown', cancel, true)
    }
  }, [running])

  useEffect(() => {
    if (!running) return
    const total = seconds * 1000
    const started = performance.now()
    // A ring that sweeps smoothly is motion for its own sake. Under
    // reduced-motion it still counts — it just steps once a second.
    const stepped = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let raf = 0
    let done = false

    const tick = () => {
      const elapsed = performance.now() - started
      const left = Math.max(0, 1 - elapsed / total)
      setProgress(stepped ? Math.ceil(left * seconds) / seconds : left)
      if (elapsed >= total) {
        // Guarded rather than trusted: a frame landing after the fire would
        // otherwise close the round a second time.
        if (!done) {
          done = true
          fire.current()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, seconds])

  return {
    running,
    progress,
    remaining: Math.ceil(progress * seconds),
    cancel: () => setCancelled(true),
  }
}

/** The draining ring. Purely a readout of `useAutoSubmit` — it owns no timer. */
export function CountdownRing({
  progress,
  size = 26,
  stroke = 3,
}: {
  progress: number
  size?: number
  stroke?: number
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  return (
    <svg
      className="tk-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle className="tk-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
      <circle
        className="tk-ring-head"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The rules sheet lives in its own file — it is a screenful of markup with no
 * dependency on anything else here — and is re-exported so every consumer
 * still imports one React entry point.
 */
export { RulingsList } from './triage.js'

export {
  RulesSheet,
  type RuleEntry,
  type RuleSection,
} from './rules.js'

export { ScorePad, closedRounds, signed } from './scorepad.js'

export { TakeSeat } from './takeseat.js'

export { TableBoard, WaitingOn } from './board.js'

export {
  NoteBox,
  NOTES_COLLECTION,
  isOwner,
  saveNote,
  type NoteStamp,
  type NoteStore,
} from './notes.js'
