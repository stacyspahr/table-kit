/**
 * The offline write queue.
 *
 * NEW CODE, not extracted. Flip 7's README claimed this existed; it did not —
 * `game.ts` generated a `client_uuid` and its own comment said the queue would
 * "land in Phase 5". Nothing was ever written. So the design below is chosen
 * rather than inherited, and the reasoning is worth keeping.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 * A card table is a hostile network. Phones sleep, wifi flaps, someone walks
 * into the kitchen. Principle 4 says connection loss is the NORMAL case, so a
 * tap that lands during a dropout must not be lost and must not double-apply
 * when the network returns.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 * Every write goes through here. `enqueue` persists the operation, hands back
 * its idempotency key immediately, and returns — callers never await the
 * network. A flush loop drains the queue whenever there is any reason to think
 * it might now succeed.
 *
 * The caller therefore has to treat "queued" as "done" in the UI, which is why
 * `pendingIn()` exists: local state merges queued rows so a player who submits
 * offline sees their own entry land, and `waitingOn` stops nagging them.
 *
 * ── Why duplicates cannot happen ──────────────────────────────────────────
 * Each operation carries a `client_uuid` generated once, at enqueue time, and
 * reused across every retry. A replay that reaches the server twice fails the
 * second time on the unique index — which this queue treats as SUCCESS, not as
 * an error. That inversion is the whole idempotency story: the retry did not
 * work, but the intent it carried is satisfied, which is what the caller cares
 * about.
 *
 * ── Two op modes ──────────────────────────────────────────────────────────
 * `enqueue` is a plain create: one row, once, never touched again.
 *
 * `upsert` is create-or-replace, and exists because a row with a lifecycle —
 * a draft that autosaves while someone taps, then turns final — cannot be
 * expressed as a create. The second create collides with whatever uniqueness
 * constraint made it one row in the first place, and gets classified terminal.
 *
 * The caller supplies the key rather than the queue minting one, and the
 * intended key is the thing that is already unique about the row: a seat's
 * entry for a round is keyed on (round, player). Two consequences fall out of
 * that, both wanted:
 *
 *   • Forty autosaves are ONE queued write, because each replaces the last.
 *   • If somebody proxies your seat while you are offline, your write lands on
 *     top of theirs when you reconnect rather than dying as a conflict. That is
 *     the specified behavior — last write wins, and `submitted_by` records who.
 *
 * ── What is deliberately NOT queued ───────────────────────────────────────
 * Closing a round, opening the next one, and ending a game are server-side
 * decisions (see `actions.ts`) precisely so two phones cannot race them;
 * queueing a stale round-close and replaying it ten minutes later would
 * reintroduce exactly the race the hook exists to prevent.
 */

import type PocketBase from 'pocketbase'

export interface QueuedOp {
  /** The idempotency key. Generated once, reused on every retry, forever. */
  clientUuid: string
  collection: string
  data: Record<string, unknown>
  enqueuedAt: number
  attempts: number
  /**
   * `create` writes the row once and treats a key collision as already-done.
   * `upsert` owns the row and writes over it. Absent means `create`, so ops
   * persisted by an older build still load and behave as they did.
   */
  mode?: 'create' | 'upsert'
  /** Set once an attempt fails in a way worth reporting. */
  lastError?: string
}

export interface DeadOp extends QueuedOp {
  /** Why it will never be retried. Shown to a human — keep it plain. */
  reason: string
}

export interface QueueStatus {
  /** Writes still trying. Non-zero means "saving…", not "failed". */
  pending: number
  /**
   * Writes that will never succeed and need a person to look at them. The
   * common cause is someone proxying your seat while you were offline.
   */
  dead: DeadOp[]
  online: boolean
  flushing: boolean
}

type Listener = (status: QueueStatus) => void

/** Back-off between attempts. Caps quickly — a card table wants prompt retries. */
const BACKOFF_MS = [0, 1_000, 2_000, 4_000, 8_000, 15_000]
const MAX_BACKOFF = 30_000

