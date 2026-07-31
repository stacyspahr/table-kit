# Changelog

Written in terms of **capabilities**, not commits — the question this file
answers is "what can version X do," not "what files changed."

Bump meanings: patch = bug fix, always safe to take. Minor = something new
added, nothing you already use moved. Major = something changed shape, read
before bumping.

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
