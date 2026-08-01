import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDeviceId, keepAwake } from './session.js'

/**
 * A stand-in for the browser's screen wake lock.
 *
 * The real one is taken away by the OS behind the page's back, so the fake has
 * to be able to do that too — `steal()` is a pocketed phone.
 */
interface FakeLock {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
  steal(): void
}

function installWakeLock() {
  const locks: FakeLock[] = []
  let refusing = false

  const request = async (): Promise<FakeLock> => {
    if (refusing) throw new Error('refused')
    const listeners: Array<() => void> = []
    const lock: FakeLock = {
      released: false,
      async release() {
        lock.released = true
        listeners.forEach((l) => l())
      },
      addEventListener(_type, listener) {
        listeners.push(listener)
      },
      steal() {
        lock.released = true
        listeners.forEach((l) => l())
      },
    }
    locks.push(lock)
    return lock
  }

  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  })

  return {
    locks,
    held: () => locks.filter((l) => !l.released).length,
    refuse(value: boolean) {
      refusing = value
    },
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** The request underneath is async; let it land. */
const settle = () => vi.advanceTimersByTimeAsync(0)

const MINUTE = 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility('visible')
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe("this phone's id", () => {
  /**
   * ⚠️ The storage key is a DATA CONTRACT with every phone that has already
   * played, not an implementation detail. Change the shape of it and each of
   * them silently becomes a new device: seats stop being reclaimable and a
   * player who reloads mid-game is a stranger to the roster.
   *
   * It is pinned here because Flip 7 arrived at this key from its own local
   * copy of this module — `flip7_device_id` — and the migration into the kit
   * was only safe because `${appKey}_device_id` lands on the identical string.
   */
  it('keys off the app slug, and nothing else', () => {
    localStorage.clear()
    const id = getDeviceId('flip7')
    expect(localStorage.getItem('flip7_device_id')).toBe(id)
  })

  it('gives the same phone the same id twice', () => {
    localStorage.clear()
    expect(getDeviceId('heat')).toBe(getDeviceId('heat'))
  })

  it('keeps two games on one phone apart', () => {
    localStorage.clear()
    expect(getDeviceId('flip7')).not.toBe(getDeviceId('heat'))
  })

  it('adopts an id that was already there rather than minting a new one', () => {
    localStorage.clear()
    localStorage.setItem('flip7_device_id', 'from-a-previous-game-night')
    expect(getDeviceId('flip7')).toBe('from-a-previous-game-night')
  })
})

describe('keeping the table lit', () => {
  it('takes the screen as soon as a game is on it', async () => {
    const api = installWakeLock()
    const awake = keepAwake()
    await settle()

    expect(api.held()).toBe(1)
    awake.stop()
  })

  it('gives the screen back when the game screen goes away', async () => {
    const api = installWakeLock()
    const awake = keepAwake()
    await settle()

    awake.stop()
    await settle()
    expect(api.held()).toBe(0)
  })

  it('lets go of a phone nobody has touched for twenty minutes', async () => {
    const api = installWakeLock()
    const awake = keepAwake()
    await settle()

    await vi.advanceTimersByTimeAsync(19 * MINUTE)
    expect(api.held()).toBe(1)

    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(api.held()).toBe(0)

    awake.stop()
  })

  it('takes it back the moment somebody touches the phone again', async () => {
    const api = installWakeLock()
    const awake = keepAwake({ idleMs: MINUTE })
    await settle()

    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(api.held()).toBe(0)

    window.dispatchEvent(new Event('pointerdown'))
    await settle()
    expect(api.held()).toBe(1)

    awake.stop()
  })

  it('counts a round closing as activity on a phone nobody touched', async () => {
    const api = installWakeLock()
    const awake = keepAwake({ idleMs: 10 * MINUTE })
    await settle()

    // Nine minutes of watching, then the game itself moves.
    await vi.advanceTimersByTimeAsync(9 * MINUTE)
    awake.nudge()

    await vi.advanceTimersByTimeAsync(9 * MINUTE)
    expect(api.held()).toBe(1)

    awake.stop()
  })

  it('re-takes the lock the browser confiscated while the phone was away', async () => {
    const api = installWakeLock()
    const awake = keepAwake()
    await settle()
    expect(api.locks).toHaveLength(1)

    // Pocketed: the OS releases it without asking.
    api.locks[0]!.steal()
    setVisibility('hidden')
    await settle()
    expect(api.held()).toBe(0)

    setVisibility('visible')
    await settle()
    expect(api.locks).toHaveLength(2)
    expect(api.held()).toBe(1)

    awake.stop()
  })

  it('does not ask while the page is hidden', async () => {
    const api = installWakeLock()
    setVisibility('hidden')

    const awake = keepAwake()
    await settle()
    expect(api.locks).toHaveLength(0)

    awake.stop()
  })

  it('shrugs at a browser that has no wake lock at all', async () => {
    Reflect.deleteProperty(navigator, 'wakeLock')

    const awake = keepAwake()
    await settle()
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(() => awake.stop()).not.toThrow()
  })

  it('shrugs at a browser that refuses — a low battery is its call, not ours', async () => {
    const api = installWakeLock()
    api.refuse(true)

    const awake = keepAwake()
    await settle()
    expect(api.held()).toBe(0)

    // And it recovers once the browser is willing again.
    api.refuse(false)
    window.dispatchEvent(new Event('pointerdown'))
    await settle()
    expect(api.held()).toBe(1)

    awake.stop()
  })

  it('does not leave a lock behind when it is stopped mid-request', async () => {
    const api = installWakeLock()
    const awake = keepAwake()

    // Stopped before the browser ever answers.
    awake.stop()
    await settle()

    expect(api.held()).toBe(0)
  })
})
