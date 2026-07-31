/**
 * The queue is new code rather than an extraction, so it carries its own proof.
 *
 * The cases that matter are the failure classifications — a wrong verdict is
 * either a lost round or a permanent "saving…" spinner, and neither is visible
 * in a happy-path test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classify, createQueue } from './queue.js'

class FakeError extends Error {
  status: number
  response: { data: Record<string, { code?: string }> }
  constructor(status: number, data: Record<string, { code?: string }> = {}) {
    super(`status ${status}`)
    this.status = status
    this.response = { data }
  }
}

/** Minimal stand-in for the bits of PocketBase the queue touches. */
function fakePb(handler: (collection: string, data: Record<string, unknown>) => Promise<unknown>) {
  const calls: { collection: string; data: Record<string, unknown> }[] = []
  return {
    calls,
    pb: {
      collection(collection: string) {
        return {
          create(data: Record<string, unknown>) {
            calls.push({ collection, data })
            return handler(collection, data)
          },
        }
      },
    } as never,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('navigator', { onLine: true })
})

describe('classify', () => {
  it('retries a dead connection', () => {
    expect(classify(new FakeError(0)).kind).toBe('retry')
  })

  it('retries a server error', () => {
    expect(classify(new FakeError(503)).kind).toBe('retry')
    expect(classify(new FakeError(429)).kind).toBe('retry')
  })

  it('treats our own duplicate key as success, not failure', () => {
    // The replay lost the race with itself. The intent still landed, which is
    // the entire point of carrying client_uuid across retries.
    const err = new FakeError(400, { client_uuid: { code: 'validation_not_unique' } })
    expect(classify(err).kind).toBe('satisfied')
  })

  it('treats someone else claiming the seat as terminal', () => {
    const err = new FakeError(400, { player: { code: 'validation_not_unique' } })
    const v = classify(err)
    expect(v.kind).toBe('terminal')
    if (v.kind === 'terminal') expect(v.reason).toMatch(/already entered/i)
  })

  it('does not retry auth or not-found', () => {
    expect(classify(new FakeError(403)).kind).toBe('terminal')
    expect(classify(new FakeError(404)).kind).toBe('terminal')
  })
})

