# table-kit

The shared game-night layer for the table-game scorer suite. Seats, joining,
syncing, surviving a dead phone, running rounds.

**It owns everything about a game night except how a round is scored.** That one
sentence decides what belongs here. If something needs `if (game === 'heat')`
anywhere, it is not kit code.

Design rationale, the resilience guarantees, and the versioning plan live in
[`docs/TABLE_KIT_ARCHITECTURE.md`](docs/TABLE_KIT_ARCHITECTURE.md). What the
package actually exposes is [`docs/SPEC_SHEET.md`](docs/SPEC_SHEET.md).

## Install

```json
"dependencies": {
  "table-kit": "github:stacyspahr/table-kit#v0.21.0"
}
```

No registry and no publish step. npm runs a git dependency's `prepare` script on
install, so the package compiles itself — on your Mac and on Vercel alike.

**Pin to tags, never to a branch.** A branch reference means redeploying an app
for an unrelated reason silently pulls in whatever `main` has that day.

## Use

```ts
import { createKit } from 'table-kit'

export const kit = createKit({
  appKey: 'heat',
  pbUrl: import.meta.env.VITE_PB_URL,
  collections: {
    games: 'heat_games',
    players: 'heat_players',
    rounds: 'heat_rounds',
    submissions: 'heat_submissions',
  },
  winner: 'lowest',
})
```

`appKey` drives the storage key prefix, both auth store names, and the
`/api/<appKey>/…` endpoints. `winner` decides which end of the leaderboard wins
— and *only* that; see below.

`pbUrl` is **required and never defaulted.** Read it from `VITE_PB_URL` per the
platform convention. The kit ships no backend address, deliberately — this is a
public package and the PocketBase hostname is not something to publish.

### Submitting

`submit()` does not touch the network. It queues the write and hands back an
idempotency key immediately, so a dropout cannot lose it.

```ts
const key = kit.submit({ round, player, submittedBy, score, payload: { peppers } })
```

Because the write may still be in flight, **merge queued rows into local state**
or the player will be told they still owe a score they just entered:

```ts
const pending = kit.queue.pendingIn(kit.config.collections.submissions)
```

### Scoring stays in the game

The kit never scores. `submit()` takes a number the game computed, and totals
default to summing it. When one submission has to score against more than one
player — Flip 7's aimed Flip 7 — the game supplies a `Tally`:

```ts
totals(state, myTally)
```

### Winner direction is not the end trigger

Scores climb in every game in the suite, so `goalReached()` fires on the biggest
score regardless of who is winning. `winner` only decides who is on top when it
does. Conflating the two is the bug waiting to happen when a lowest-wins game
inherits a highest-wins hook.

### Taking a seat

The roster never shrinks — every name ever typed at a host's table stays on it,
because that is what joins a returning player to their lifetime stats. Left
unfiltered it becomes a scroll. `seatChoices` decides what the claim screen
shows; the app draws it.

```ts
import { rememberSeat, recalledSeats, seatChoices } from 'table-kit'

const { suggested, reclaimable, list, hiddenCount, searchable } = seatChoices({
  roster,            // this host's roster, in whatever order the app fetched it
  seated,            // who is already at this table
  recalled: recalledSeats('heat'),
  query,             // the search box, '' when idle
})
```

**Call `rememberSeat` on both claim paths** — a new seat and a reclaimed one.
Reclaim is the more reliable statement of the two, and missing it is why a
regular would keep getting the long list.

```ts
rememberSeat('heat', { id: rosterEntryId, display_name: name })
```

`id` is optional: a typed-in name has no roster entry yet (the server hook
creates it after the seat), so matching falls back to the name.

Available as `table-kit/roster` too — pure logic, no PocketBase — for an app
that has not adopted the kit core.

## Version tracking

Each app writes a `version.json` at build time recording the kit version it was
built against. That is what the suite dashboard reads — reporting what is
actually *deployed* rather than what happens to be committed.

```js
// scripts/version.js
import { writeVersionFile } from 'table-kit/build'

writeVersionFile({ dir: 'public', app: 'heat', commit: process.env.VERCEL_GIT_COMMIT_SHA })
```

```json
"scripts": { "prebuild": "node scripts/version.js" }
```

In the app, `watchForUpdates()` polls it and fires once when a newer build is
live. Render your own banner — the kit deliberately ships no markup, because
every app in the suite is themed differently.

> **⚠ Never let a service worker cache `/version.json`.** Served stale it
> reports the previous build, which breaks update detection *and* makes the
> dashboard claim an app is current when it is a version behind.

## Development

```bash
npm test
npm run typecheck
npm run build
```

Working on the kit and an app together: `npm link ../table-kit` in the app. The
app's `package.json` still names the tag, so Vercel always gets the pinned
version — which means **tag and push before shipping an app**, or the deploy
silently uses the old code.
