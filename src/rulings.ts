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
 * Words that carry no signal about what a question was ABOUT.
 *
 * Deliberately short and generic. Every word that goes in here is a word two
 * questions can no longer be told apart by, so the list stops at the ones that
 * appear in nearly every question somebody types at a card table.
 */
const NOISE = new Set([
  'a', 'about', 'after', 'all', 'am', 'an', 'and', 'any', 'anyone', 'are', 'as', 'at',
  'be', 'been', 'before', 'but', 'by', 'can', 'cant', 'could', 'did', 'do', 'does', 'doesnt',
  'dont', 'for', 'from', 'get', 'gets', 'go', 'goes', 'had', 'has', 'have', 'he', 'her',
  'him', 'his', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not',
  'of', 'on', 'one', 'or', 'our', 'out', 'over', 'own', 'say', 'says', 'she', 'should', 'so',
  'some', 'somebody', 'someone', 'still', 'that', 'the', 'their', 'them', 'then', 'there',
  'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your',
])

/**
 * What a question is about, reduced to the words that carry it.
 *
 * Lowercased, stripped of punctuation, de-pluralised crudely (a trailing `s`
 * goes, so "cards" and "card" are the same thing) and emptied of noise words.
 * Crude on purpose — see `sameQuestion`.
 */
export function questionTerms(question: string): Set<string> {
  const terms = new Set<string>()
  for (const raw of String(question).toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, '')
    if (word.length < 2) continue
    // Crude, and it earns its keep: pepper/peppers, card/cards, row/rows.
    const stem = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
    if (NOISE.has(stem) || NOISE.has(word)) continue
    terms.add(stem)
  }
  return terms
}

/**
 * Are these two questions the same question?
 *
 * ⚠️ **Biased hard towards saying no**, and that is the whole design. Getting
 * this wrong in one direction costs nothing — you are back to noticing repeats
 * yourself, which is where this started. Getting it wrong in the other tells
 * you three people asked something one person asked, and a rulebook entry gets
 * written for an argument that never happened twice.
 *
 * So: at least two shared subject words, and a third of everything either
 * question is about. It will miss a rephrasing ("what happens if I pass" vs
 * "can you pass a turn") and it is meant to.
 */
export function sameQuestion(a: string, b: string): boolean {
  const left = questionTerms(a)
  const right = questionTerms(b)
  if (left.size === 0 || right.size === 0) return false

  let shared = 0
  for (const term of left) if (right.has(term)) shared++
  if (shared < 2) return false

  const union = new Set([...left, ...right]).size
  return shared / union >= 0.34
}

/** How many times something like this has been asked and settled before. */
export function askedBefore(question: string, past: { question: string }[]): number {
  return past.filter((p) => sameQuestion(question, p.question)).length
}

/** `2nd`, `3rd`, `4th` — for saying which time this is. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  // 4 through 9 fall off the end of the array and take the default.
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
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
 * Everything already settled — dismissed or written into the rulebook.
 *
 * Read for one reason: so an open question can say it is not the first of its
 * kind. Dismissing the first time somebody asks something is the CORRECT move
 * under the triggers in §5 — one person not finding a rule is one person — but
 * it also puts that question somewhere nothing will ever count it again. This
 * is what counts it.
 */
export async function pastRulings(
  pb: RulingStore,
  collection: string,
): Promise<RulingRec[]> {
  const rows = await pb.collection(collection).getFullList({
    filter: 'status != "new"',
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
