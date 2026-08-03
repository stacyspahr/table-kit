/**
 * The rules sheet — every scorer's, one component.
 *
 * ── Why this is in the kit ────────────────────────────────────────────────
 * All three games had a copy of it, and the copies were identical apart from
 * the words: the same offline sheet over the same search box, the same ask
 * thread underneath. That is the definition of kit. What is NOT kit is the
 * rulebook itself and the voice around it — a game's rules, its adviser's name,
 * and the example question that teaches you how to ask are the game's, and they
 * all arrive as props.
 *
 * ── The two halves ────────────────────────────────────────────────────────
 * The SHEET is the whole rulebook, offline and instant. It answers the
 * questions that have a heading, for free, in a dead spot with no signal, on
 * anyone's phone. For a game given away in a printed box with no printed rules
 * it is also the only rulebook that will ever exist, so it is ordered as a
 * lesson and the search box serves the reference case.
 *
 * The ASK box is for the questions that don't have a heading — the ones that
 * start "she flipped a Freeze onto someone who'd already stayed". It costs
 * money and needs a network, so somebody has to be admitted to it; who, and on
 * what evidence, is the endpoint's business (see `createGate` in server.ts) and
 * this component only renders `canAsk`.
 *
 * ── Why they're tabs ──────────────────────────────────────────────────────
 * They were stacked, ask underneath, which came back off a real game night as
 * two complaints at once: reaching the ask box meant scrolling the entire
 * rulebook, and leaving the rulebook meant scrolling all the way back up to the
 * only way out. Tabs fix the first without demoting the lesson — the rulebook
 * is still what opens — and a sticky header fixes the second.
 *
 * ⚠️ Principle 1 holds here as everywhere. This says what the RULES say; it
 * never looks at the board, because the app only knows what somebody typed into
 * it.
 */

import { useMemo, useRef, useState } from 'react'

export interface RuleEntry {
  title: string
  body: string
  /** A key into `sourceLabel` — "printed rule", "table ruling", and so on. */
  source?: string
}

export interface RuleSection {
  id: string
  title: string
  entries: RuleEntry[]
}

type Turn = { role: 'user' | 'assistant'; content: string }

