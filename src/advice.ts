/**
 * Advice on a ruling — what to do about a question, from something that has
 * actually read the rulebook.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * `RULINGS_SPEC.md` §5 left the triage to a person, on the reasoning that it is
 * "ninety seconds, done by the one person who can actually judge which bucket a
 * question is in." That sentence carries an assumption it never states: that
 * whoever opens the list knows the game's rules well enough to say whether the
 * rulebook already covers what somebody asked.
 *
 * It often doesn't. These games arrive in 3D-printed boxes with no rulebook and
 * get played once a month; the host is frequently the person who knows them
 * LEAST well, because everyone else was busy playing while they ran the pad. So
 * the three buttons ask a question the person pressing them can't answer, and
 * an inbox you can't act on is an inbox you stop opening.
 *
 * ── Why the model can answer it and the screen can't ──────────────────────
 * The whole rulebook is already in the adviser's prompt — that is how the Ask
 * tab works at all. So the endpoint behind this can do the one thing the triage
 * screen never could: look up whether the question is already answered, and say
 * WHERE. That is the entire difference between "Needs a rule" and "Fix the
 * sheet", and it is a lookup, not a judgement.
 *
 * ⚠️ It recommends; it never files. `decideRuling` still runs off a tap, the
 * decision is still the host's, and `looksLikeGap` still tags what it tags.
 * Advice that filed itself would be a classifier writing the rulebook, which is
 * the one thing §5 is right to refuse.
 */

import { BUCKET_LABEL } from './rulings.js'

/**
 * Which of the three buttons this question is for.
 *
 * `rule` and `sheet` are `RulingBucket` verbatim; `nothing` is the third
 * button, which is a dismissal rather than a bucket and so has no `RulingBucket`
 * of its own. Kept as one type here because the advice has to be able to
 * recommend all three — "nothing to do" is a real answer and the commonest one.
 */
export type AdviceBucket = 'rule' | 'sheet' | 'nothing'

/** What the adviser made of one question. */
export interface RulingAdvice {
  bucket: AdviceBucket
  /** The recommendation in one line — what you'd say out loud. */
  headline: string
  /** Why, in words that don't assume you know the game. */
  because: string
  /**
   * The existing entry this question is already answered by, quoted.
   *
   * The load-bearing field. "Fix the sheet" is an unfollowable instruction
   * without it — fix WHAT? — and it is also the evidence for the claim, so a
   * host who does know the rules can see immediately when the advice is wrong.
   * Empty when nothing covers it.
   */
  rulebook: string
  /**
   * Wording for the entry that should exist. Empty unless one should.
   *
   * Here for the same reason as `rulebook`: being told to write a new rule is
   * not much use to somebody who couldn't tell whether one was missing.
   */
  draft: string
}

/**
 * The button each recommendation points at, in the host's words.
 *
 * Spread from `BUCKET_LABEL` rather than restated: a recommendation that names
 * a button by a different word than the button wears is a recommendation
 * nobody can follow, and two lists of the same three strings is how that
 * happens on the day one of them is reworded.
 */
export const ADVICE_LABEL: Record<AdviceBucket, string> = {
  ...BUCKET_LABEL,
  nothing: 'Nothing to do',
}

/** One turn of a follow-up conversation about a piece of advice. */
export interface AdviceTurn {
  role: 'user' | 'assistant'
  content: string
}

/** The ruling being asked about, reduced to what the endpoint needs. */
export interface AdviceSubject {
  question: string
  answer: string
  context?: string
  /** How many settled questions were like this one — `askedBefore`'s count. */
  askedBefore?: number
}

export interface AdviceRequest {
  endpoint: string
  /** Read at the moment of asking: a host's token is refreshed behind us. */
  authToken?: () => string
  ruling: AdviceSubject
  /**
   * The advice already given, when this is a follow-up.
   *
   * Sent back rather than held server-side because nothing here is a session —
   * the endpoint is a Vercel function with no memory between requests, and the
   * screen is the only thing that knows what it is looking at.
   */
  advice?: RulingAdvice
  /** The follow-up conversation so far. Empty means "advise me". */
  followups?: AdviceTurn[]
}

/**
 * Ask the endpoint what to do — or ask it a follow-up.
 *
 * One call for both because they are one conversation about one question, and
 * the expensive half of the prompt is the rulebook, which is identical either
 * way. Two endpoints would mean two copies of it.
 */
export async function askAdviser(
  req: AdviceRequest,
): Promise<{ advice?: RulingAdvice; reply?: string }> {
  const res = await fetch(req.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(req.authToken ? { Authorization: req.authToken() } : {}),
    },
    body: JSON.stringify({
      question: req.ruling.question,
      answer: req.ruling.answer,
      context: req.ruling.context ?? '',
      asked_before: req.ruling.askedBefore ?? 0,
      advice: req.advice ?? null,
      followups: req.followups ?? [],
    }),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || "Couldn't work that one out.")

  return {
    advice: data?.advice ? normalizeAdvice(data.advice) : undefined,
    reply: typeof data?.reply === 'string' ? data.reply : undefined,
  }
}

/**
 * An answer off the wire, made safe to render.
 *
 * ⚠️ `bucket` falls back to `nothing` rather than to a guess. Everything else
 * here is text on a screen, but the bucket decides which button gets
 * highlighted — and highlighting "Needs a rule" because a field arrived
 * malformed is how a rulebook grows an entry nobody meant to write.
 */
export function normalizeAdvice(raw: any): RulingAdvice {
  const bucket = raw?.bucket
  return {
    bucket: bucket === 'rule' || bucket === 'sheet' ? bucket : 'nothing',
    headline: String(raw?.headline ?? '').trim(),
    because: String(raw?.because ?? '').trim(),
    rulebook: String(raw?.rulebook ?? '').trim(),
    draft: String(raw?.draft ?? '').trim(),
  }
}
