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
import {
  ADVICE_LABEL,
  askAdviser,
  type AdviceBucket,
  type AdviceTurn,
  type RulingAdvice,
} from './advice.js'
import { groupByNight } from './nights.js'
import {
  BUCKET_LABEL,
  askedBefore,
  completeRuling,
  decideRuling,
  dismissRuling,
  looksLikeGap,
  openRulings,
  ordinal,
  pastRulings,
  splitRulings,
  type RulingRec,
  type RulingStore,
} from './rulings.js'

export function RulingsList({
  pb,
  collection,
  onClose,
  title = 'Questions asked',
  adviceEndpoint,
  authToken,
  adviser = 'rules official',
}: {
  pb: RulingStore
  /** The app's rulings collection — `heat_rulings`, `f7_rulings`, … */
  collection: string
  onClose: () => void
  title?: string
  /**
   * Where to ask what to do about a question — `/api/triage`.
   *
   * Optional, and the screen is whole without it: an app that hasn't got the
   * endpoint yet shows exactly the three buttons it always did. See
   * `advice.ts` for why it is worth having.
   */
  adviceEndpoint?: string
  /** The host credential to present. A function — tokens get refreshed. */
  authToken?: () => string
  /** What this game calls the thing answering. Its name, not a new one. */
  adviser?: string
}) {
  const [rulings, setRulings] = useState<RulingRec[]>([])
  /** Everything already settled, read only to count repeats. */
  const [past, setPast] = useState<RulingRec[]>([])
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
    // The archive is a nicety on top of the list, so its failure is silent —
    // no count is a worse screen, a broken one is a useless screen.
    pastRulings(pb, collection)
      .then((list) => live && setPast(list))
      .catch(() => {})
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
              past={past}
              adviceEndpoint={adviceEndpoint}
              authToken={authToken}
              adviser={adviser}
              /* The advice arrives as a suggestion on the buttons that were
                 always here — the recommended one loses its `ghost` and reads
                 as the thing to press. Deliberately not a fourth button that
                 does it for you: the tap is where the decision is recorded, and
                 it should stay a person's. */
              render={(r, advice) => (
                <>
                  <button
                    className={suggested(advice, 'rule')}
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => decideRuling(pb, collection, r.id, 'rule'), false)}
                  >
                    {BUCKET_LABEL.rule}
                  </button>
                  <button
                    className={suggested(advice, 'sheet')}
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => decideRuling(pb, collection, r.id, 'sheet'), false)}
                  >
                    {BUCKET_LABEL.sheet}
                  </button>
                  <button
                    className={suggested(advice, 'nothing')}
                    disabled={busy.includes(r.id)}
                    onClick={() => act(r.id, () => dismissRuling(pb, collection, r.id), true)}
                  >
                    {ADVICE_LABEL.nothing}
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
              past={past}
              /* No adviser here on purpose. This pile is waiting on an edit to
                 a file in a repo, and asking what to do about a question you
                 already decided is a second opinion nobody asked for. */
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
  past,
  render,
  adviceEndpoint,
  authToken,
  adviser,
}: {
  heading: string
  note?: string
  rulings: RulingRec[]
  /** Settled questions, for saying which time this one is. */
  past: RulingRec[]
  /** Given the advice too, so a recommendation can dress its own button. */
  render: (r: RulingRec, advice: RulingAdvice | null) => ReactNode
  adviceEndpoint?: string
  authToken?: () => string
  adviser?: string
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
            <Ruling
              key={r.id}
              ruling={r}
              past={past}
              render={render}
              adviceEndpoint={adviceEndpoint}
              authToken={authToken}
              adviser={adviser}
            />
          ))}
        </div>
      ))}
    </section>
  )
}

