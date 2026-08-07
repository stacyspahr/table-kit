/**
 * Deploy identity, and noticing when it changes.
 *
 * Two jobs from one file, both reading `/version.json`:
 *
 *  1. **Update detection.** Non-technical players will never force-refresh an
 *     installed app. Polling the deployed build id and offering a one-tap
 *     reload is the only thing that reliably gets a fix onto their phone.
 *  2. **Version tracking.** The same file records which table-kit version this
 *     deploy was BUILT with — which is what the suite dashboard reads, and the
 *     reason it reports the truth rather than what happens to be committed.
 *
 * ⚠ `/version.json` must never be cached by a service worker. Served stale it
 * reports the previous build, which breaks update detection *and* makes the
 * dashboard confidently claim an app is current when it is a version behind.
 * Fetches here are already `no-store`; the service worker config is the other
 * half and lives in each app.
 */

export interface VersionInfo {
  /** App slug, matching the kit's `appKey`. */
  app: string
  /** The table-kit version this bundle was built against. */
  kit: string
  /** Changes on every deploy. What update detection compares. */
  buildId: string
  built: string
  commit?: string
}

export async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as VersionInfo
  } catch {
    // Offline or blocked. Not an error worth surfacing — try again next time.
    return null
  }
}

/**
 * Watch for a newer deploy. Calls `onStale` once, then stops looking.
 *
 * Checks on a slow interval and whenever the tab comes back to the foreground,
 * which is what catches the common case: a phone that was asleep in someone's
 * pocket while a fix went out.
 */
export function watchForUpdates(opts: {
  /** This bundle's build id, injected at build time. */
  buildId: string
  onStale: () => void
  intervalMs?: number
}): () => void {
  // ⚠️ 60s, not the 5 minutes this used to be. The interval only does real
  // work in one case — app open, screen on, somebody watching — because iOS
  // freezes timers in a backgrounded PWA and the visibility check covers the
  // pocket case anyway. At five minutes that watched case read as broken. The
  // poll is a ~120-byte no-store fetch, so a minute costs nothing.
  const every = opts.intervalMs ?? 60 * 1000
  let done = false

  async function check() {
    if (done) return
    const v = await fetchVersion()
    if (!done && v?.buildId && v.buildId !== opts.buildId) {
      done = true
      opts.onStale()
    }
  }

  const onVis = () => {
    if (document.visibilityState === 'visible') void check()
  }

  void check()
  document.addEventListener('visibilitychange', onVis)
  const id = setInterval(() => void check(), every)

  return () => {
    done = true
    document.removeEventListener('visibilitychange', onVis)
    clearInterval(id)
  }
}
