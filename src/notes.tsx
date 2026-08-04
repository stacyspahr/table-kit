/**
 * Notes to self — the one thing in the suite that is not for the table.
 *
 * Something is wrong with the app and you notice it mid-hand, with four people
 * waiting on you. The note is thirty seconds of thought that evaporates by the
 * time the night is over, and the alternative is to stop the game and type it
 * into something else, which nobody does. So: one box, inside the app, and the
 * note finds you again by mail once the game is finished.
 *
 * ── Why there is no dictation code in here ────────────────────────────────
 * The obvious build is a microphone button on the Web Speech API. Do not. iOS
 * Safari's support for it is the flaky path, it wants a permission prompt
 * mid-game, and it would be a second way to do a thing the phone already does
 * perfectly: the iOS keyboard has a mic key, and holding it dictates into any
 * focused textarea. So this ships a plain `<textarea>` and gets dictation for
 * free — offline, no permission, no library, and it degrades to typing on a
 * phone whose owner prefers to type.
 *
 * ── Who can see it ───────────────────────────────────────────────────────
 * ⚠️ The OWNER, and that is not the same thing as the host. Anybody who runs a
 * game night is a host; these notes are one person's inbox, and a second host
 * filing into it would be filing into somebody else's mail. `isOwner` decides
 * whether the button is drawn — but the button is not the gate. The collection
 * rule is, and it names the same address server-side, because a control that
 * is merely not rendered is still reachable by anybody who opens the console.
 *
 * ── The stamp is most of the value ───────────────────────────────────────
 * A note that says "the totals looked wrong" is worth nothing six weeks later.
 * The same note carrying the app, the game and the round number is a thing
 * somebody can go and look at. None of that is worth asking a person for at a
 * card table, and all of it is already on the screen, so it is attached here
 * rather than typed.
 */

import { useState } from 'react'

/**
 * Just enough of PocketBase to file one.
 *
 * ⚠️ The auth record is typed as an open bag rather than as `{ email?: string }`.
 * The narrow version reads better and does not compile: PocketBase's own
 * `AuthRecord` is an index-signature type, and TypeScript's weak-type check
 * rejects assigning it to an all-optional interface it shares no declared
 * property with. This is the shape that accepts the real client.
 */
export interface NoteStore {
  authStore: { record?: Record<string, any> | null }
  collection(name: string): {
    create(data: Record<string, unknown>): Promise<any>
  }
}

/** The collection every scorer files into. One table, an `app` column. */
export const NOTES_COLLECTION = 'table_notes'

/**
 * Is the person on this phone the one whose inbox this is?
 *
 * Compared case-insensitively and trimmed: an address typed at sign-up with a
 * stray capital is the same person, and being quietly not-the-owner because of
 * one is the kind of thing that never gets diagnosed.
 *
 * A guest auth record has no email at all, which is exactly the answer wanted.
 */
export function isOwner(pb: NoteStore, owner: string | undefined): boolean {
  const mine = pb.authStore.record?.email?.trim().toLowerCase()
  const theirs = owner?.trim().toLowerCase()
  return Boolean(mine && theirs && mine === theirs)
}

export interface NoteStamp {
  /** The app slug — `heat`, `flip7`, `nine`. */
  app: string
  /** The game record's id, so the mail can go out when that game ends. */
  game: string
  /** What the table was playing for, in words, for the mail's subject line. */
  game_label?: string
  /** The round on screen when the note was written. 0 for none. */
  round?: number
}

export async function saveNote(pb: NoteStore, stamp: NoteStamp, body: string): Promise<void> {
  await pb.collection(NOTES_COLLECTION).create({
    ...stamp,
    round: stamp.round ?? 0,
    game_label: stamp.game_label ?? '',
    body: body.trim(),
    sent: false,
  })
}

export function NoteBox({
  pb,
  stamp,
  onClose,
  title = 'Note to self',
}: {
  pb: NoteStore
  stamp: NoteStamp
  onClose: () => void
  title?: string
}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!body.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await saveNote(pb, stamp, body)
      // Cleared rather than closed. Two thoughts arrive together more often
      // than one does, and a box that shuts on save makes the second one cost
      // a tap through a menu — by which time it is gone.
      setBody('')
      setSaved(true)
    } catch (e: any) {
      setError(e?.response?.message || 'Could not save that note.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card tk-note">
      <h2>{title}</h2>
      <p className="fine">
        {stamp.round
          ? `Stamped with round ${stamp.round} of this game. Mailed to you when the game finishes.`
          : 'Stamped with this game. Mailed to you when the game finishes.'}
      </p>

      {/* Hold the mic key on the keyboard to talk it in. Said out loud because
          the keyboard's own affordance is easy to forget you have. */}
      <textarea
        className="tk-note-body"
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setSaved(false)
        }}
        rows={4}
        placeholder="What did you notice? Type it, or hold the mic key and say it."
        aria-label="Your note"
      />

      {error && <p className="error">{error}</p>}
      {saved && !body && <p className="fine tk-note-ok">Saved. Add another if you want.</p>}

      <button className="btn primary" disabled={!body.trim() || saving} onClick={save}>
        {saving ? 'Saving…' : 'Save the note'}
      </button>
      <button className="btn ghost" onClick={onClose}>
        {saved ? 'Done' : 'Never mind'}
      </button>
    </section>
  )
}