function Ruling({
  ruling,
  past,
  render,
  adviceEndpoint,
  authToken,
  adviser,
}: {
  ruling: RulingRec
  past: RulingRec[]
  render: (r: RulingRec, advice: RulingAdvice | null) => ReactNode
  adviceEndpoint?: string
  authToken?: () => string
  adviser?: string
}) {
  const [open, setOpen] = useState(false)
  /**
   * The advice, once it has been asked for. Per ruling, and never on mount:
   * this costs money and most questions get read without needing it, so it is
   * one tap rather than a page of them fired the moment the screen opens.
   */
  const [advice, setAdvice] = useState<RulingAdvice | null>(null)

  /**
   * Which time this is, counting everything already settled.
   *
   * ⚠️ The reason this exists: the triggers in §5 say a question about
   * something the rulebook already covers needs two or three before the sheet
   * is worth touching — and the correct handling of the first one is to dismiss
   * it, which is exactly what makes the second one impossible to recognise. The
   * count is the only thing standing between "wait for a repeat" and a rule you
   * can never act on.
   */
  const before = useMemo(() => askedBefore(ruling.question, past), [ruling.question, past])

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
        {before > 0 && (
          <span className="tk-ruling-tag again">
            {ordinal(before + 1)} time this has come up
          </span>
        )}
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

      {adviceEndpoint && (
        <AdviceBox
          endpoint={adviceEndpoint}
          authToken={authToken}
          adviser={adviser ?? 'rules official'}
          ruling={{
            question: ruling.question,
            answer: ruling.answer,
            context: ruling.context,
            askedBefore: before,
          }}
          advice={advice}
          onAdvice={setAdvice}
        />
      )}

      <div className="tk-ruling-actions">{render(ruling, advice)}</div>
    </article>
  )
}

/**
 * Which button the advice is pointing at.
 *
 * A recommendation shouldn't need a legend, so it dresses the button it means
 * rather than naming it somewhere else on the screen. No advice yet — or advice
 * for one of the other two — and every button looks exactly as it always did.
 */
function suggested(advice: RulingAdvice | null, bucket: AdviceBucket): string {
  return advice?.bucket === bucket ? 'btn' : 'btn ghost'
}

/**
 * "What should I do?" — and the conversation that sometimes follows.
 *
 * ── Why the follow-up box is here at all ──────────────────────────────────
 * The first answer is a verdict, and a verdict you can't interrogate is one you
 * either take on faith or ignore. Both are bad here: the whole point is that the
 * person reading it can't check the reasoning themselves, so "why isn't that
 * covered?" and "what would the new rule say?" are the questions that turn the
 * advice into something they can stand behind at the table.
 *
 * ⚠️ Every turn re-sends the whole rulebook, because the endpoint has no memory
 * between requests. That is what the prompt cache is for, and it is the reason
 * the subject and the advice ride on the request rather than being looked up.
 */
function AdviceBox({
  endpoint,
  authToken,
  adviser,
  ruling,
  advice,
  onAdvice,
}: {
  endpoint: string
  authToken?: () => string
  adviser: string
  ruling: { question: string; answer: string; context: string; askedBefore: number }
  advice: RulingAdvice | null
  onAdvice: (a: RulingAdvice) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [turns, setTurns] = useState<AdviceTurn[]>([])
  const [question, setQuestion] = useState('')

  async function firstLook() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await askAdviser({ endpoint, authToken, ruling })
      if (res.advice) onAdvice(res.advice)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't work that one out.")
    } finally {
      setBusy(false)
    }
  }

  async function followUp() {
    const text = question.trim()
    if (!text || busy || !advice) return

    const next: AdviceTurn[] = [...turns, { role: 'user', content: text }]
    setTurns(next)
    setQuestion('')
    setBusy(true)
    setError('')
    try {
      const res = await askAdviser({ endpoint, authToken, ruling, advice, followups: next })
      setTurns([...next, { role: 'assistant', content: res.reply ?? '' }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't work that one out.")
      // Drop the unanswered question rather than stranding it above nothing.
      setTurns(turns)
    } finally {
      setBusy(false)
    }
  }

  if (!advice) {
    return (
      <div className="tk-advice">
        <button className="linklike" disabled={busy} onClick={firstLook}>
          {busy ? 'Reading the rulebook…' : 'What should I do?'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="tk-advice">
      <p className="tk-advice-head">{advice.headline}</p>
      <p className="tk-advice-why">{advice.because}</p>

      {/* The evidence, not decoration. "Fix the sheet" means nothing until you
          can see the entry that already says it. */}
      {advice.rulebook && (
        <div className="tk-advice-quote">
          <span className="tk-advice-label">The rulebook already says</span>
          <p>{advice.rulebook}</p>
        </div>
      )}

      {advice.draft && (
        <div className="tk-advice-quote">
          <span className="tk-advice-label">Suggested wording</span>
          <p>{advice.draft}</p>
        </div>
      )}

      {turns.map((turn, i) => (
        <p key={i} className={`tk-advice-turn ${turn.role}`}>
          {turn.content}
        </p>
      ))}

      {error && <p className="error">{error}</p>}

      {!busy && (
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask the ${adviser} about this`}
          aria-label="Ask about this ruling"
        />
      )}

      <button className="linklike" disabled={busy || !question.trim()} onClick={followUp}>
        {busy ? 'Thinking…' : 'Ask'}
      </button>
    </div>
  )
}
