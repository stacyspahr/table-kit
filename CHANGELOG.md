# Changelog

Written in terms of **capabilities**, not commits — the question this file
answers is "what can version X do," not "what files changed."

Bump meanings: patch = bug fix, always safe to take. Minor = something new
added, nothing you already use moved. Major = something changed shape, read
before bumping.

## v0.2.1

Fixes a bug introduced with drafts in v0.2.0. Take this if you are on 0.2.0.

- Fixed: `waitingOn` counted a DRAFT as handed in, so a player who picked up
  their pile and started tapping vanished from the list. The table was told
  nobody was outstanding while the round sat open forever — the server-side
  round hook applies the stricter rule, so the two disagreed and the game
  stalled with no name on screen to explain why.
- Fixed: a draft's running score counted toward `totals`, `goalReached` and the
  board. A half-counted pile could end the game.
- Added: `status?: 'draft' | 'final'` on `SubmissionRec`. Absent still means
  final, so a game that never writes drafts (Flip 7) is unaffected.

## v0.2.0

Draft autosave — the thing that turns "your phone died mid-round" from a lost
pile into nothing at all. Nothing existing moved; `submit()` behaves exactly as
it did.

- Added: `queue.upsert(collection, key, data)` — create-or-replace under a key
  the CALLER chooses, for rows with a lifecycle. A create cannot express a draft
  that autosaves and then turns final: the second write collides with whatever
  uniqueness made it one row, and the queue was right to call that terminal.
- Added: `actions.save({ …, final })` — one call for both the autosave and the
  hand-in, since they are the same write to the same row with a different
  `status`. Keyed on `entryKey(round, player)`, so:
    · forty autosaves cost ONE request when the network returns, not forty;
    · a seat someone proxied while you were offline resolves as last-write-wins
      when you reconnect, instead of dying as a conflict.
- Added: `actions.entryKey(roundId, playerId)`, exposed so an app can find its
  own queued write.
- Changed: `classify(err, mode)` takes an optional second argument. Default is
  unchanged, so existing calls behave identically — but note a duplicate
  `client_uuid` now means "go update the row" for an upsert, where for a create
  it still means "already landed, drop it". Reading those two the same way
  would silently discard every autosave after the first.

Queued ops written by v0.1.0 still load and still run as plain creates.

## v0.1.0

First release. The spine, extracted from Flip 7 — enough for a second game to
be built on it.

- Added: session plumbing — device id, join token, the token-stays-in-URL reload
  contract, screen wake lock
- Added: paired host/guest PocketBase clients with separate auth stores, so
  signing in as host cannot sign you out of your own seat
- Added: game state — seats, rounds, `waitingOn` (which counts unclaimed seats
  like any other, so a phoneless player is never forgotten), submissions,
  standings, tie detection
- Added: pluggable `Tally`, so a game where one submission scores against two
  players can supply its own totals without the kit knowing the rule
- Added: `winner: 'highest' | 'lowest'`, held separate from the end trigger —
  scores climb in every game, only the winner differs
- Added: **the offline write queue.** Persisted, FIFO, `client_uuid`
  idempotency, three-way error classification, backoff, and a six-hour TTL.
  Writes never await the network and a dropout cannot lose one
- Added: install prompting that stays suppressed for guests, per the
  two-populations rule
- Added: `version.json` build helper and `watchForUpdates()` for update
  detection and suite-wide version tracking

### Note on the queue

This is the one part that is **not** an extraction. Flip 7's README claimed an
offline queue existed; it did not — only a `client_uuid` was being generated,
against a replay path that was never written. So the queue here is new work, and
Flip 7 gains a guarantee it never actually had when it migrates onto the kit.
