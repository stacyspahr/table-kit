# table-kit

The shared game-night layer for the table-game scorer suite. Seats, joining,
syncing, surviving a dead phone, running rounds.

**It owns everything about a game night except how a round is scored.** That one
sentence decides what belongs here. If something needs `if (game === 'heat')`
anywhere, it is not kit code.

Design rationale, the resilience guarantees, and the versioning plan live in
`~/beat-the-heat/docs/TABLE_KIT_ARCHITECTURE.md`.

## Install

```json
"dependencies": {
  "table-kit": "github:stacyspahr/table-kit#v0.1.0"
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
