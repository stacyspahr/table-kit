# table-kit — spec sheet

**v0.35.0 · 370 tests · `stacyspahr/table-kit` (public)**

What the package actually contains and exposes, as built. The *why* lives in
[`TABLE_KIT_ARCHITECTURE.md`](TABLE_KIT_ARCHITECTURE.md);
the *what changed when* lives in [`CHANGELOG.md`](../CHANGELOG.md). This is the
reference you keep open while writing a game.

> ⚠️ **Before a new scorer meets a real table, run
> [`PRE_SHIP_CHECKLIST.md`](PRE_SHIP_CHECKLIST.md).** Every line in it is
> something a person hit on a real evening, with the app that found it named
> against it. It exists because 10,000 rediscovered four things this suite
> already knew — including, word for word, the finding Oh Hell's first game had
> already produced.

---

## At a glance

| | |
|---|---|
| **Owns** | Everything about a game night except how a round is scored |
| **Consumed as** | `"table-kit": "github:stacyspahr/table-kit#v0.24.0"` — a tag, never a branch |
| **Built by** | npm running the git dep's `prepare` script (`tsc`), locally and on Vercel |
| **Shipped as** | Compiled into each app's bundle at build time. Not a service, not a runtime dep |
| **Backend** | One shared PocketBase, one `appKey` per game, collections prefixed to match |
| **Consumers** | `flip7-scorer` (core, since 2026-08-01) · `beat-the-heat` (core) · `play-nine` (core, built on it from commit 1) |
| **Hard rule** | The kit may not import from any app. Ever. |

---

## Entry points

Six, and the split is deliberate — importing the core must never pull React or
`node:fs` in behind it.