export function RulesSheet({
  sections,
  sourceLabel = {},
  onClose,
  canAsk,
  authToken,
  askContext,
  askEndpoint = '/api/ruling',
  adviser = 'rules official',
  askIntro = "For the ones the rulebook doesn't answer. Describe what happened.",
  askExample,
  title = 'Rules',
  searchPlaceholder = 'Search the rules',
}: {
  /** The rulebook, in teaching order. The game owns both the order and the words. */
  sections: RuleSection[]
  /** How a tagged entry is labelled — `{ printed: 'printed rule' }`. */
  sourceLabel?: Record<string, string>
  onClose: () => void
  /**
   * Whether this phone gets the Ask tab at all.
   *
   * ⚠️ Never the real gate. The endpoint checks again, because a client-side
   * boolean is a suggestion.
   */
  canAsk: boolean
  /**
   * The credential to present, read at the moment of asking.
   *
   * A function, not a string: a host's token is refreshed behind the app's
   * back, and a component holding the value it had at mount would eventually
   * present a dead one.
   */
  authToken?: () => string
  /**
   * Table context posted with every question — `{ goal: '66 peppers' }`,
   * `{ hole: 'Hole 4 of 9' }`. Merged into the body, so the endpoint names its
   * own fields.
   */
  askContext?: Record<string, unknown>
  askEndpoint?: string
  /** What this game calls the thing answering — "rules official", "umpire". */
  adviser?: string
  askIntro?: string
  /**
   * The example in the empty box. Worth its space: it teaches you to describe
   * what happened rather than ask "is that legal?", which is the difference
   * between a useful answer and a guess.
   */
  askExample?: string
  title?: string
  searchPlaceholder?: string
}) {
  const [tab, setTab] = useState<'rulebook' | 'ask'>('rulebook')
  const [query, setQuery] = useState('')

  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((section) => ({
        ...section,
        entries: section.entries.filter((e) =>
          `${e.title} ${e.body}`.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.entries.length > 0)
  }, [query, sections])

  const nothingFound = query.trim() !== '' && found.length === 0
  const asking = canAsk && tab === 'ask'

  return (
    <div className="screen">
      {/* Header and tabs are ONE sticky block. Sticking them separately puts
          the tabs behind the header as you scroll, which is worse than not
          sticking them at all. */}
      <div className="sheet-top">
        <header className="sheet-head">
          <h1>{title}</h1>
          {/* The way out, pinned. A rulebook is a long page, and backing out of
              one should never cost a scroll to the top. */}
          <button className="linklike" onClick={onClose}>
            Done
          </button>
        </header>

        {canAsk && (
          <div className="tabs" role="tablist" aria-label={title}>
            <button
              role="tab"
              aria-selected={tab === 'rulebook'}
              className={`tab ${tab === 'rulebook' ? 'on' : ''}`}
              onClick={() => setTab('rulebook')}
            >
              Rulebook
            </button>
            <button
              role="tab"
              aria-selected={tab === 'ask'}
              className={`tab ${tab === 'ask' ? 'on' : ''}`}
              onClick={() => setTab('ask')}
            >
              Ask
            </button>
          </div>
        )}
      </div>

      {asking && (
        <AskBox
          adviser={adviser}
          intro={askIntro}
          example={askExample}
          context={askContext}
          endpoint={askEndpoint}
          authToken={authToken}
          onReadTheSheet={() => setTab('rulebook')}
        />
      )}

      {!asking && (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />

          {nothingFound && (
            <p className="muted">
              Nothing in the rulebook matches that.
              {canAsk ? ' Try the Ask tab.' : ''}
            </p>
          )}

          {found.map((section) => (
            <section className="card" key={section.id}>
              <h2>{section.title}</h2>
              {section.entries.map((entry) => (
                <div className="rule" key={entry.title}>
                  <h3>
                    {entry.title}
                    {/* Marked rather than blended in: someone settling an
                        argument needs to know whether they're holding printed
                        rules or their own table's decision, because only one of
                        those is theirs to overrule. */}
                    {entry.source && (
                      <span className="pill source">
                        {sourceLabel[entry.source] ?? entry.source}
                      </span>
                    )}
                  </h3>
                  <p>{entry.body}</p>
                </div>
              ))}
            </section>
          ))}

          {!canAsk && (
            <p className="fine center-text">
              Stuck on something the rulebook doesn't cover? Ask the host — they
              can put it to the {adviser}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function AskBox({
  adviser,
  intro,
  example,
  context,
  endpoint,
  authToken,
  onReadTheSheet,
}: {
  adviser: string
  intro: string
  example?: string
  context?: Record<string, unknown>
  endpoint: string
  authToken?: () => string
  onReadTheSheet: () => void
}) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerRef = useRef<HTMLDivElement | null>(null)

  async function ask() {
    const text = question.trim()
    if (!text || busy) return

    const next: Turn[] = [...turns, { role: 'user', content: text }]
    setTurns(next)
    setQuestion('')
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: authToken() } : {}),
        },
        body: JSON.stringify({ messages: next, ...(context ?? {}) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Couldn't get a ruling.")
      setTurns([...next, { role: 'assistant', content: data.ruling }])
      // The answer lands below the fold on a phone; put it in front of them.
      requestAnimationFrame(() =>
        answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get a ruling.")
      setTurns(turns) // drop the unanswered question rather than stranding it
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card ask">
      <h2>Ask the {adviser}</h2>
      <p className="fine ask-intro">{intro}</p>

      {turns.length > 0 && (
        <div className="ask-thread">
          {turns.map((turn, i) => (
            <div key={i} className={`ask-turn ${turn.role}`}>
              {turn.content}
            </div>
          ))}
        </div>
      )}

      {/* Gone while it's thinking: an empty box is nothing you can act on until
          the answer lands, and it's the follow-up to an answer you haven't read
          yet. The button carries the state on its own.

          The example goes once there's a thread above it — at that point it
          reads as a third entry in the conversation instead of a hint. */}
      {!busy && (
        <textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={turns.length ? 'Ask a follow-up' : example}
          aria-label="Your rules question"
        />
      )}

      {error && <p className="error">{error}</p>}

      <button className="btn" onClick={ask} disabled={busy || !question.trim()}>
        {busy ? 'Thinking…' : 'Ask'}
      </button>

      {turns.length > 0 && (
        <button
          className="linklike center-text"
          onClick={() => {
            setTurns([])
            setError(null)
          }}
        >
          Start over
        </button>
      )}

      {/* This costs money and needs a signal; the sheet next door costs neither
          and already answers most of what gets typed in here. */}
      {turns.length === 0 && !busy && (
        <button className="linklike center-text" onClick={onReadTheSheet}>
          Or look it up in the rulebook
        </button>
      )}

      <div ref={answerRef} />
    </section>
  )
}