/**
 * How long a write may sit unsent before it is given up on.
 *
 * Sized to outlast a whole game night. A submission that has been stuck for
 * six hours belongs to a game that finished long ago, and replaying it into a
 * closed game is worse than dropping it.
 */
const TTL_MS = 6 * 60 * 60 * 1000

function backoffFor(attempts: number): number {
  return BACKOFF_MS[attempts] ?? MAX_BACKOFF
}

/**
 * Decide what an error means.
 *
 * The three-way split is the heart of this file. Getting `terminal` wrong in
 * either direction is bad in a different way: too eager and a recoverable blip
 * throws away a player's round; too reluctant and a permanently invalid write
 * retries until the TTL, silently showing "saving…" for six hours.
 */
type Verdict =
  | { kind: 'retry' }
  | { kind: 'satisfied' }
  | { kind: 'terminal'; reason: string }

/** True when the write bounced because a row with this client_uuid already exists. */
export function isOwnKeyConflict(err: unknown): boolean {
  const e = err as { response?: { data?: Record<string, { code?: string }> } }
  return Boolean(e?.response?.data?.client_uuid)
}

export function classify(err: unknown, mode: 'create' | 'upsert' = 'create'): Verdict {
  const e = err as { status?: number; response?: { data?: Record<string, { code?: string }> } }
  const status = typeof e?.status === 'number' ? e.status : undefined

  // PocketBase reports network failures — including a dead connection — as 0.
  if (status === undefined || status === 0) return { kind: 'retry' }
  if (status >= 500) return { kind: 'retry' }
  if (status === 429) return { kind: 'retry' }

  const fields = e?.response?.data ?? {}

  // Our own key bounced: the row exists.
  //
  // For a create that is the end of the story — the retry failed, the intent
  // succeeded, and treating it as success is the whole idempotency trick. For
  // an upsert it is the OPPOSITE: the row existing is the normal case and the
  // point is to go write over it, so the drain handles it rather than stopping
  // here. Collapsing these two would silently drop every autosave after the
  // first.
  if (fields.client_uuid) {
    return mode === 'upsert' ? { kind: 'retry' } : { kind: 'satisfied' }
  }

  // Any other uniqueness failure is a real conflict — almost always a seat that
  // someone else entered while this phone was offline.
  const conflicted = Object.entries(fields).find(([, v]) => v?.code === 'validation_not_unique')
  if (conflicted) {
    return {
      kind: 'terminal',
      reason: 'Someone else already entered this. Your copy was not applied.',
    }
  }

  if (status === 401 || status === 403) {
    return { kind: 'terminal', reason: 'Your seat needs rejoining before this can be saved.' }
  }
  if (status === 404) {
    return { kind: 'terminal', reason: 'That round no longer exists.' }
  }
  if (status === 400) {
    return { kind: 'terminal', reason: 'That entry was rejected as invalid.' }
  }
  return { kind: 'retry' }
}

export interface Queue {
  /** Persist a write and return its idempotency key. Never throws, never awaits the network. */
  enqueue(collection: string, data: Record<string, unknown>): string
  /**
   * Create-or-replace a row the caller owns, under a key the CALLER chooses.
   *
   * Calling it again with the same key replaces the queued write instead of
   * appending one, so an entry that autosaves every couple of seconds costs a
   * single request when the network comes back — not one per tap.
   *
   * Use the row's natural uniqueness for the key (for a seat's entry in a
   * round, that is round id + player id). Never a random uuid: a fresh key each
   * call is just `enqueue` with extra steps, and the second one collides.
   */
  upsert(collection: string, key: string, data: Record<string, unknown>): void
  /** Queued rows for one collection, so local state can show them as already done. */
  pendingIn(collection: string): QueuedOp[]
  /** Try to drain now. Safe to call at any time; concurrent calls collapse. */
  flush(): Promise<void>
  status(): QueueStatus
  subscribe(fn: Listener): () => void
  /** Acknowledge a dead write so it stops being reported. */
  dismiss(clientUuid: string): void
  /** Stop timers and listeners. */
  destroy(): void
}