| Import | Contains | Needs |
|---|---|---|
| `table-kit` | The core: config, session, clients, state, queue, actions, awards, reveal, share, roster, nights, PWA, version | `pocketbase` |
| `table-kit/react` | The screens and hooks — see [React](#react--table-kitreact) | `react`, `qrcode` (optional peers) |
| `table-kit/server` | `createGate` — the auth gate for an app's own `/api` route | nothing (plain `fetch`) |
| `table-kit/roster` | Seat-claim logic alone — pure, no PocketBase | nothing |
| `table-kit/build` | `writeVersionFile`, `kitVersion` — Node only, build time | nothing |
| `table-kit/styles.css` | The kit's own classes (`.qr-*`, `.brand`, `.sheet-top`, `.tabs`, screen, card, row) | — |

`table-kit/roster` exists so an app that hasn't adopted the core can still take
the seat shortcuts. That's how Flip 7 got its first shared code, ahead of the
full migration.

⚠️ **`table-kit/server` is the one entry point that never runs in a browser.**
It is imported by a Vercel function, so it has no DOM and does not use the
PocketBase SDK — just `fetch` against the REST API. Keeping the core
framework-free is what makes that possible.

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
| `handovers?` | Every time this seat changed hands: `[{ from, round }]`. See below |
| `left_round?` | The first round this seat does NOT owe. **Written by nothing yet** — step 4 of [`SEATS_SPEC.md`](SEATS_SPEC.md) |

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

### Share card — `share.ts`

A finished game as a 1080×1350 PNG, handed to the share sheet.

| Export | Does |
|---|---|
| `renderCard(spec)` | Draws the card on a canvas → PNG `Blob` |
| `shareCard(file, title)` | `navigator.share` with a download fallback |

The kit lays it out and writes none of it — every string is in `CardSpec`,
including the winner line, which is the game's own sentence.

Every seat is drawn. On a full table, board rows tighten first, then awards
are trimmed **from the top**: the list is ordered with the funny one last.

⚠️ `renderCard` on mount, `shareCard` in the tap handler. iOS ends the user
gesture at the first `await` and then refuses the sheet without an error.

### Seats — `roster.ts` (also `table-kit/roster`)

The roster is permanent and never stops growing, which is right for lifetime
stats and wrong for a phone.

| Export | Does |
|---|---|
| `removeSeat({ pb, config, game, seat })` | Take a seat away. **Lobby only** — see below |
| `reclaimSeat({ …, takeOver? })` | Move a seat to this phone. `takeOver` renames it and logs the handover |
| `lastHandover(seat)` | The most recent change of occupant, or null |
| `rememberSeat(appKey, seat)` | The phone records who sat down on it |
| `recalledSeats(appKey)` | One-tap buttons for regulars on their usual handset |
| `seatChoices({ roster, seated, recalled, query, limit })` | Returns `suggested`, `reclaimable`, `list`, `hiddenCount`, `searchable` |
| `forgetSeats(appKey)` | The "not me" escape hatch |

Best-effort: evicted storage degrades to the full list, never to a locked-out
player. Anyone already sitting is dropped from the roster side, so a returning
player takes their seat back rather than opening a second one.

> ⚠️ **`removeSeat` is lobby-only, and the refusal is the feature.** A seat's
> submissions relate to it, so deleting one mid-game rewrites the night to say
> that player was never there — every closed round's totals change, the share
> card loses a row, and their lifetime stats lose the game. Leaving mid-game is
> a SPAN on the seat, not the absence of one: see
> [`SEATS_SPEC.md`](SEATS_SPEC.md).
>
> The status check is a **guard, not a gate**. `deleteRule` is HOST with no
> status clause, so a host client can delete a seat at any point whatever this
> says; what stops it is that nothing offers it. Worth tightening to
> `game.status = "lobby"` when the seats migration next runs.
>
> Call it with the **host** client. A guest may create and update a seat and
> never remove one — the phone that walks off with a seat is not the one that
> should be able to delete it.

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

Screens: `HostLogin`, `NoAccess`, `Pending`, `SeatClaim`, `InviteHost`,
`LobbySeats`, `QrPanel`, `UpdateBanner`, `RulesSheet`, `RulingsList`,
`ScorePad`, `NoteBox`, `TakeSeat`, `TableBoard`.
Hooks and parts: `useLobby`, `useAutoSubmit`, `CountdownRing`, `NoPhone`,
`WaitingOn`.

#### Sitting down in place — `TakeSeat` (v0.29.0)

A compact seat claim for a screen that is already showing the table. The host
screen's, specifically: hosting a game and playing in one are different acts,
so the host's name is not in the lobby list until they sit down.

What was wrong was the way back in. "Take a seat" pushed the join URL and
swapped the whole app into the guest view — the lobby the host was watching
disappeared, a screen asked who they were, and they arrived at a **second**
lobby with the same seat list, the same join code and the same start button.

> ⚠️ **Nothing was ever starting the game on a seat claim.** `claimSeat` and
> `startGame` are separate calls and always were. But a transition that erases
> the screen you were waiting on erases the sense of still waiting, and what is
> left reads as a commit. The bug was the screen change, not the writes.

| Prop | For |
|---|---|
| `onOpen` | Run once when the panel opens, **before a name is drawn**. Where an app does whatever handshake taking a seat requires. Async, and allowed to throw — a failure shuts the panel rather than listing names that cannot be tapped |
| `onClaim`, `onReclaim` | The writes. The kit never picks the client |
| `label`, `heading` | The game's wording |
| `className` | The shut button's weight. One primary at a time is the screen's call |

> ⚠️ **A host cannot claim a seat with the host credential.** `claimSeat`
> writes the caller's auth record into `guest`, which relates to `<app>_guests`
> — a host user id there lands a seat no phone can ever take back. The host
> joins their own game through the same token exchange as everyone else, which
> is what the two separate auth stores exist for. `bootstrapJoin` is that whole
> handshake in one call and brings the roster back with it, so `onOpen` is one
> call and sitting down is not a second code path.

> ⚠️ **It never offers a seat another phone is holding.** Taking over an
> occupied seat is the recovery path and needs the confirm that explains what
> is about to happen. A confirm folded into a panel inside a lobby is where a
> mis-tap costs somebody their score — and the phone that needs it lands on
> `SeatClaim` anyway, because it has no seat and scans the code like everyone
> else. An UNCLAIMED seat is offered: that is the host picking up a phoneless
> seat they added themselves a minute ago.

#### Watching without a seat — `TableBoard` / `WaitingOn` (v0.29.0)

The table mid-game for a phone that is not entering a card.

Nothing in the kit ever required the host to play — `lobbyState` counts seats
and not hosts, the round-close button is on every phone, and the server flips a
round to `review` on its own. But every screen that **showed** the game needed
a seat, so a host who sat one out got a list of names and a join code. Keeping
score for a table of people playing without phones was the one arrangement the
apps could not do.

`format` is a prop because a total is `+4` in Play Nine, a count in Flip 7 and
a pepper tally in Beat the Heat. The kit orders the board and marks who is
still owing; the game says what a number looks like.

> ⚠️ **`done` is the caller's to build, from FINAL submissions only.**
> `submittedThisRound` already drops drafts. A board that ticks a seat off on
> an autosave tells the table it is waiting for nobody while somebody is still
> holding a card.

> ⚠️ **A seatless host still cannot enter for somebody else.** `save` takes
> `submittedBy`, a relation to a seat, and a host without one has no id to put
> there. So the all-phoneless table is not solved yet — it needs a decision
> about that column, not a screen.

Read state for this board with the **host** client: `loadState(gameId, pbHost)`.
The guest client is the kit's default and a host who never sat down never
joined, which is exactly the case the board exists for.

`QrPanel({ token, gameName, onClose })`. Full-screen join QR, reachable at any
point in a game and showable by any joined player, not just the host — routing
every stranded player through the host makes the host a bottleneck mid-hand.
Four-module quiet zone, plain black on white regardless of theme.

`RulesSheet({ sections, sourceLabel, canAsk, onClose, … })` — v0.21.0. The
offline rulebook, its search, the two tabs, the sticky header, and the ask
thread. The game supplies everything with words in it:

| Prop | For |
|---|---|
| `sections` | The rulebook, **in teaching order** — see the note below |
| `sourceLabel` | How a tagged entry reads: `{ ruling: 'table ruling' }` |
| `canAsk` | Whether the Ask tab exists at all. **Never the real gate** — the endpoint checks again |
| `authToken` | `() => string`. A *function*: a host's token is refreshed behind the app's back, and a component holding the value it had at mount eventually presents a dead one |
| `askContext` | Merged into the request body — `{ goal }`, `{ mode }`, `{ hole }` |
| `adviser` | "rules official", "rules consultant" — what this game calls it |
| `askIntro`, `askExample` | The instruction and the example question |
| `askEndpoint` | Defaults to `/api/ruling` |

⚠️ **It opens on the rulebook, not on Ask, and that is a design decision rather
than a default.** These games get given away in printed boxes with no rulebook,
so the sheet is the only rules a first-timer will ever have and it must greet
them with the lesson. Tabs exist so the adviser is one tap away *without*
demoting it.

---

### Server — `table-kit/server`

`createGate({ pbUrl, app, guests, games, rulings?, users?, grants?, role? })` →
`{ verifyHost, verifyPlayer, verifyAsker, logRuling }`. Each verifier takes the
request and returns the record (or `{ role, id, game }` for `verifyAsker`), or
`null`.

```js
const gate = createGate({
  pbUrl: process.env.VITE_PB_URL,
  app: 'heat', guests: 'heat_guests', games: 'heat_games',
})
if (!(await gate.verifyAsker(req))) return res.status(401).json({ error: '…' })
```

Two kinds of caller are admitted. A **host** is a platform user, approved, with
a grant for this app. A **player** is anonymous but not unidentified: joining by
QR mints a credential in `<app>_guests` bound to one game, and PocketBase will
vouch for it.

> ⚠️ **The active-game check is the whole gate for a player.** A credential from
> a finished night still validates — every join hook lets a returning phone back
> in so it can see the final card — so admitting on the credential alone leaves
> every game ever played holding a key to a paid endpoint forever.

> ⚠️ **`role` is unset by default.** All three apps only ever checked that a
> grant row exists; quietly requiring `role="editor"` would lock out any grant
> that predates roles.

Nothing here trusts the token's contents. It is handed back to PocketBase, and
the game is read with the *caller's* own token — so the collection rule that
says "a guest sees only its own game" does the scoping, and this file never
restates it.

#### Keeping the question — `gate.logRuling(req, asker, ruling)`

The Ask box used to answer and throw the question away. **The questions people
ask are the highest-signal thing these apps produce** — a question is a hole in
the rulebook with a person standing in it — so they are kept, and a recurring
one is the strongest evidence there is that a rule is missing. Full design in
`beat-the-heat/docs/RULINGS_SPEC.md`; this is phase A of it.

```js
const asker = await gate.verifyAsker(req)
const ruling = await askRuling(messages)
await gate.logRuling(req, asker, { question, thread, answer, context: goal })
```

It writes `<prefix>_rulings`, derived from the GUEST collection —
`heat_guests → heat_rulings`, `f7_guests → f7_rulings` — so a new app configures
nothing. Override with `rulings:` if one ever breaks convention.

> ⚠️ **Derived from `guests`, not from `app`.** Flip 7's slug is `flip7` while
> its collections are `f7_*`, so `${app}_rulings` would post to a collection that
> does not exist — silently, since this swallows failures, and for exactly one
> app.

> ⚠️ **Capture `question` BEFORE the endpoint splices table context onto the last
> user turn**, or every stored question carries a `[This table is playing: …]`
> prefix nobody typed. The context belongs in `context`, which is the only field
> here whose meaning is per-game.

> ⚠️ **It never throws and the caller ignores the result.** A lost question is a
> shame; a lost *ruling* is somebody standing over a hand mid-argument. The
> second is worse, so nothing about logging is allowed to reach the answer.

Written with the asker's own token, so no privileged credential sits in a Vercel
project. The trade that buys: the create rule must admit guests, so somebody at
the table could POST a row this endpoint never saw. Reads are host-only, the
stakes are a family game night, and the alternative is a per-app hook route —
the one thing this design exists to avoid.

#### Reading them back — `RulingsList` (`table-kit/react`)

`openRulings` / `decideRuling` / `completeRuling` / `dismissRuling` in the core,
and the host-only review screen in the React entry:

```jsx
<RulingsList pb={pbHost} collection={RULINGS} onClose={back} />
```

`RULINGS` comes from `rulingsCollection(GUESTS)` — the same derivation the gate
uses, so the screen that reads and the endpoint that writes cannot end up
pointed at two different tables.

Two piles, because they are different jobs on different days: **to look at**
wants thirty seconds of judgement and can happen anywhere; **waiting on an
edit** has been judged and needs a machine with an editor.

> ⚠️ **Deciding is not doing.** A triaged ruling stays OPEN — `bucket` is set,
> `status` is still `new`. `rules/rulebook.js` is a file in a repo, so clearing
> it at the moment of decision would file the decision and lose the job it
> created.

> ⚠️ **A question is not automatically a missing rule.** Three buttons, and the
> middle one matters most: if people keep asking something the rulebook already
> answers plainly, the sheet buried it, and a fourth entry saying the same thing
> makes the sheet longer and no clearer.

`looksLikeGap(answer)` tags the rows worth writing a rule for, off the adviser's
own words — every scorer's prompt instructs it to SAY when the rulebook doesn't
settle something. A hint, never a filing decision: it is prose matching, so it
can miss a phrasing.

`askedBefore(question, past)` tags the rows that are not the first of their kind
— *"2nd time this has come up"* — counted against `pastRulings`, everything
already dismissed or written up.

> ⚠️ **This is what makes "wait for two or three" actionable.** Dismissing the
> first time somebody asks about a rule the sheet already covers is the CORRECT
> move, and it is also what puts that question somewhere nothing will ever count
> again. Without the count, the trigger is a rule you can't act on.

`sameQuestion` is word-overlap after stopwords and a crude plural strip: two
shared subject words AND a third of the union. **Biased hard towards saying no.**
A missed repeat leaves you where you already were; a false one writes a rulebook
entry for an argument that never happened twice.

---

## What stays in the game

| The kit | The game |
|---|---|
| Seats, joining, sync, resilience, leaderboard mechanics, awards engine, share-card renderer, the rules **screen**, who may ask the adviser, the ruling **record** and its **review screen**, PWA chrome | Entry UI, scoring functions, sort direction, end conditions, award **definitions**, the **rulebook**, what `context` means, the share card's words, theme |

The test for a new feature: would a second, unrelated game want it unchanged? If
it needs `if (game === 'heat')` anywhere, it is not kit code.

The second test, and the stronger one now that there are three apps: **if all
three already have a near-identical copy of it, it is kit.** That is what moved
the rules sheet and the auth gate in v0.21.0 — three copies, drifting, differing
only in wording.

---

## Resilience contract

Every row is a scenario that *will* happen at a card table, handled identically
for every game in the suite.

| Scenario | Behavior |
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
| `v0.21.**1**` | Bug fix | Always |
| `v0.**22**.0` | New capability, nothing moved | Always |
| `v**1**.0.0` | Something changed shape | Read the changelog first |

Pin to tags. A branch reference means redeploying for an unrelated reason
silently pulls in whatever `main` has that day.

Check where things stand with **`kit-status`** (in `~/.zshrc`, next to `ship`).
It shows **pinned** (package.json = committed) against **deployed** (the live
`version.json` = actually serving) — they diverge when a bump was never shipped,
which is invisible any other way. ⚠️ It does not list Play Nine; check that one
with `curl -s https://play-nine-golf.vercel.app/version.json`.

**Local dev:** `npm link ../table-kit`. The footgun is shipping an app whose
linked kit has changes that were never tagged — the deploy silently uses the old
tag. `kit-status` warns about exactly this.

**Re-pinning gotchas:** `npm install` alone does not move a git dep (the
lockfile holds the SHA) — run `npm install "github:stacyspahr/table-kit#vX.Y.Z"`
explicitly, then `rm -rf node_modules/.vite` or Vite serves the old pre-bundled
copy and the new exports come back `undefined`.

---

## A seat changing hands — v0.31.0

Dad plays four holes, goes to check on the kids, Michelle picks up his cards.

Mechanically this always worked: `reclaimSeat` moves the seat to a new phone
and its whole running total comes with it, because submissions relate to the
**seat** and not to a person. What was missing is that no screen admitted the
case existed, and the board kept saying Dad all night.

```ts
await reclaimSeat({
  pb: pbGuest, config: kit.config, seat, deviceId,
  takeOver: { displayName: 'Michelle', rosterEntry: 'r-michelle', round: 5 },
})
```

Omit `takeOver` and this is the recovery path exactly as it was.

> ⚠️ **There is no free option on the name.** Rename and holes 1–4 sit under
> Michelle; keep Dad and holes 5–9 sit under him. One seat, one running total,
> one name column. So the seat is renamed — a board's job is to say who is
> holding the cards right now — and `handovers` records what happened, which is
> the half that stops it being a quiet rewrite. **Renaming without recording
> does not fix the problem, it moves it.**

> ⚠️ **`roster_entry` moves with the name.** It is the durable identity a
> lifetime-stats screen will count games against; the display and the identity
> must not disagree. `handovers` preserves the option of apportioning properly
> later — **do not build the apportioning until lifetime stats exist.**

> ⚠️ **`SeatClaim` asks, and it has to.** Nothing can tell Dad-on-a-new-phone
> from Michelle-picking-up-his-cards: both are one phone claiming a held seat,
> and only the person holding it knows which. Two buttons — "Yes, that's me" is
> unchanged and stays the prominent one, because recovery is the commoner reason
> to be on that screen. The handover is offered only for a seat with a phone on
> it; an unclaimed seat has no occupant to take over from.

`Handovers({ players, unit })` renders the record — nothing at all on the
ordinary night. `unit` is the game's word for a round: `hole` in Play Nine.
It belongs on a screen with room for a sentence (the end of the game), never
squeezed into a name column on every phone.

Requires the `handovers` column: migrations `1786100000`–`1786100002` in
`app-platform-backend`, applied 2026-08-04.
