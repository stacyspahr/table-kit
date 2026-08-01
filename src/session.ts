/**
 * Session plumbing — device id, join token, and the URL contract.
 *
 * Extracted from Flip 7 essentially intact; the only change is that the storage
 * key is now derived from the app key so two games installed on one phone do
 * not share a device id.
 *
 * Guests run in a browser tab, which the OS discards freely, so NOTHING here may
 * be assumed to survive. Storage is a convenience; the URL is the recovery path.
 */

/** 128 bits of hex. The QR carries it, so it never has to be readable. */
export function makeJoinToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * A stable-ish id for this browser. Best effort: if storage is unavailable or
 * gets evicted, a fresh one is minted and the player simply reclaims their seat.
 * This is NOT identity — the roster is.
 */
export function getDeviceId(appKey: string): string {
  const key = `${appKey}_device_id`
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(key, fresh)
    return fresh
  } catch {
    // Private mode, or storage blocked. A per-load id still works for this
    // session; the seat is reclaimable either way.
    return crypto.randomUUID()
  }
}

/**
 * The join token lives in the URL and STAYS there.
 *
 * A backgrounded tab gets discarded and reloads on return. If the token were
 * stripped after joining and storage had been evicted, the player would be
 * locked out mid-game with no way back. Leaving it in the URL is the reload
 * recovery path — and it is why re-scanning is only needed when the tab is
 * closed outright.
 */
export function getJoinToken(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('j')
  return fromQuery && fromQuery.length >= 24 ? fromQuery : null
}

export function joinUrl(token: string): string {
  return `${window.location.origin}/?j=${token}`
}

/**
 * Twenty minutes of nothing at all, and we let the phone sleep.
 *
 * The backstop is for the phone somebody sets face-down and forgets, not for
 * slow play: a hand that takes twenty minutes with nobody touching a screen and
 * no round advancing is a table that has gone to get food. Waking it again is
 * one tap; a dead battery is the rest of the night.
 */
const IDLE_MS = 20 * 60 * 1000

export interface KeepAwakeOptions {
  /** Override the idle backstop. 0 or Infinity disables it. */
  idleMs?: number
}

export interface AwakeHandle {
  /**
   * Restart the idle countdown, and re-take the lock if the backstop already
   * let go. Touches do this by themselves — call it for things the GAME does
   * on a phone nobody is touching, like a round closing.
   */
  nudge(): void
  /** Release the screen and stop listening. */
  stop(): void
}

interface Sentinel {
  release(): Promise<void>
  addEventListener?(type: 'release', listener: () => void): void
}

/**
 * Hold the screen awake while a game is on the table.
 *
 * Players are the reason this exists. The host taps every few seconds so their
 * phone never dims on its own, but a player who hands in a count and then just
 * watches the board goes untouched for minutes and locks — mid-round, every
 * round.
 *
 * Three things can take the lock away, and all three are wanted:
 *
 *  - The browser drops it the moment the page is hidden — pocketed phone,
 *    switched app, side button. It does NOT come back on its own, which is why
 *    visibility is listened for rather than assumed.
 *  - The idle backstop drops it after {@link IDLE_MS} of no touch and no nudge.
 *  - `stop()` drops it, so the lock dies with the screen that asked for it.
 *
 * Returns synchronously even though the request underneath is async: an effect
 * that unmounts before the browser answers must still be able to let go, and
 * awaiting a promise to get the release function loses that race.
 *
 * Degrades silently where the API is missing or the request is refused — some
 * browsers refuse outright on a low battery, which is the correct call.
 */
export function keepAwake(options: KeepAwakeOptions = {}): AwakeHandle {
  const idleMs = options.idleMs ?? IDLE_MS
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<Sentinel> }
  }

  let stopped = false
  let idle = false
  let lock: Sentinel | null = null
  let inFlight = false
  let timer = 0

  async function acquire(): Promise<void> {
    if (stopped || idle || inFlight || lock) return
    if (!nav.wakeLock || document.visibilityState !== 'visible') return
    inFlight = true
    try {
      const held = await nav.wakeLock.request('screen')
      // The OS releases the lock behind our back whenever the page hides.
      // Without this the handle would look held forever and never re-take it.
      held.addEventListener?.('release', () => {
        if (lock === held) lock = null
      })
      if (stopped || idle) void held.release().catch(() => {})
      else lock = held
    } catch {
      /* unsupported, refused, or hidden. Nothing to do but let it sleep. */
    } finally {
      inFlight = false
    }
  }

  function drop(): void {
    const held = lock
    lock = null
    if (held) void held.release().catch(() => {})
  }

  function nudge(): void {
    if (stopped) return
    idle = false
    window.clearTimeout(timer)
    if (idleMs > 0 && idleMs !== Infinity) {
      timer = window.setTimeout(() => {
        idle = true
        drop()
      }, idleMs)
    }
    void acquire()
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible') nudge()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pointerdown', nudge, { passive: true })
  window.addEventListener('keydown', nudge)
  nudge()

  return {
    nudge,
    stop() {
      if (stopped) return
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointerdown', nudge)
      window.removeEventListener('keydown', nudge)
      drop()
    },
  }
}
