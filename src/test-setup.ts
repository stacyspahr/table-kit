/**
 * A real, working `localStorage` for tests.
 *
 * Node 25 ships an experimental webstorage global that lands on the jsdom
 * window and shadows jsdom's own implementation — but it is inert unless node
 * is started with a valid `--localstorage-file`, so every method is missing.
 * Rather than depend on which of the two wins in a given Node or jsdom version,
 * the tests get their own deterministic implementation.
 */

class MemoryStorage implements Storage {
  #map = new Map<string, string>()

  get length(): number {
    return this.#map.size
  }

  clear(): void {
    this.#map.clear()
  }

  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, String(value))
  }
}

const store = new MemoryStorage()

for (const target of [globalThis, globalThis.window].filter(Boolean)) {
  Object.defineProperty(target, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })
}