export function createQueue(opts: {
  appKey: string
  pb: PocketBase
  /** Overridable for tests. */
  now?: () => number
}): Queue {
  const { pb } = opts
  const now = opts.now ?? (() => Date.now())
  const KEY = `${opts.appKey}_queue`

  let ops: QueuedOp[] = []
  let dead: DeadOp[] = []
  /**
   * client_uuid → record id, for rows an upsert has already created.
   *
   * Saves a lookup on every subsequent write, and survives a reload so a phone
   * that comes back still knows which row is its own. Purely a cache: a miss
   * costs one extra request, never correctness.
   */
  let ids: Record<string, string> = {}
  /**
   * The key of the op currently in flight, if any — always `ops[0]`.
   *
   * Coalescing must never touch it: its request already captured the old data,
   * so replacing it in place would send the stale copy and drop the newer one.
   */
  let sending: string | null = null
  /**
   * The drain currently running, if any.
   *
   * Held as a promise rather than a boolean so that `flush()` called during a
   * drain can hand back the work in progress. Returning early instead would
   * make `await flush()` a lie — it would resolve while writes were still in
   * flight, which is exactly the kind of thing that passes in tests and drops
   * a round at the table.
   */
  let inFlight: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<Listener>()

  /**
   * Storage is best-effort on purpose. Guests run in tabs the OS discards and
   * may have no durable storage at all; an in-memory queue still rescues the
   * overwhelmingly common case (a blip while the tab stays open), so a storage
   * failure must never take the queue down with it.
   */
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        ops?: QueuedOp[]
        dead?: DeadOp[]
        ids?: Record<string, string>
      }
      ops = Array.isArray(parsed.ops) ? parsed.ops : []
      dead = Array.isArray(parsed.dead) ? parsed.dead : []
      ids = parsed.ids && typeof parsed.ids === 'object' ? parsed.ids : {}
    } catch {
      ops = []
      dead = []
      ids = {}
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ops, dead, ids }))
    } catch {
      // Full or blocked. The in-memory queue is still live.
    }
  }

  function online(): boolean {
    try {
      return navigator.onLine !== false
    } catch {
      return true
    }
  }

  function status(): QueueStatus {
    return { pending: ops.length, dead: [...dead], online: online(), flushing: inFlight !== null }
  }

  function emit() {
    const s = status()
    listeners.forEach((fn) => fn(s))
  }

  function kill(op: QueuedOp, reason: string) {
    dead = [...dead, { ...op, reason }]
  }

  function schedule(ms: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, ms)
  }

  function flush(): Promise<void> {
    if (inFlight) return inFlight
    if (ops.length === 0) return Promise.resolve()
    if (!online()) {
      // Nothing to do until the browser says otherwise; the online listener
      // will call back. No timer, so an offline phone isn't spinning.
      return Promise.resolve()
    }

    inFlight = drain().finally(() => {
      inFlight = null
      emit()
    })
    return inFlight
  }

  /**
   * One attempt at one op.
   *
   * A create is a create. An upsert prefers to update a row it already knows
   * about, falls back to creating, and — if the create bounces because the row
   * exists after all — looks the row up by its key and writes over it. That
   * last path is the one that runs after a reload wiped the id cache, or when a
   * proxy landed the row first.
   */
  async function send(op: QueuedOp): Promise<void> {
    const coll = pb.collection(op.collection)
    if ((op.mode ?? 'create') === 'create') {
      await coll.create({ ...op.data, client_uuid: op.clientUuid })
      return
    }

    const known = ids[op.clientUuid]
    if (known) {
      try {
        await coll.update(known, op.data)
        return
      } catch (err) {
        // Row deleted out from under us (a seat removed, a round wiped). Drop
        // the stale id and fall through to create it again.
        if ((err as { status?: number })?.status !== 404) throw err
        delete ids[op.clientUuid]
      }
    }

    try {
      const made = await coll.create({ ...op.data, client_uuid: op.clientUuid })
      ids[op.clientUuid] = made.id
    } catch (err) {
      if (!isOwnKeyConflict(err)) throw err
      const existing = await coll.getFirstListItem(`client_uuid="${op.clientUuid}"`)
      await coll.update(existing.id, op.data)
      ids[op.clientUuid] = existing.id
    }
  }

  async function drain(): Promise<void> {
    emit()

    try {
      // Strictly FIFO. Later writes may depend on earlier ones having landed,
      // and reordering is never worth the throughput on a queue this short.
      while (ops.length > 0 && online()) {
        const op = ops[0]!

        if (now() - op.enqueuedAt > TTL_MS) {
          ops = ops.slice(1)
          kill(op, 'Too old to send — this game is long over.')
          save()
          emit()
          continue
        }

        try {
          sending = op.clientUuid
          await send(op)
          ops = ops.slice(1)
          save()
          emit()
        } catch (err) {
          const verdict = classify(err, op.mode ?? 'create')

          if (verdict.kind === 'satisfied') {
            ops = ops.slice(1)
            save()
            emit()
            continue
          }

          if (verdict.kind === 'terminal') {
            ops = ops.slice(1)
            kill(op, verdict.reason)
            save()
            emit()
            continue
          }

          // Retry: leave it at the head, back off, and stop draining. Anything
          // behind it is almost certainly blocked by the same outage.
          op.attempts += 1
          op.lastError = err instanceof Error ? err.message : String(err)
          save()
          emit()
          schedule(backoffFor(op.attempts))
          return
        } finally {
          sending = null
        }
      }
    } finally {
      // `inFlight` is cleared by flush()'s own finally, which is what makes
      // status().flushing accurate for callers watching the queue.
      emit()
    }
  }

  function enqueue(collection: string, data: Record<string, unknown>): string {
    const clientUuid = crypto.randomUUID()
    ops = [...ops, { clientUuid, collection, data, enqueuedAt: now(), attempts: 0 }]
    save()
    emit()
    void flush()
    return clientUuid
  }

  function upsert(collection: string, key: string, data: Record<string, unknown>): void {
    // Coalesce onto the newest queued op with this key, skipping ops[0] while
    // it is in flight. Newest rather than oldest so a burst of autosaves during
    // a send collapses onto the one already waiting behind it.
    const first = sending ? 1 : 0
    for (let i = ops.length - 1; i >= first; i--) {
      if (ops[i]!.clientUuid === key) {
        ops = ops.map((o, j) => (j === i ? { ...o, data, enqueuedAt: now() } : o))
        save()
        emit()
        void flush()
        return
      }
    }
    ops = [...ops, { clientUuid: key, collection, data, enqueuedAt: now(), attempts: 0, mode: 'upsert' }]
    save()
    emit()
    void flush()
  }

  function pendingIn(collection: string): QueuedOp[] {
    return ops.filter((o) => o.collection === collection)
  }

  function dismiss(clientUuid: string) {
    dead = dead.filter((d) => d.clientUuid !== clientUuid)
    save()
    emit()
  }

  const onOnline = () => void flush()
  const onVisible = () => {
    if (document.visibilityState === 'visible') void flush()
  }

  load()

  try {
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
  } catch {
    // Non-browser (tests). flush() still works when called directly.
  }

  // A phone that wakes with wifi already up fires no `online` event, so a slow
  // heartbeat is the backstop. Cheap: it no-ops on an empty queue.
  const heartbeat = setInterval(() => void flush(), 20_000)

  void flush()

  return {
    enqueue,
    upsert,
    pendingIn,
    flush,
    status,
    subscribe(fn) {
      listeners.add(fn)
      fn(status())
      return () => {
        listeners.delete(fn)
      }
    },
    dismiss,
    destroy() {
      if (timer) clearTimeout(timer)
      clearInterval(heartbeat)
      listeners.clear()
      try {
        window.removeEventListener('online', onOnline)
        document.removeEventListener('visibilitychange', onVisible)
      } catch {
        /* not a browser */
      }
    },
  }
}