describe('createQueue', () => {
  it('hands back a key immediately and drains on flush', async () => {
    const { pb, calls } = fakePb(async () => ({ id: 'x' }))
    const q = createQueue({ appKey: 't', pb })

    const key = q.enqueue('subs', { player: 'ann', score: 12 })
    expect(key).toMatch(/[0-9a-f-]{36}/)

    await q.flush()
    expect(q.status().pending).toBe(0)
    expect(calls[0]?.data.client_uuid).toBe(key)
    q.destroy()
  })

  it('shows queued writes as pending so the UI can count them as done', async () => {
    const { pb } = fakePb(async () => {
      throw new FakeError(0)
    })
    const q = createQueue({ appKey: 't', pb })
    q.enqueue('subs', { player: 'ann' })
    await q.flush()

    expect(q.status().pending).toBe(1)
    expect(q.pendingIn('subs')).toHaveLength(1)
    expect(q.pendingIn('other')).toHaveLength(0)
    q.destroy()
  })

  it('reuses the same key across retries', async () => {
    let fail = true
    const { pb, calls } = fakePb(async () => {
      if (fail) throw new FakeError(0)
      return { id: 'x' }
    })
    const q = createQueue({ appKey: 't', pb })
    const key = q.enqueue('subs', { player: 'ann' })

    await q.flush()
    fail = false
    await q.flush()

    expect(calls).toHaveLength(2)
    expect(calls[0]?.data.client_uuid).toBe(key)
    expect(calls[1]?.data.client_uuid).toBe(key)
    expect(q.status().pending).toBe(0)
    q.destroy()
  })

  it('clears a duplicate without reporting it as a problem', async () => {
    const { pb } = fakePb(async () => {
      throw new FakeError(400, { client_uuid: { code: 'validation_not_unique' } })
    })
    const q = createQueue({ appKey: 't', pb })
    q.enqueue('subs', { player: 'ann' })
    await q.flush()

    expect(q.status().pending).toBe(0)
    expect(q.status().dead).toHaveLength(0)
    q.destroy()
  })

  it('moves a terminal failure to dead with a readable reason', async () => {
    const { pb } = fakePb(async () => {
      throw new FakeError(400, { player: { code: 'validation_not_unique' } })
    })
    const q = createQueue({ appKey: 't', pb })
    q.enqueue('subs', { player: 'ann' })
    await q.flush()

    const s = q.status()
    expect(s.pending).toBe(0)
    expect(s.dead).toHaveLength(1)
    expect(s.dead[0]?.reason).toMatch(/already entered/i)

    q.dismiss(s.dead[0]!.clientUuid)
    expect(q.status().dead).toHaveLength(0)
    q.destroy()
  })

  it('stops draining at the first retryable failure rather than skipping past it', async () => {
    // Order matters: a later write may assume an earlier one landed.
    const { pb, calls } = fakePb(async (_c, data) => {
      if (data.seat === 1) throw new FakeError(0)
      return { id: 'x' }
    })
    const q = createQueue({ appKey: 't', pb })
    q.enqueue('subs', { seat: 1 })
    q.enqueue('subs', { seat: 2 })
    await q.flush()

    expect(calls.map((c) => c.data.seat)).toEqual([1])
    expect(q.status().pending).toBe(2)
    q.destroy()
  })

  it('gives up on a write left over from a finished night', async () => {
    // It has to be stuck before it can go stale: enqueue attempts immediately,
    // so a write that can succeed never reaches the TTL at all.
    let clock = 0
    const { pb, calls } = fakePb(async () => {
      throw new FakeError(0)
    })
    const q = createQueue({ appKey: 't', pb, now: () => clock })

    q.enqueue('subs', { player: 'ann' })
    await q.flush() // settle the attempt that enqueue kicked off
    expect(calls).toHaveLength(1)
    expect(q.status().pending).toBe(1)

    clock = 7 * 60 * 60 * 1000
    await q.flush()

    // Dropped on age, without burning another attempt on it.
    expect(calls).toHaveLength(1)
    expect(q.status().pending).toBe(0)
    expect(q.status().dead[0]?.reason).toMatch(/long over/i)
    q.destroy()
  })

  it('survives a reload', async () => {
    const { pb } = fakePb(async () => {
      throw new FakeError(0)
    })
    const first = createQueue({ appKey: 't', pb })
    first.enqueue('subs', { player: 'ann' })
    await first.flush()
    first.destroy()

    const second = createQueue({ appKey: 't', pb })
    expect(second.status().pending).toBe(1)
    second.destroy()
  })

  it('does not attempt anything while the browser reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { pb, calls } = fakePb(async () => ({ id: 'x' }))
    const q = createQueue({ appKey: 't', pb })
    q.enqueue('subs', { player: 'ann' })
    await q.flush()

    expect(calls).toHaveLength(0)
    expect(q.status().pending).toBe(1)
    expect(q.status().online).toBe(false)
    q.destroy()
  })
})

/**
 * Upsert: the mode that makes a row with a lifecycle possible.
 *
 * A richer fake than `fakePb` above — this one needs create, update and
 * getFirstListItem, and a server that actually enforces the unique key, because
 * every interesting case here is about what happens when the row already
 * exists.
 */
function fakeStore(opts: { failCreatesWith?: () => unknown } = {}) {
  const rows: Record<string, Record<string, unknown>> = {}
  const log: string[] = []
  let seq = 0
  const pb = {
    collection(name: string) {
      return {
        async create(data: Record<string, unknown>) {
          if (opts.failCreatesWith) throw opts.failCreatesWith()
          const key = String(data.client_uuid)
          if (Object.values(rows).some((r) => r.client_uuid === key)) {
            log.push(`create:conflict:${name}`)
            throw new FakeError(400, { client_uuid: { code: 'validation_not_unique' } })
          }
          const id = `rec${++seq}`
          rows[id] = { ...data, id }
          log.push(`create:${id}`)
          return { id }
        },
        async update(id: string, data: Record<string, unknown>) {
          if (!rows[id]) {
            log.push(`update:404:${id}`)
            throw new FakeError(404)
          }
          rows[id] = { ...rows[id], ...data }
          log.push(`update:${id}`)
          return rows[id]
        },
        async getFirstListItem(filter: string) {
          const key = filter.split('"')[1]
          const found = Object.values(rows).find((r) => r.client_uuid === key)
          log.push(`lookup:${found ? found.id : 'miss'}`)
          if (!found) throw new FakeError(404)
          return found
        },
      }
    },
  } as never
  return { pb, rows, log }
}

