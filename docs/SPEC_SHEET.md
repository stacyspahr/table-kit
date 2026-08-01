# table-kit — spec sheet

**v0.5.2 · 103 tests · `stacyspahr/table-kit` (public)**

What the package actually contains and exposes, as built. The *why* lives in
[`TABLE_KIT_ARCHITECTURE.md`](../../beat-the-heat/docs/TABLE_KIT_ARCHITECTURE.md);
the *what changed when* lives in [`CHANGELOG.md`](../CHANGELOG.md). This is the
reference you keep open while writing a game.

---

## At a glance

| | |
|---|---|
| **Owns** | Everything about a game night except how a round is scored |
| **Consumed as** | `"table-kit": "github:stacyspahr/table-kit#v0.5.2"` — a tag, never a branch |
| **Built by** | npm running the git dep's `prepare` script (`tsc`), locally and on Vercel |
| **Shipped as** | Compiled into each app's bundle at build time. Not a service, not a runtime dep |
| **Backend** | One shared PocketBase, one `appKey` per game, collections prefixed to match |
| **Consumers** | `flip7-scorer` (core, since 2026-08-01) · `beat-the-heat` (core) |
| **Hard rule** | The kit may not import from any app. Ever. |

---

## Entry points

Four, and the split is deliberate — importing the core must never pull React or
`node:fs` in behind it.

| Import | Contains | Needs |
|---|---|---|
| `table-kit` | The core: config, session, clients, state, queue, actions, awards, roster, nights, PWA, version | `pocketbase` |
| `table-kit/react` | `QrPanel` | `react`, `qrcode` (optional peers) |
| `table-kit/roster` | Seat-claim logic alone — pure, no PocketBase | nothing |
| `table-kit/build` | `writeVersionFile`, `kitVersion` — Node only, build time | nothing |
| `table-kit/styles.css` | The kit's own classes (`.qr-*`, `.brand`, screen, card, row) | — |

`table-kit/roster` exists so an app that hasn't adopted the core can still take
the seat shortcuts. That's how Flip 7 got its first shared code, ahead of the
full migration.

---

## Wiring a game

```ts
import { createKit } from 'table-kit'

export const kit = createKit({
  appKey: 'flip7',                    // storage prefix, auth stores, /api/<appKey>/…
  collections: { games, players, rounds, submissions },
  winner: 'highest',                  // 'lowest' for Beat the Heat
  pbUrl: import.meta.env.VITE_PB_URL, // required, never defaulted
})
```

`createKit` returns `Clients & Actions & { config, queue, destroy() }`. It hands
you the **guest** client by default — everything played through the kit is done
by a seated player, the host included. `pbHost` is there for the few screens
that genuinely need platform auth.

⚠️ `pbUrl` has no default on purpose. A default would bake a private backend
hostname into a public package.

---

## The four knobs

`TableKitConfig` is the entire surface a game configures. If a field would be
identical for every game in the suite, it isn't here — it's hardcoded in the kit.

| Field | Type | Notes |
|---|---|---|
| `appKey` | `string` | `flip7`, `heat`. Drives `${appKey}_host`, `${appKey}_guest`, `${appKey}_device_id` |
| `collections` | `{ games, players, rounds, submissions }` | Collection names, prefixed per game |
| `winner` | `'highest' \| 'lowest'` | **Separate from the end trigger.** Scores climb in every game; only who wins differs |
| `pbUrl` | `string` | Backend origin, from `VITE_PB_URL` |

---

## Records

The shapes the kit expects back from PocketBase.

**`GameRec`** — `id`, `join_token`, `status: 'lobby' | 'active' | 'finished'`, `host_user`, `created`

**`PlayerRec`** — a seat.

| Field | Meaning |
|---|---|
| `display_name`, `seat_order` | |
| `device_id` | **Empty marks the seat unclaimed** — a player with no phone |
| `guest` | The throwaway credential holding this seat. How a returning phone finds its own seat |
| `roster_entry` | The durable identity. `device_id` is a within-session convenience |
| `joined_round` | Latecomers don't owe hands for rounds that ran before they sat down |

**`RoundRec`** — `round_number`, `status: 'open' | 'review' | 'closed'`. The
server flips `open → review` the moment every owing seat is final, so a dead
host phone can't stall the table. `review` is the edit window; "score the round"
sets `closed`.

**`SubmissionRec`** — `computed_score`, `submitted_by` (differs from `player` on
a proxied seat), `client_uuid`, and:

> ⚠️ `status?: 'draft' | 'final'` — **a draft is not an answer.** Absent means
> final, so a game that never writes drafts is unaffected. Three separate bugs
> came from forgetting this: anything deciding "has this seat handed in?" must
> require `final`.

