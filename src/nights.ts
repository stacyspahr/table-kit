/**
 * Grouping past games into the evenings they were played on.
 *
 * Every scorer needs this and none of it is game-specific: it looks at a
 * `created` stamp and nothing else, so it never has to know whether a round was
 * scored in peppers or cards. Both games wrote their own copy, and the two
 * copies drifted — different rollover hours, different labels, different date
 * formats — which meant the same Friday read differently depending on which app
 * you opened. This is the one implementation.
 *
 * ── Why a night is not a calendar day ────────────────────────────────────
 * Game nights cross midnight. Keyed on the calendar date, one evening splits in
 * half and the last two games get filed under tomorrow — which is the point at
 * which a history stops being readable. So a night runs 5am to 5am: anything
 * before 5am belongs to the evening that produced it.
 *
 * Five rather than midnight-plus-a-bit because it is comfortably past when any
 * card game ends and comfortably before anyone starts one.
 *
 * ── Why the labels don't say "tonight" ───────────────────────────────────
 * They used to, and it was wrong every time somebody played in the morning: a
 * game at 11:15am is not part of tonight, and calling it that made the history
 * look broken. "Today" is true at every hour, and it costs nothing — the clock
 * time is already on each row, so a glance tells you it was a morning game.
 *
 * The BUCKET is still a night. Only the label stopped pretending to know.
 */

/** Anything earlier than this hour belongs to the night before. */
const NIGHT_START_HOUR = 5

/**
 * PocketBase hands back `2026-07-31 16:07:46.900Z` — a space where ISO wants a
 * T. Safari is entitled to refuse that, and a history that works everywhere
 * except the phones this app runs on would be a poor joke.
 */
export function parseStamp(stamp: string): Date {
  return new Date(stamp.replace(' ', 'T'))
}

/**
 * Local `YYYY-MM-DD` of the night a moment belongs to.
 *
 * Local, deliberately. "The same night" is a question about the clock on the
 * wall where the game was played; keyed on the UTC date, a 9pm game files under
 * tomorrow for everyone west of Greenwich — which is every evening game this
 * has ever scored.
 */
export function nightKey(when: Date): string {
  const shifted = new Date(when.getTime() - NIGHT_START_HOUR * 60 * 60 * 1000)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const d = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * What to call a night.
 *
 * Today and Yesterday are the two anybody actually looks for. Everything older
 * gets a short date — long enough to place it, short enough not to wrap on a
 * phone — with the year only once it stops being obvious.
 */
export function nightLabel(key: string, now: Date): string {
  if (key === nightKey(now)) return 'Today'

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === nightKey(yesterday)) return 'Yesterday'

  // Midday, so the label can never be dragged into the previous day by a
  // timezone offset applied to a midnight timestamp.
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)
  const sameYear = date.getFullYear() === now.getFullYear()

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export interface Night<T> {
  /** Local `YYYY-MM-DD` of the night, 5am-to-5am. Stable across re-renders. */
  key: string
  /** "Today", "Yesterday", or a short date. */
  label: string
  /** Newest first, as they arrived. */
  items: T[]
}

/**
 * Group anything with a `created` stamp into nights, newest first.
 *
 * Order within a night is preserved from the input, which arrives newest-first
 * from PocketBase — so the last game of the evening sits at the top of its own
 * night, where you left it.
 */
export function groupByNight<T extends { created: string }>(
  items: T[],
  now: Date,
): Night<T>[] {
  const nights = new Map<string, T[]>()

  for (const item of items) {
    const key = nightKey(parseStamp(item.created))
    const bucket = nights.get(key)
    if (bucket) bucket.push(item)
    else nights.set(key, [item])
  }

  // Sorted rather than trusting insertion order: the caller's list is normally
  // newest-first, but a screen that merged two queries need not be, and a
  // history with December above January is the kind of thing nobody reports.
  return [...nights.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({ key, label: nightLabel(key, now), items: list }))
}

/** The clock time a game started — what tells two games on one night apart. */
export function timeOfDay(stamp: string): string {
  return parseStamp(stamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}
