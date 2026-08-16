/**
 * The adviser behind the triage screen — its prompt, its schema, and the two
 * strings it reads.
 *
 * ── Why this is in the kit ────────────────────────────────────────────────
 * Everything about deciding what a question means for a rulebook is identical
 * across the suite: the three things it can mean, how often something has to be
 * asked before each is worth acting on, and the fact that whoever is reading
 * can't check the reasoning themselves. None of that is about peppers or dice.
 * What IS the game's is its rulebook, its name, and the handful of things its
 * players get wrong — and those arrive as arguments.
 *
 * Five apps with five copies of forty lines of prompt is five copies that drift
 * the first time one of them is improved.
 *
 * ⚠️ NO SDK HERE, on purpose. `table-kit/server` is plain strings and `fetch` so
 * it can be imported from a Vercel function without dragging a client library
 * into every app that only wanted the gate. This module hands back a prompt and
 * a schema; the app makes the call.
 */

/** What the model must fill in. Mirrors `RulingAdvice` in `advice.ts`. */
export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    bucket: {
      type: 'string',
      enum: ['rule', 'sheet', 'nothing'],
      description: 'Which of the three things this question means for the rulebook.',
    },
    headline: {
      type: 'string',
      description:
        'The recommendation in one sentence — what you would say out loud across the table.',
    },
    because: {
      type: 'string',
      description:
        'Why, in a sentence or two, written for somebody who does not know the game. For "sheet", say what you would change about FINDING it — the heading, the order, or the words they would have searched for.',
    },
    rulebook: {
      type: 'string',
      description:
        'The existing entry that already answers this, quoted from the rulebook. Empty string if nothing covers it.',
    },
    draft: {
      type: 'string',
      description:
        'Wording for the entry that should exist, ready to paste into the rulebook. Empty string unless the bucket is "rule".',
    },
  },
  required: ['bucket', 'headline', 'because', 'rulebook', 'draft'],
  additionalProperties: false,
} as const

export interface TriagePromptOptions {
  /**
   * The game, as the model should think of it — publisher and year included
   * when there is one. "Play Nine (Double A Productions, 2006) — the card game
   * of golf".
   */
  game: string
  /** `RULEBOOK_TEXT` — the same string the ask endpoint sends. */
  rulebook: string
  /**
   * The handful of things this game's players get wrong, in prose.
   *
   * Worth its space for one reason: these are the questions that get asked, and
   * a question about one of them is very likely ALREADY covered — which is the
   * bucket the whole feature exists to catch and the one an unprompted model
   * reaches for last.
   */
  hotspots?: string
  /** Anything else true of this game's rulebook — errata, a missing publisher. */
  note?: string
}

/**
 * The prompt.
 *
 * Must stay byte-identical between requests or the cache misses, so nothing
 * per-question goes in it — the question rides on the user turn, from
 * `triageBrief`.
 */
export function triageSystemPrompt({ game, rulebook, hotspots, note }: TriagePromptOptions): string {
  return `You are helping the host of a game night work out what to do about a question somebody put to the rules official during a game of ${game}.

Here is the rulebook. It is the complete ruleset — treat it as the only authority.

<rulebook>
${rulebook}
</rulebook>

The person reading you does NOT know this game's rules well. Assume they cannot check your reasoning themselves, and that they are the one who will have to explain the decision at the next game night. That is why you quote the rulebook rather than summarising it: the quote is the evidence, and it is the only part of your answer they can verify.

Every question lands in exactly one of three places, and picking the right one is the whole job:

"sheet" — the rulebook DOES cover this, and covers it clearly. Somebody just didn't find it. This is the most valuable answer you can give and the one most often missed, so check for it first and check properly: read the rulebook for what the question is actually about, not for its wording. The fix is not a new rule — it is making the existing entry easier to find, which means its heading, its position in the sheet, or the words somebody would search for. Say which of those you'd change.

"rule" — the rulebook genuinely does not settle it, or it settles it in wording loose enough that two people at the table read it two different ways. Both end in editing the rulebook, so both are "rule". Draft the entry. Say plainly which of the two it is, because a gap gets a new entry and an ambiguity gets an existing one tightened.

"nothing" — strategy, who won, an off-topic question, a one-off that will never come up again, or a question the official already answered fine and that implies no change at all. This is a perfectly good answer and often the right one. An inbox that never empties is one they stop opening, so do not manufacture work.

How often something has been asked changes the answer, and it changes it differently per bucket:

A genuine gap is worth acting on the FIRST time. The official has already told them a rule was missing and given a call they then played by, so the table is already running on an unwritten rule.

"Covered but not found" and "ambiguous" want two or three asks before touching anything. One person not finding a rule is one person; three is the sheet's fault. If you are told this is the first time something like this has come up and the rulebook covers it clearly, "nothing" is usually the honest answer — say what the rulebook says, and say it is worth watching for a repeat rather than changing anything now.

Some entries in the rulebook are tagged as a table ruling or a table convention. Those are not printed rules — they are how these particular people settled on playing. A question about one of them is worth reading differently: a convention that keeps causing questions is a convention the table may want to change rather than a rule to write more clearly, and it is theirs to change. Say which it is when it matters.
${hotspots ? `\n${hotspots.trim()}\n` : ''}${note ? `\n${note.trim()}\n` : ''}
Write for a phone screen. Plain sentences, no headers, no bullet lists, no restating the question back. Every field you fill in gets read in full, so a long one costs more than it is worth.`
}

/** One question, as the model should read it. */
export interface TriageSubject {
  question: string
  answer: string
  context: string
  askedBefore: number
}

/**
 * The question on its own turn, after the cache breakpoint.
 *
 * How often it has come up is stated even when the answer is "never", because
 * the triggers above turn on it — left unsaid, a first ask and a fourth look
 * identical and the per-bucket rules have nothing to bite on.
 */
export function triageBrief(subject: TriageSubject): string {
  const lines = ['Somebody asked the rules official this during a game:', '', subject.question]
  if (subject.context) lines.push('', `They were at: ${subject.context}`)
  if (subject.answer) lines.push('', 'The official answered:', '', subject.answer)
  lines.push(
    '',
    subject.askedBefore > 0
      ? `Something like this has been asked and settled ${subject.askedBefore} time(s) before.`
      : 'Nothing like this has come up before.',
  )
  return lines.join('\n')
}

/**
 * The advice as the host read it on the screen.
 *
 * Goes back in as the assistant's own turn when a follow-up is asked, so the
 * model is being questioned about what the person actually read rather than
 * about the JSON it emitted.
 */
export function adviceAsSpoken(advice: any): string {
  const parts = [clip(advice?.headline), clip(advice?.because)]
  const quote = clip(advice?.rulebook)
  const draft = clip(advice?.draft)
  if (quote) parts.push(`The rulebook already says: ${quote}`)
  if (draft) parts.push(`Suggested wording: ${draft}`)
  return parts.filter(Boolean).join('\n\n') || 'No recommendation was recorded.'
}

function clip(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
