/**
 * The review list — every question the adviser was asked, and what to do about
 * it.
 *
 * Phase B of `beat-the-heat/docs/RULINGS_SPEC.md`. Phase A kept the questions;
 * this is where somebody reads them, and it is the whole feature for as long as
 * the volume stays where it is — it works with no mail at all, because the app
 * gets opened before a game night anyway.
 *
 * ── What it is NOT ────────────────────────────────────────────────────────
 * Not a transcript browser. Nobody wants to reread conversations, so the
 * question and the ruling are what you see, and the rest of the thread is one
 * tap under it for the times a follow-up was where the real question landed.
 *
 * ── The two piles ─────────────────────────────────────────────────────────
 * UNDECIDED wants thirty seconds of judgement, which can happen anywhere. TO DO
 * has been judged and is waiting on an edit to `rules/rulebook.js`, which needs
 * a machine with an editor. Different jobs on different days; shown together
 * they look like one endless list, which is how an inbox stops being opened.
 *
 * ⚠️ Host-only, and enforced by the collection rather than by this file. These
 * hold whatever somebody typed mid-argument.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { groupByNight } from './nights.js'
import {
  BUCKET_LABEL,
  completeRuling,
  decideRuling,
  dismissRuling,
  looksLikeGap,
  openRulings,
  splitRulings,
  type RulingRec,
  type RulingStore,
} from './rulings.js'

export function RulingsList({
  pb,
  collection,
  onClose,
  title = 'Questions asked',
}: {
  pb: RulingStore
  /** The app's rulings collection — `heat_rulings`, `f7_rulings`, … */
  collection: string
  onClose: () => void
  title?: string
}) {
  const [rulings, setRulings] = useState<RulingRec[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** Ids mid-write, so a double tap at a table can't fire twice. */
  const [busy, setBusy] = useState<string[]>([])

  useEffect(() => {
    let live = true
    openRulings(pb, collection)
      .then((list) => live && setRulings(list))
      .catch(() => live && setError('Could not load the questions.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [pb, collection])

  const { undecided, todo } = useMemo(() => splitRulings(rulings), [rulings])

  /**
   * Every button lands here. The optimistic move is deliberate: a decision is a
   * judgement already made, and re-rendering a row you have finished with while
   * a round trip completes is how a short list starts feeling slow.
   */
  async function act(id: string, run: () => Promise<RulingRec>, gone: boolean) {
    if (busy.includes(id)) return
    setBusy((b) => [...b, id])
    const before = rulings
    setError('')
    if (gone) setRulings((list) => list.filter((r) => r.id !== id))
    try {
      const updated = await run()
      if (!gone) {
        setRulings((list) => list.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      }
    } catch {
      // Put it back. A decision that silently didn't save is worse than one
      // that visibly didn't.
      setRulings(before)
      setError("That didn't save — try again.")
    } finally {
      setBusy((b) => b.filter((x) => x !== id))
    }
  }

  return (
    <div className="screen">
      <div className="sheet-top">
        <div className="sheet-head">
          <h1 className="screen-title">{title}</h1>
          <button className="linklike" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="fine center-text">Loading…</p>
      ) : rulings.length === 0 ? (
        /* The good state, and by far the most common one. It should read as
           finished rather than broken — an empty list here means every question
           anyone asked has been dealt with. */
        <p className="fine center-text">
          Nothing waiting. Anything asked of the adviser turns up here.
        </p>
      ) : (
        <>
          {undecided.length > 0 && (
            <Pile
              heading="To look at"
              rulings={undecided}
              render={(r) => (
                <>
                  <button
                    className="btn ghost"
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => decideRuling(pb, collection, r.id, 'rule'), false)}
                  >
                    {BUCKET_LABEL.rule}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => decideRuling(pb, collection, r.id, 'sheet'), false)}
                  >
                    {BUCKET_LABEL.sheet}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => dismissRuling(pb, collection, r.id), true)}
                  >
                    Nothing to do
                  </button>
                </>
              )}
            />
          )}

          {todo.length > 0 && (
            <Pile
              heading="Waiting on an edit"
              note="Decided already. Off the list once the rules have caught up."
              rulings={todo}
              render={(r) => (
                <>
                  <button
                    className="btn"
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => completeRuling(pb, collection, r.id), true)}
                  >
                    Done — the rules say it now
                  </button>
                  <button
                    className="linklike"
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => dismissRuling(pb, collection, r.id), true)}
                  >
                    Actually, nothing to do
                  </button>
                </>
              )}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * One pile, grouped into nights.
 *
 * By night rather than by date because game nights cross midnight — the same
 * 5am boundary the history uses, from the same helper, so a question asked at
 * 1am files under the evening that produced it rather than under tomorrow.
 */
function Pile({
  heading,
  note,
  rulings,
  render,
}: {
  heading: string
  note?: string
  rulings: RulingRec[]
  render: (r: RulingRec) => ReactNode
}) {
  const nights = useMemo(() => groupByNight(rulings, new Date()), [rulings])

  return (
    <section className="card">
      <h2>
        {heading}
        <span className="count"> {rulings.length}</span>
      </h2>
      {note && (
        <p className="fine" style={{ marginTop: 0 }}>
          {note}
        </p>
      )}
      {nights.map((night) => (
        <div key={night.key}>
          <p className="tk-ruling-night">{night.label}</p>
          {night.items.map((r) => (
            <Ruling key={r.id} ruling={r} actions={render(r)} />
          ))}
        </div>
      ))}
    </section>
  )
}

function Ruling({ ruling, actions }: { ruling: RulingRec; actions: ReactNode }) {
  const [open, setOpen] = useState(false)

  /**
   * Everything before the final answer. The last assistant turn is already
   * shown, and the question is the heading — so what is left under the tap is
   * the follow-ups, which is exactly the part worth having and not worth
   * showing by default.
   */
  const earlier = ruling.thread.slice(0, -1)
  const hasMore = earlier.length > 1

  return (
    <article className="tk-ruling">
      <p className="tk-ruling-q">{ruling.question}</p>

      <div className="tk-ruling-tags">
        {/* The free marker. Every scorer's prompt tells the adviser to SAY when
            the rulebook doesn't settle something, so its own words identify the
            one bucket that needs a new entry — no classifier, no second call. */}
        {looksLikeGap(ruling.answer) && <span className="tk-ruling-tag gap">not in the rulebook</span>}
        {ruling.context && <span className="tk-ruling-tag">{ruling.context}</span>}
        {ruling.bucket && <span className="tk-ruling-tag">{BUCKET_LABEL[ruling.bucket]}</span>}
      </div>

      <p className="tk-ruling-a">{ruling.answer || 'No answer was recorded.'}</p>

      {hasMore && (
        <button className="linklike" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide the rest' : `The rest of it (${earlier.length})`}
        </button>
      )}
      {open &&
        earlier.map((turn, i) => (
          <p key={i} className={`tk-ruling-turn ${turn.role}`}>
            {turn.content}
          </p>
        ))}

      <div className="tk-ruling-actions">{actions}</div>
    </article>
  )
}
