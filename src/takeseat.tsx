/**
 * Sitting down without leaving the screen you are on.
 *
 * ── The problem this exists for ──────────────────────────────────────────
 * The host makes a game, shows the code, closes it, and watches the lobby
 * fill — from the host screen. Their own name is not in that list, because
 * hosting a game and playing in one are different acts. So far so right.
 *
 * What was wrong was the way back in. "Take a seat" pushed the join URL and
 * swapped the whole app into the guest view: the lobby the host was watching
 * disappeared, a screen asked who they were, and they arrived at a SECOND
 * lobby — same seat list, same join code, same start button. Two taps and a
 * screen change to do something that reads, from a chair, as one small act.
 *
 * The report that produced this: *"it feels like I sit down and start the game
 * at the same time."* Nothing was starting the game — the seat claim and
 * `startGame` were always separate calls — but a transition that erases the
 * screen you were waiting on erases the sense of still waiting, and what is
 * left is a commit.
 *
 * So the claim happens where the host already is. Their name lands in the list
 * they are already watching, and the start button they are already looking at
 * comes alive. Two moments, one screen, in the order the table experiences
 * them.
 *
 * ── Why this is the kit's ────────────────────────────────────────────────
 * All three apps had the identical two-lobby shape, differing only in wording.
 * That is the second seam test — if all three already have a near-identical
 * copy of it, it is kit — and it is the same test that moved the rules sheet
 * and the auth gate in v0.21.0.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 * It never mints a credential, never writes a seat, and never learns what a
 * game is. `onOpen` and `onClaim` are the app's, because which client does the
 * writing is the app's business: a host's phone holds a host credential AND a
 * guest one, and only the app knows the handshake between them.
 */

import { useState, type ReactNode } from 'react'
import {
  recalledSeats,
  rememberSeat,
  seatChoices,
  type RecalledSeat,
  type SeatCandidate,
  type SeatedLike,
} from './roster.js'