describe('upsert', () => {
  it('creates once, then updates the same row', async () => {
    const { pb, rows, log } = fakeStore()
    const q = createQueue({ appKey: 't', pb })

    q.upsert('subs', 'r1:p1', { peppers: [1], status: 'draft' })
    await q.flush()
    q.upsert('subs', 'r1:p1', { peppers: [1, 2], status: 'draft' })
    await q.flush()
    q.upsert('subs', 'r1:p1', { peppers: [1, 2, 7], status: 'final' })
    await q.flush()

    expect(Object.keys(rows)).toHaveLength(1)
    expect(rows.rec1!.peppers).toEqual([1, 2, 7])
    expect(rows.rec1!.status).toBe('final')
    // One create, then updates straight to the cached id — never a lookup.
    expect(log).toEqual(['create:rec1', 'update:rec1', 'update:rec1'])
    expect(q.status().pending).toBe(0)
  })

  it('collapses a burst of autosaves into a single write', async () => {
    const { pb, log } = fakeStore()
    const q = createQueue({ appKey: 't', pb })
    vi.stubGlobal('navigator', { onLine: false })

    // Forty taps while the wifi is down.
    for (let i = 1; i <= 40; i++) {
      q.upsert('subs', 'r1:p1', { peppers: Array(i).fill(1), status: 'draft' })
    }
    expect(q.status().pending).toBe(1)

    vi.stubGlobal('navigator', { onLine: true })
    await q.flush()

    expect(log).toEqual(['create:rec1'])
    expect(q.status().pending).toBe(0)
  })

  it('finds and overwrites a row it did not create — the proxied seat', async () => {
    // Someone entered this seat while the phone was offline, so the row already
    // exists and the id cache knows nothing about it. Last write wins.
    const { pb, rows, log } = fakeStore()
    const other = createQueue({ appKey: 'other', pb })
    other.upsert('subs', 'r1:p1', { peppers: [3], submitted_by: 'proxy' })
    await other.flush()

    localStorage.clear()
    const mine = createQueue({ appKey: 'mine', pb })
    mine.upsert('subs', 'r1:p1', { peppers: [1, 1], submitted_by: 'me' })
    await mine.flush()

    expect(Object.keys(rows)).toHaveLength(1)
    expect(rows.rec1!.peppers).toEqual([1, 1])
    expect(rows.rec1!.submitted_by).toBe('me')
    expect(log).toEqual(['create:rec1', 'create:conflict:subs', 'lookup:rec1', 'update:rec1'])
  })

  it('recreates the row if it was deleted out from under it', async () => {
    const { pb, rows, log } = fakeStore()
    const q = createQueue({ appKey: 't', pb })
    q.upsert('subs', 'r1:p1', { peppers: [1] })
    await q.flush()

    delete rows.rec1 // the round got wiped

    q.upsert('subs', 'r1:p1', { peppers: [1, 5] })
    await q.flush()

    expect(log).toEqual(['create:rec1', 'update:404:rec1', 'create:rec2'])
    expect(rows.rec2!.peppers).toEqual([1, 5])
  })

  it('survives a reload with the queue unsent', async () => {
    const { pb, rows } = fakeStore()
    const q1 = createQueue({ appKey: 't', pb })
    vi.stubGlobal('navigator', { onLine: false })
    q1.upsert('subs', 'r1:p1', { peppers: [1, 1, 2], status: 'draft' })
    q1.destroy()

    // Fresh tab, same storage.
    vi.stubGlobal('navigator', { onLine: true })
    const q2 = createQueue({ appKey: 't', pb })
    expect(q2.status().pending).toBe(1)
    await q2.flush()

    expect(rows.rec1!.peppers).toEqual([1, 1, 2])
  })

  it('keeps retrying a dropout rather than giving up the entry', async () => {
    const { pb } = fakeStore({ failCreatesWith: () => new FakeError(0) })
    const q = createQueue({ appKey: 't', pb })
    q.upsert('subs', 'r1:p1', { peppers: [7] })
    await q.flush()
    expect(q.status().pending).toBe(1)
    expect(q.status().dead).toHaveLength(0)
  })
})

describe('classify with mode', () => {
  it('sends an upsert back round to update rather than calling it done', () => {
    // The create-mode reading of this error is "already landed, drop it". For
    // an upsert that would discard every autosave after the first.
    const err = new FakeError(400, { client_uuid: { code: 'validation_not_unique' } })
    expect(classify(err, 'create').kind).toBe('satisfied')
    expect(classify(err, 'upsert').kind).toBe('retry')
  })
})
