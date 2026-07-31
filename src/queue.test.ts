/**
 * The queue is new code rather than an extraction, so it carries its own proof.
 *
 * The cases that matter are the failure classifications — a wrong verdict is
 * either a lost round or a permanent "saving…" spinner, and neither is visible
 * in a happy-path test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classify, createQueue } from './queue'

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
