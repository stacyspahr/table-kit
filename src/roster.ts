/**
 * Finding yourself on the seat-claim screen.
 *
 * The roster is permanent and never stops growing: every name anyone has ever
 * typed at this host's table stays on it forever, deliberately, because it is
 * what joins a returning player to their lifetime stats. That is right for the
 * data and wrong for the screen — after a season it is a forty-name scroll
 * standing between a player and sitting down.
 *
 * Two things fix it, and both live here because neither is about a particular
 * game:
 *
 * 1. THE PHONE REMEMBERS. Almost everyone arrives on the same handset they
 *    used last time, so the name they want is knowable before they touch
 *    anything. One tap, no list.
 * 2. THE LIST IS SHORT AND SEARCHABLE. Whoever the phone doesn't know gets a
 *    handful of names and a box to type in, instead of the whole history.
 *
 * No markup here — every app in the suite is themed differently, so the kit
 * ships the decisions and each game draws them.
 */

/** The shape this module needs from a roster entry. Games carry more. */
export interface SeatCandidate {
  id: string
  display_name: string
}

/** The shape this module needs from a seat at the current table. */
export interface SeatedLike {
  id: string
  display_name: string
  device_id?: string
  roster_entry?: string
}

/** A name this phone has sat down as before. */
export interface RecalledSeat {
  /**
   * Roster entry id, when the seat was claimed by tapping a roster name.
   * Empty when the player typed a new name — the entry is created server-side
   * after the fact, so there is nothing to record at that moment. The name is
   * the fallback match, and the reason this is best-effort rather than an id
   * lookup.
   */
  id: string
  display_name: string
  /** Ordering only, never displayed. */
  at: number
}

/**
 * How many names this phone keeps. Three covers the household phone that gets
 * handed round — beyond that it stops being a shortcut and becomes another
 * list to read.
 */
const MAX_RECALLED = 3

function storageKey(appKey: string): string {
  return `${appKey}_recent_seats`
}

function norm(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Names this phone has played as, most recent first.
 *
 * Storage is a convenience and never a requirement: a guest runs in a tab the
 * OS discards and may have had its storage evicted, so every failure here
 * degrades to "this phone doesn't know you" and the full list.
 */
export function recalledSeats(appKey: string): RecalledSeat[] {
  try {
    const raw = localStorage.getItem(storageKey(appKey))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s): s is RecalledSeat =>
          !!s && typeof s === 'object' &&
          typeof (s as RecalledSeat).display_name === 'string' &&
          !!(s as RecalledSeat).display_name.trim(),
      )
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : '',
        display_name: s.display_name,
        at: typeof s.at === 'number' ? s.at : 0,
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RECALLED)
  } catch {
    return []
  }
}

/**
 * Record who just sat down on this phone. Call it on both paths — claiming a
 * fresh seat and taking one back — because both are someone telling you who
 * they are, and the second one is the more reliable statement of the two.
 */
export function rememberSeat(appKey: string, seat: { id?: string; display_name: string }): void {
  const name = seat.display_name?.trim()
  if (!name) return
  try {
    const kept = recalledSeats(appKey).filter((s) => norm(s.display_name) !== norm(name))
    const next = [{ id: seat.id || '', display_name: name, at: Date.now() }, ...kept].slice(
      0,
      MAX_RECALLED,
    )
    localStorage.setItem(storageKey(appKey), JSON.stringify(next))
  } catch {
    /* Storage gone. They pick from the list next time, which still works. */
  }
}

/** Wipe this phone's memory. For a "not me" escape hatch, and for tests. */
export function forgetSeats(appKey: string): void {
  try {
    localStorage.removeItem(storageKey(appKey))
  } catch {
    /* nothing to do */
  }
}

export interface SeatChoices<R, S> {
  /**
   * Names this phone knows, offered as one-tap buttons. Empty while searching:
   * once someone is typing, a suggestion above the results is just another
   * thing in the way.
   */
  suggested: R[]
  /**
   * Seats at THIS table that match what the phone remembers — a host-added
   * seat waiting for its player, or one they were in before. Claiming these
   * means taking the existing seat, not making a second one, so they are
   * offered ahead of the roster.
   */
  reclaimable: S[]
  /** The roster, capped when idle and filtered when searching. */
  list: R[]
  /** Roster names not on screen right now. Zero while searching. */
  hiddenCount: number
  /** Is the roster long enough to be worth a search box? */
  searchable: boolean
}

/**
 * Decide what the seat-claim screen shows.
 *
 * Anyone already sitting is dropped from the roster side entirely — they are
 * shown by the "already sitting" section, where tapping means taking that seat
 * back rather than opening a second one under the same name.
 */
export function seatChoices<R extends SeatCandidate, S extends SeatedLike>({
  roster,
  seated,
  recalled,
  query = '',
  limit = 6,
}: {
  roster: R[]
  seated: S[]
  recalled: RecalledSeat[]
  query?: string
  limit?: number
}): SeatChoices<R, S> {
  const q = norm(query)
  const seatedNames = new Set(seated.map((s) => norm(s.display_name)))
  const available = roster.filter((r) => !seatedNames.has(norm(r.display_name)))

  // Stable across keystrokes: computed from the whole roster, not from what is
  // left after filtering, so the box cannot vanish out from under someone
  // mid-word.
  const searchable = available.length > limit

  if (q) {
    // Match anywhere — "ana" should find Nana, and a surname is as good a
    // handle as a first name — but put the names that START with what was
    // typed on top. Typing "p" and getting Grandpa above Priya reads as a
    // broken search even though both are honest hits.
    const hits = available.filter((r) => norm(r.display_name).includes(q))
    return {
      suggested: [],
      reclaimable: [],
      // Uncapped on purpose. They narrowed it themselves; hiding matches now
      // would be answering a question with "some of the answer".
      list: [
        ...hits.filter((r) => norm(r.display_name).startsWith(q)),
        ...hits.filter((r) => !norm(r.display_name).startsWith(q)),
      ],
      hiddenCount: 0,
      searchable,
    }
  }

  const takenSeats = new Set<string>()
  const reclaimable: S[] = []
  for (const rec of recalled) {
    const hit = seated.find(
      (s) =>
        !takenSeats.has(s.id) &&
        ((!!rec.id && s.roster_entry === rec.id) || norm(s.display_name) === norm(rec.display_name)),
    )
    if (hit) {
      reclaimable.push(hit)
      takenSeats.add(hit.id)
    }
  }

  const suggestedIds = new Set<string>()
  const suggested: R[] = []
  for (const rec of recalled) {
    // Prefer the id — a rename on the roster should still find them — and fall
    // back to the name, which is all there is for a typed-in first visit.
    const hit =
      (rec.id ? available.find((r) => r.id === rec.id) : undefined) ??
      available.find((r) => norm(r.display_name) === norm(rec.display_name))
    if (hit && !suggestedIds.has(hit.id)) {
      suggested.push(hit)
      suggestedIds.add(hit.id)
    }
  }

  const rest = available.filter((r) => !suggestedIds.has(r.id))
  const list = rest.slice(0, limit)

  return {
    suggested,
    reclaimable,
    list,
    hiddenCount: rest.length - list.length,
    searchable,
  }
}
