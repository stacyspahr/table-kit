/**
 * Rulings — the questions people put to the adviser, on their way to changing
 * the rulebook.
 *
 * Capture is phase A (`gate.logRuling` in server.ts); this is phase B, the
 * reading of them. Full design in `beat-the-heat/docs/RULINGS_SPEC.md`.
 *
 * ── Why this is in the kit ────────────────────────────────────────────────
 * Nothing here knows what a pepper is. A question, an answer, a decision about
 * which of four things to do about it — that shape is identical for every game
 * in the suite, and the moment a second scorer wanted it, a copy would drift.
 *
 * ── The one idea worth carrying ───────────────────────────────────────────
 * A question is not automatically a missing rule. Four things can be true of
 * one, and only one of them means write a new entry:
 *
 *   gap       the rulebook genuinely doesn't cover it   → a new entry
 *   ambiguous it's in there, worded two ways            → tighten the entry
 *   covered   it's in there and clear; nobody found it  → fix the SHEET
 *   nothing   strategy, off-topic, a one-off            → dismiss
 *
 * The middle two both end in editing text that already exists, so the triage
 * offers three choices rather than four. The one that matters is the third: if
 * three people ask something the rulebook already answers plainly, a fourth
 * entry saying it again makes the sheet longer and no clearer.
 */

/** One turn of the conversation as it was stored. */
export interface RulingTurn {
  role: string
  content: string
}

/** What the host decided to do about a question. Empty until they decide. */
export type RulingBucket = '' | 'rule' | 'sheet'

/**
 * A ruling as the collection stores it.
 *
 * `status` is the lifecycle and `bucket` is the verdict, which are genuinely
 * different questions: a ruling can be decided ("needs a rule") and still be
 * open, because the rulebook edit has not happened yet.
 */
export interface RulingRec {
  id: string
  created: string
  question: string
  answer: string
  /** The table context that was sent — the goal, the mode, the hole. */
  context: string
  thread: RulingTurn[]
  /** `new` is open, `kept` means the edit was made, `dismissed` means no. */
  status: string
  bucket: RulingBucket
  asker_role: string
  game: string
}

/**
 * Where an app's rulings live, from its GUEST collection.
 *
 * ⚠️ Derived from `guests` and never from the app slug, exactly as
 * `createGate` does it: Flip 7's slug is `flip7` while its collections are
 * `f7_*`, so `${app}_rulings` names a collection that does not exist.
 */
export function rulingsCollection(guests: string): string {
  return `${guests.replace(/_guests$/, '')}_rulings`
}

/** Anything still wanting a decision or an edit. */
export const OPEN_RULINGS_FILTER = 'status = "new"'

/**
 * Does this answer say the rulebook came up short?
 *
 * The single highest-signal thing available, and it costs nothing: every
 * scorer's system prompt instructs the adviser that when the rulebook does not
 * settle a question it must SAY so in one sentence before giving a call anyway.
 * So the answer already stored carries the marker, and no classifier, no second
 * model call and no extra wait at the table is needed to find it.
 *
 * ⚠️ A hint, not a verdict. It is prose matching, so it can miss a phrasing —
 * which is why the buckets are chosen by a person and this only nudges. It must
 * never be used to file something automatically.
 */
export function looksLikeGap(answer: string): boolean {
  const text = answer.toLowerCase()
  return [
    "rulebook doesn't cover",
    'rulebook does not cover',
    "rules don't cover",
    'rules do not cover',
    "doesn't cover this",
    'does not cover this',
    "isn't covered",
    'is not covered',
    "rulebook doesn't say",
    'rulebook does not say',
    "rulebook doesn't settle",
    'rulebook does not settle',
  ].some((phrase) => text.includes(phrase))
}

/**
 * Split the open list into the two piles that want different things.
 *
 * `undecided` needs thirty seconds of judgement. `todo` has been judged and is
 * waiting on an edit to `rules/rulebook.js` — which is a different job, usually
 * on a different day, and mixing the two makes both look endless.
 */
export function splitRulings<T extends { bucket?: string }>(
  rulings: T[],
): { undecided: T[]; todo: T[] } {
  return {
    undecided: rulings.filter((r) => !r.bucket),
    todo: rulings.filter((r) => r.bucket === 'rule' || r.bucket === 'sheet'),
  }
}

/** What each verdict commits you to, in the host's words. */
export const BUCKET_LABEL: Record<'rule' | 'sheet', string> = {
  rule: 'Needs a rule',
  sheet: 'Fix the sheet',
}

/** Only the shape these need. A PocketBase client satisfies it; so does a test. */
export interface RulingStore {
  collection(name: string): {
    getFullList(opts?: Record<string, unknown>): Promise<any[]>
    update(id: string, data: Record<string, unknown>): Promise<any>
  }
}

/** Everything still open, newest first. */
export async function openRulings(
  pb: RulingStore,
  collection: string,
): Promise<RulingRec[]> {
  const rows = await pb.collection(collection).getFullList({
    filter: OPEN_RULINGS_FILTER,
    sort: '-created',
  })
  return rows.map(normalize)
}

/**
 * Record what this question turned out to be. It stays OPEN.
 *
 * Deciding is not doing: the rulebook is a file in a repo, so the edit happens
 * later on a machine with an editor. Clearing it here at the moment of decision
 * would file the decision and lose the job.
 */
export async function decideRuling(
  pb: RulingStore,
  collection: string,
  id: string,
  bucket: 'rule' | 'sheet',
): Promise<RulingRec> {
  return normalize(await pb.collection(collection).update(id, { bucket }))
}

/** The edit is made. Off the list. */
export async function completeRuling(
  pb: RulingStore,
  collection: string,
  id: string,
): Promise<RulingRec> {
  return normalize(await pb.collection(collection).update(id, { status: 'kept' }))
}

/**
 * Nothing to do. Off the list.
 *
 * ⚠️ This is the one that keeps the feature alive. An inbox that never empties
 * is an inbox you stop opening, so every ruling must be one tap from gone —
 * including, and especially, the ones that were never going to change anything.
 */
export async function dismissRuling(
  pb: RulingStore,
  collection: string,
  id: string,
): Promise<RulingRec> {
  return normalize(
    await pb.collection(collection).update(id, { status: 'dismissed', bucket: '' }),
  )
}

/**
 * PocketBase hands back whatever the record holds, and a row written before a
 * field existed holds nothing at all. Everything downstream renders these, so
 * they are defaulted once here rather than guarded at each use.
 */
function normalize(row: any): RulingRec {
  return {
    id: String(row?.id ?? ''),
    created: String(row?.created ?? ''),
    question: String(row?.question ?? ''),
    answer: String(row?.answer ?? ''),
    context: String(row?.context ?? ''),
    thread: Array.isArray(row?.thread) ? row.thread : [],
    status: String(row?.status ?? 'new'),
    bucket: (row?.bucket === 'rule' || row?.bucket === 'sheet' ? row.bucket : '') as RulingBucket,
    asker_role: String(row?.asker_role ?? ''),
    game: String(row?.game ?? ''),
  }
}
