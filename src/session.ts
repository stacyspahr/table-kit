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
 * Keep the screen awake while the QR is up. A phone that sleeps between
 * latecomers means waking and re-opening it for every single arrival.
 * Degrades silently where unsupported.
 */
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> }
    }
    if (!nav.wakeLock) return () => {}
    const lock = await nav.wakeLock.request('screen')
    return () => void lock.release().catch(() => {})
  } catch {
    return () => {}
  }
}
