/**
 * Install prompting — hosts only.
 *
 * Extracted from Flip 7 unchanged. Two populations use these apps: hosts
 * install and come back every week; guests scan a QR, play for an hour, and
 * leave. Designing as though a guest might install produces an app that nags
 * people at a party, at exactly the wrong moment — principle 5, violated in one
 * line of code.
 *
 * So the browser's automatic banner is ALWAYS suppressed. The event is kept,
 * and only the host's own screen offers a button to use it.
 */

type InstallEvent = Event & { prompt(): Promise<void> }

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((fn) => fn())
  })
}

export const canInstall = (): boolean => deferred !== null

export function onInstallAvailability(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return
  await deferred.prompt()
  deferred = null
  listeners.forEach((fn) => fn())
}

/** Already running from the home screen? Then there's nothing to offer. */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS reports it here rather than through display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iOS has no programmatic install — it's Share → Add to Home Screen. */
export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}