export function TakeSeat<R extends SeatCandidate, S extends SeatedLike>({
  appKey,
  players,
  roster,
  onOpen,
  onClaim,
  onReclaim,
  label = 'Take a seat',
  openingLabel = 'One moment…',
  heading,
  className = 'btn big primary',
}: {
  appKey: string
  /** Who is already sitting. Their names come off the roster list. */
  players: S[]
  /**
   * The host's roster. May be empty on first render — `onOpen` is where it
   * gets loaded, and an empty roster costs the shortcuts and nothing else.
   */
  roster: R[]
  /**
   * Run once, when the panel is opened, before any name is shown.
   *
   * This is where an app loads the roster and does whatever handshake taking a
   * seat requires of it. Async and allowed to throw: a failure shows here and
   * shuts the panel rather than offering a list of names that cannot be
   * tapped.
   */
  onOpen?: () => Promise<void> | void
  onClaim: (name: string, rosterEntry?: string) => Promise<void>
  /** Take over a seat that already exists — see the note on `free` below. */
  onReclaim: (seat: S) => Promise<void>
  /** The game's wording for the act. "Take a seat", "Play this one too". */
  label?: string
  openingLabel?: string
  /** Optional line above the choices, once the panel is open. */
  heading?: ReactNode
  /** The shut button's classes. The act's weight is the screen's to decide. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [typing, setTyping] = useState(false)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  // Read when the panel opens rather than on mount. This component spends most
  // of its life as a single shut button on a screen that polls every three
  // seconds, and a value read on mount there is a value read for nothing.
  const [recalled, setRecalled] = useState<RecalledSeat[]>([])

  const { suggested, reclaimable, list, hiddenCount, searchable } = seatChoices({
    roster,
    seated: players,
    recalled,
    query,
  })

  /**
   * Only the seats nobody's phone is holding.
   *
   * ⚠️ An OCCUPIED seat is not offered here, and that is the one thing this
   * panel does less than the full `SeatClaim` screen. Taking over an occupied
   * seat is the recovery path — a returning player on a new phone, or one
   * whose storage was wiped — and it needs the confirm that explains what is
   * about to happen ("that seat is already on someone's phone"). A confirm
   * folded into a panel inside a lobby is a dialog inside a list inside a
   * screen, which is where a mis-tap costs somebody their score.
   *
   * The phone that needs it lands on the join screen anyway: it has no seat,
   * so it scans the code like everyone else. This is the host sitting down at
   * their own table, which is a different job.
   *
   * An UNCLAIMED seat has no such risk and is exactly the common case — the
   * host added themselves as a phoneless seat a minute ago and is now picking
   * up their phone. `SeatClaim` skips the confirm for these too.
   */
  const free = reclaimable.filter((p) => !p.device_id)
  const anyToPick = suggested.length + free.length + list.length > 0

  async function begin() {
    setFailed('')
    setOpening(true)
    try {
      await onOpen?.()
      // After `onOpen`, never before: an app that mints a credential in there
      // has, by the time it returns, changed what this phone can be told about
      // itself.
      setRecalled(recalledSeats(appKey))
      setOpen(true)
    } catch (e: any) {
      setFailed(e?.response?.message || e?.message || 'Could not open the seats. Tap to try again.')
    } finally {
      setOpening(false)
    }
  }

  /**
   * Always surface a failure.
   *
   * A rejected write must never leave the button looking merely inert — the
   * host taps, nothing happens, and there is nothing on screen to say why.
   */
  async function run(fn: () => Promise<void>, remember: { id?: string; display_name: string }) {
    setBusy(true)
    setFailed('')
    try {
      await fn()
      rememberSeat(appKey, remember)
      // Shut on the way out. The screen underneath is about to redraw with a
      // seat list that has this name in it, and that list is the answer — a
      // panel still standing open over it is asking a question that has been
      // answered.
      setOpen(false)
      setTyping(false)
      setName('')
      setQuery('')
    } catch (e: any) {
      setFailed(e?.response?.message || e?.message || "That didn't save. Tap to try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <>
        {failed && <p className="error">{failed}</p>}
        <button className={className} disabled={opening} onClick={begin}>
          {opening ? openingLabel : label}
        </button>
      </>
    )
  }

  return (
    <section className="card tk-take-seat">
      {heading}
      {failed && <p className="error">{failed}</p>}

      {!typing && (suggested.length > 0 || free.length > 0) && (
        <>
          {free.map((p) => (
            <button
              key={p.id}
              className="btn big"
              disabled={busy}
              onClick={() =>
                run(() => onReclaim(p), { id: p.roster_entry, display_name: p.display_name })
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
                run(() => onClaim(r.display_name, r.id), { id: r.id, display_name: r.display_name })
              }
            >
              I'm {r.display_name}
            </button>
          ))}
          <p className="fine">Last played on this phone.</p>
        </>
      )}

      {!typing && (list.length > 0 || searchable) && (
        <>
          {(suggested.length > 0 || free.length > 0) && <h2>Or someone else</h2>}
          {/* Never autofocused. A keyboard that throws itself up is exactly the
              fussing this panel exists to remove, and the host is holding the
              phone flat on a table with people watching it. */}
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
              {hiddenCount} more {hiddenCount === 1 ? 'name' : 'names'} — type a letter to find them.
            </p>
          )}
        </>
      )}

      {typing ? (
        <>
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
          <button
            className="btn big"
            disabled={busy || !name.trim()}
            onClick={() => run(() => onClaim(name), { display_name: name.trim() })}
          >
            {busy ? 'Taking a seat…' : "That's me"}
          </button>
          {anyToPick && (
            <button className="btn ghost" disabled={busy} onClick={() => setTyping(false)}>
              Back to the list
            </button>
          )}
        </>
      ) : (
        /* Quiet when there are names to pick, loud when there are not.
           ⚠️ Three tiers in this panel and they must stay in this order: the
           NAMES are the act, this is the escape hatch, and Never mind below is
           the way out. Drawn at `btn big` it outshouted the list it was an
           alternative to — the first thing the eye landed on was the one
           button that was wrong for almost everybody. */
        <button
          className={anyToPick ? 'btn ghost' : 'btn big'}
          disabled={busy}
          onClick={() => setTyping(true)}
        >
          {anyToPick ? "My name isn't here" : 'Type your name'}
        </button>
      )}

      {/* Shutting the panel must always be one tap away and must never be the
          loudest thing in it. The host opened this to sit down; the way out is
          for the case where they opened it by accident. */}
      <button className="linklike center-text" disabled={busy} onClick={() => setOpen(false)}>
        Never mind
      </button>
    </section>
  )
}