---

## Exports by module

### State — `state.ts`

Pure functions over `GameState`. No I/O.

| Export | Does |
|---|---|
| `totals` / `committedTotals` | Running score per seat. **`committedTotals` counts CLOSED rounds only** |
| `standings` | The board, best first. `winner` picks the end; ties share a place; seat order stabilises display so it doesn't shuffle between polls |
| `waitingOn` | Who still owes. Counts unclaimed seats like any other, so a phoneless player is never forgotten |
| `submittedThisRound`, `submissionFor` | |
| `goalReached`, `tieAtFront` | End conditions |
| `sumScores` | The default `Tally` |
| `Tally<S>` | Pluggable — for a game where one submission scores against two players |

`Standing` = `{ player, score, place }`, place 1-based and shared on a tie.

### Actions — `actions.ts`

The writing half. Returned by `createKit`.

| Export | Does |
|---|---|
| `loadState(gameId)` | One fetch → `GameState` |
| `submit({ round, player, submittedBy, payload, score })` | Hand in. Returns the idempotency key |
| `save({ …, final })` | One call for both the autosave and the hand-in — same write, different `status` |
| `entryKey(roundId, playerId)` | The idempotency key for one seat in one round |
| `closeRound`, `openNextRound`, `rematch` | Round lifecycle |

### The offline queue — `queue.ts`

The one part that was **not** an extraction. Flip 7's README claimed a queue;
only a `client_uuid` was being generated. Writes never await the network.

| Export | Does |
|---|---|
| `enqueue(collection, data)` | Persist a write, return its key. Never throws |
| `upsert(collection, key, data)` | Create-or-replace under a key **the caller chooses**. Forty autosaves cost one request |
| `pendingIn(collection)` | Queued rows, so local state can show them as done |
| `flush`, `status`, `subscribe`, `dismiss`, `destroy` | |
| `classify(err, mode)` | Three-way verdict. `mode` matters: a duplicate `client_uuid` means "already landed, drop it" for a create and "go update the row" for an upsert |

Persisted, FIFO, backoff, six-hour TTL. Key the upsert on the row's natural
uniqueness (`roundId:playerId`) — never a random uuid, which is `enqueue` with
extra steps.

### Awards — `awards.ts`

Generic engine. It never learns what is being measured.

`runAwards(defs, ctx)` — a game supplies `AwardDef[]`; the kit runs eligibility,
ranking, ties, and drops awards nobody won.

| Field | Notes |
|---|---|
| `measure → number \| null` | **null is NOT ELIGIBLE, which is not zero.** "Took the most cards" with nobody having taken one is no award, not a tie on nothing |
| `pick` | `'highest' \| 'lowest' \| 'all'`. The third is for thresholds — "never took more than five" is true or it isn't |
| `when?` | Skip the award entirely |
| `blurb(winners, ctx)` | Written verb-first: both surfaces render names themselves |

Ties always share; there is no tiebreak option. At a table an award is a thing
you say out loud, and "Nana and Grandpa both got scorched" is a fine sentence.

Helpers: `submissionsByPlayer(ctx)`, `closedSubmissions(rounds, subs)` — both
exclude drafts.

### Nights — `nights.ts`

Grouping past games into the evenings they were played on. Reads `created` and
nothing else, so it never learns what a round contained.

| Export | Does |
|---|---|
| `groupByNight(items, now)` | Anything with a `created` stamp → `Night<T>[]`, newest night first |
| `nightKey(date)` | Local `YYYY-MM-DD` of the night a moment belongs to |
| `nightLabel(key, now)` | `'Today'`, `'Yesterday'`, or a short date |
| `parseStamp(stamp)` | PocketBase's space-separated form → `Date`, Safari-safe |
| `timeOfDay(stamp)` | The clock time a game started |

A night runs **5am to 5am**, so a game that finished at 00:40 stays with the
evening that produced it rather than being filed under tomorrow.

The labels say Today and Yesterday, **not Tonight**. A game played at 11:15am is
not part of tonight, and the old wording made a morning game look misfiled. The
bucket is still a night; only the label stopped claiming to know the hour.

### Seats — `roster.ts` (also `table-kit/roster`)

The roster is permanent and never stops growing, which is right for lifetime
stats and wrong for a phone.

| Export | Does |
|---|---|
| `rememberSeat(appKey, seat)` | The phone records who sat down on it |
| `recalledSeats(appKey)` | One-tap buttons for regulars on their usual handset |
| `seatChoices({ roster, seated, recalled, query, limit })` | Returns `suggested`, `reclaimable`, `list`, `hiddenCount`, `searchable` |
| `forgetSeats(appKey)` | The "not me" escape hatch |

Best-effort: evicted storage degrades to the full list, never to a locked-out
player. Anyone already sitting is dropped from the roster side, so a returning
player takes their seat back rather than opening a second one.

### Session — `session.ts`

`makeJoinToken`, `getDeviceId(appKey)`, `getJoinToken`, `joinUrl(token)`,
`keepAwake(options)`.

> ⚠️ **The join token stays in the URL.** A backgrounded tab gets discarded and
> reloads; stripping the token would lock a player out mid-game with no way back.

### Clients — `pb.ts`

`createClients(config)` → `{ pbHost, pbGuest, url }`. Separate auth stores at
`${appKey}_host` and `${appKey}_guest`, because one device holds both at once —
the host is also a player, and a shared store would sign someone out of their
own seat the moment they logged in to host.

> ⚠️ Those key names are a **contract with every phone already carrying a
> session**, not an implementation detail. Rename one and every host is signed
> out, and getting back in means waiting on an emailed code. Five tests pin them.

### PWA — `pwa.ts`

`captureInstallPrompt`, `canInstall`, `onInstallAvailability`, `promptInstall`,
`isInstalled`, `isIOS`.

> ⚠️ **Never prompt a guest to install.** Guests scan a QR, play for an hour and
> leave. Designing as though they might install produces an app that nags people
> at a party.

### Version — `version.ts` + `build.ts`

`writeVersionFile({ dir, app, buildId })` at build time →
`/version.json` = `{ app, kit, buildId, built, commit? }`.
`fetchVersion()` and `watchForUpdates()` at runtime.

This file reports what is **deployed**, as opposed to what happens to be
committed — the distinction the suite dashboard depends on. It cannot drift,
because it is baked into the bundle.

> ⚠️ **A service worker must not cache `version.json`.** Served from cache it
> reports the previous build, and everything reading it then confidently says an
> app is current when it is a version behind. Freshness wins here.

### React — `table-kit/react`

`QrPanel({ token, gameName, onClose })`. Full-screen join QR, reachable at any
point in a game and showable by any joined player, not just the host — routing
every stranded player through the host makes the host a bottleneck mid-hand.
Four-module quiet zone, plain black on white regardless of theme.

---

## What stays in the game

| The kit | The game |
|---|---|
| Seats, joining, sync, resilience, leaderboard mechanics, awards engine, PWA chrome | Entry UI, scoring functions, sort direction, end conditions, award **definitions**, theme |

The test for a new feature: would a second, unrelated game want it unchanged? If
it needs `if (game === 'heat')` anywhere, it is not kit code.

---

## Resilience contract

Every row is a scenario that *will* happen at a card table, handled identically
for every game in the suite.

| Scenario | Behaviour |
|---|---|
| Wifi drops mid-entry | Taps are local. Queue flushes on reconnect; `client_uuid` dedupes replays |
| Phone dies mid-entry | Autosaves as a draft. Any device resumes the seat |
| Phone never returns | Seat drops to unclaimed. Anyone can finish it |
| No phone at all | Host adds a named seat. Same path — no second code path |
| Tab discarded, reloads | Join token is still in the URL |
| Guest storage wiped | Expected. The roster is identity |
| **Host's phone dies** | Nothing requires the host mid-game. Rounds auto-close |
| Two people enter one seat | Last write wins, `submitted_by` records who, the UI says so |
| App updates mid-game | Update banner offers the reload. State is server-side |
| Server unreachable at round end | Closes locally and reconciles. Never block the table on the network |

---

## Versioning

| Bump | Means | Safe to take? |
|---|---|---|
| `v0.5.**2**` | Bug fix | Always |
| `v0.**6**.0` | New capability, nothing moved | Always |
| `v**1**.0.0` | Something changed shape | Read the changelog first |

Pin to tags. A branch reference means redeploying for an unrelated reason
silently pulls in whatever `main` has that day.

Check where things stand with **`kit-status`** (in `~/.zshrc`, next to `ship`).
It shows **pinned** (package.json = committed) against **deployed** (the live
`version.json` = actually serving) — they diverge when a bump was never shipped,
which is invisible any other way.

**Local dev:** `npm link ../table-kit`. The footgun is shipping an app whose
linked kit has changes that were never tagged — the deploy silently uses the old
tag. `kit-status` warns about exactly this.

**Re-pinning gotchas:** `npm install` alone does not move a git dep (the
lockfile holds the SHA) — run `npm install "github:stacyspahr/table-kit#vX.Y.Z"`
explicitly, then `rm -rf node_modules/.vite` or Vite serves the old pre-bundled
copy and the new exports come back `undefined`.
