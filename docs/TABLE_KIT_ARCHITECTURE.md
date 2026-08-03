# Table Kit — shared architecture for the game-night suite

**Version 0.2 — updated 2026-08-03**

This document is about the *suite*, not about Beat the Heat. It defines the seam
between "how a game night works" and "how this particular game scores," so that
game #3 and #4 cost a weekend instead of a month.

It is the ***why***. The ***what***, as built, is [`SPEC_SHEET.md`](SPEC_SHEET.md)
next door; the *what changed when* is [`CHANGELOG.md`](../CHANGELOG.md).

> **This file moved on 2026-08-03**, from `beat-the-heat/docs/` to here. It was
> written in an app because that app was where the seam first got enforced, with
> a note that it would move "when it earns its own home" — and §5's whole
> argument is that the kit is a real package rather than a folder inside one
> game. A suite document sitting in one of the three apps it describes was the
> last piece contradicting that.

---

> ## Status, 2026-08-03
>
> Written as a plan in July 2026; most of it is now built, so the tense has been
> corrected where it was wrong and marked where it is still aspirational.
>
> **Real:** the kit is `stacyspahr/table-kit` (public) at **v0.21.0**, 246 tests,
> with **three** consuming apps — `flip7-scorer`, `beat-the-heat`, `play-nine` —
> all pinned to that tag and deployed on it. Six entry points, including a
> server-side one that runs in a Vercel function.
>
> **Still unbuilt, and deliberately so:** `kit-bump`, `kit-release`, the Kit
> panel in Doorman, and the weekly ntfy cron. §9's own sequencing table says
> those arrive at three or four apps; at three, `kit-status` is still doing the
> job on its own.

---

## 1. Why now

Flip 7 is app #1. Beat the Heat is app #2. This is the right moment to draw the
line, and it is a narrow window:

- At one app, extracting shared code is guesswork — you can't tell what's general
  from a sample size of one.
- At two apps, the seam is *visible*. You can see which parts of Flip 7 were
  about Flip 7 and which were about four people at a table with phones.
- At four apps, you have four divergent copies and the extraction is archaeology.

So: draw the boundary now, while there is exactly one thing to compare against.

**The window was used.** Play Nine (app #3) was built on the kit from its first
commit rather than being extracted afterwards, and Flip 7 was migrated onto it
on 2026-08-01. There is no divergent copy of the game-night layer anywhere in
the suite — which is exactly the archaeology this section was written to avoid.

The prediction held in the other direction too, at a smaller scale: three
*near*-identical copies of the rules sheet did accumulate, in the one area the
original tables below never mentioned. See
[the second test](#the-second-test-learned-at-three-apps).

## 2. The seam

One sentence, and every other decision in this document follows from it:

> **The kit owns everything about a game night except how a round is scored.**

Everything about seats, joining, syncing, surviving a dead phone, and showing a
leaderboard is a game-night problem. It is identical whether the round produced a
Flip 7 hand or a stack of peppers. Everything about *what a player did and what
it was worth* is the game, and the kit must never know.

### In the kit

| Area | What it covers |
|---|---|
| **Session** | Create game, join token, `joinUrl`, QR panel, token-stays-in-URL reload recovery |
| **Seats** | Claim by `device_id`, unclaimed seats, proxy entry, `submitted_by` attribution, `waitingOn` |
| **Identity** | Roster as durable identity; `device_id` is a within-session convenience only |
| **Host auth** | Emailed 6-digit OTP (per the platform convention — never a password form) |
| **Sync** | Adaptive polling, `client_uuid` idempotency, offline queue, draft autosave |
| **Round lifecycle** | Open, collect, auto-close when all seats are in, advance |
| **Leaderboard** | The reveal animation, parameterized by sort direction and limit |
| **Awards** | Generic engine: takes rounds + submissions, applies a game-supplied award list |
| **Share card** | The renderer that draws a night's final board and awards as a PNG for the share sheet |
| **Rules screen** | The sheet, its search, the rulebook/ask tabs, the sticky header, the ask thread. Added v0.21.0 — see below |
| **Who may ask** | `createGate`, server-side: is this a signed-in host, or a player at a game still being played |
| **Chrome** | Update banner, install prompt suppression for guests, `svh`/safe-area layout, and the extra bottom padding a browser *tab* needs |

### In the game

| Area | What it covers |
|---|---|
| **Entry UI** | Pepper buttons, card pickers, whatever this game needs |
| **Scoring** | Pure functions from a submission payload to a number |
| **Config** | Sort direction, end conditions, round count |
| **Award definitions** | The *list*; the engine that runs it is the kit's |
| **The rulebook** | The rules themselves, in teaching order, plus what this table calls its adviser and the example question that teaches you how to ask. The *screen* is the kit's |
| **The share card's words** | The winner line especially. A kit that composed "wins on 41 — the fewest at the table" would get the inversion backwards for every table it drew |
| **Theme** | Palette, type, the whole look |

### The one rule

The kit may not import from any app. Ever. The dependency arrow points one way,
and a game passes itself to the kit as configuration and callbacks, never the
reverse.

Making the kit a separate package (§5) enforces this for free — there is no import
path back, so the boundary cannot erode by accident. That is a second reason to
package it rather than keep it as a folder, where the rule would depend on
discipline and a lint check nobody remembers to run.

The rule that still needs judgement: deciding what *belongs* in the kit. The test
is whether a second, unrelated game would want it unchanged. If it needs a
`if (game === 'heat')` anywhere, it is not kit code.

### The second test, learned at three apps

That test is a *prediction*, and predictions about generality are the ones this
document already warns are guesswork at a sample size of one. At three apps
there is a better one, because it is an observation rather than a forecast:

> **If all three apps already have a near-identical copy of it, it is kit.**

Applied on 2026-08-03, after Beat the Heat's first real game night, to two things
the original tables never mentioned:

- **The rules sheet.** Three copies, differing only in the rulebook they read,
  the word for the adviser ("official" vs "consultant"), and the example
  question. They had already started to drift — Flip 7's wrapped its header in
  `.topbar`, the others in `.sheet-head`, for a screen doing the same job.
- **The auth gate in front of the adviser.** Three copies of one `api/_host.js`,
  identical apart from the app key and two collection names.

Both moved into the kit; each app's copies were deleted. What stayed behind is
a thin `src/components/Rules.tsx` per app holding only the things in the "in the
game" table above.

The direction of that discovery is worth noting, because it is the argument for
keeping this document honest rather than tidy: **neither the rules sheet nor the
adviser existed when the tables above were written.** The seam sentence held
perfectly — a rules screen is a game-night problem and a rulebook is a game
problem — but the *inventory* under it was incomplete, and only a real game night
surfaced that.

### How the seam is actually expressed: six entry points

The tables above say *what* is on each side. The package says it in imports, and
the split is not filing — it is what each half is allowed to depend on.

| Import | Depends on | What it is |
|---|---|---|
| `table-kit` | nothing but PocketBase | The core: seats, joining, state, the offline queue, standings, the reveal, the awards engine, the share-card renderer, nights, PWA and version helpers |
| `table-kit/react` | React | The screens and hooks: `HostLogin`, `SeatClaim`, `InviteHost`, `QrPanel`, `LobbySeats`, `UpdateBanner`, `RulesSheet`, `useLobby`, `useAutoSubmit`, `CountdownRing` |
| `table-kit/server` | nothing — plain `fetch` | `createGate`. **Runs in a Vercel function, not a browser.** No DOM, no SDK |
| `table-kit/styles.css` | — | The shared bones, every value read from a `--tk-*` token the app sets |
| `table-kit/roster` | nothing | Roster recall and the seat-choice cap |
| `table-kit/build` | `node:fs` | Build-time only. Writes each app's `version.json` |

The core staying framework-free is load-bearing, not tidiness: `table-kit/build`
runs in Node during a build, and `table-kit/server` runs in a serverless
function. Neither has a DOM. A core that had quietly grown a React import would
break both, and it would break them on Vercel rather than locally.

`table-kit/server` is the newest and the one that bends the original picture:
this document assumed the kit was only ever compiled into a browser bundle
(§5). One entry point is now also imported by an app's `/api` handler. The
compile-in mental model is unchanged — it is still `npm install` and still
baked in at build time — but "the kit runs on the player's phone" is no longer
the whole truth.

## 3. Design principles

These come from playing Flip 7 for real, and they are the reason to say no to
things. They are not aspirational; each one has already killed a feature.

**1. The game is played on the table.** The phone is never a substitute for the
cards. No digital hand, no mirrored board, no "what's still out there" helper. The
app learns what happened only when a human tells it, after the fact. This is the
principle that permanently rules out referee mode for Beat the Heat, and it is
the first thing to check any new feature against.

**2. Everyone manages their own entry.** Each player enters their own score on
their own phone, in parallel. A seat without a phone is entered by whoever is
nearest — deliberately not assigned to one person.

**3. Everyone sees the leaderboard.** The standings are shared state, on every
screen, at the same moment.

**4. Rock solid, or it doesn't ship.** Connection loss, dead battery, no phone at
all, a tab discarded by the OS — all of these are the *normal* case at a card
table, not edge cases. See [§4](#4-the-resilience-matrix).

**5. The phone does not take over.** The app is quiet during play. No
notifications, no nagging, no install prompts for guests. It has exactly one
moment of theatre per round — the leaderboard reveal — and it is otherwise
furniture.

**6. Capture the fun.** Stats and awards after each round and after each game.
This is the thing that makes people want to open it next time.

**7. The rules sheet must teach the game from zero.** *Added 2026-08-02.* These
decks get given away in 3D-printed boxes with no rulebook and no lid, so for the
person holding one the app is the only rules that will ever exist. A sheet
ordered as a *reference* — alphabetical, or by mechanic — is useless to them.
Order it as a lesson (object, what a card says, setup, how a turn runs, what
goes wrong, a fully worked example, then scoring) and let the search box serve
the reference case.

This is why the kit's `RulesSheet` opens on the rulebook and not on the ask box,
even though the ask box is the thing people asked to reach faster: a first-timer
must meet "Never played? Start here," not a question prompt. Tabs made the
adviser one tap away without demoting the lesson.

## 4. The resilience matrix

Principle 4 in specifics. Every row is a scenario that will happen, and the
behavior is the kit's job, identically for every game in the suite.

| Scenario | Behavior |
|---|---|
| Wifi drops mid-entry | Taps are local. Queue flushes on reconnect; `client_uuid` dedupes replays. |
| Phone dies mid-entry | Entry autosaves as a draft every ~2s. On any device, the seat resumes where it left off. |
| Phone dies and never returns | The seat drops to unclaimed. Anyone can finish or enter it. |
| Player has no phone at all | Host adds a named seat in the lobby with no `device_id`. Same path as above — no second code path. |
| Tab discarded, reloads | Join token is still in the URL. That is the recovery path, which is why it is never stripped. |
| Guest storage wiped | Expected. `device_id` is disposable; the roster is identity. |
| **Host's phone dies** | Nothing requires the host mid-game. Rounds auto-close when every seat is in. The host rejoins to a game still in progress. |
| Two people enter one seat | Last write wins, `submitted_by` records who, and the UI says so rather than hiding it. |
| App updates mid-game | Update banner offers the reload. State is server-side, so nothing is lost. |
| Server unreachable at round end | Round closes locally and reconciles. Never block the table on the network. |

The draft autosave is new — Flip 7 doesn't have it. It is the same pattern already
shipped in Wedge Matrix, and it converts "dead battery loses your round" into
"dead battery loses nothing."

## 5. Distribution

**The kit is a real package from day one, in its own repo, consumed by tag.**

The requirement that decides this: *improvements discovered while building a later
app must flow back to earlier ones.* A copied directory delivers exactly none of
that, so copying is off the table regardless of how clean the seam is.

```
~/table-kit                 stacyspahr/table-kit — the package (public)
~/flip7-scorer              app #1
~/beat-the-heat             app #2
~/play-nine                 app #3
```

Each app declares:

```json
"dependencies": {
  "table-kit": "github:stacyspahr/table-kit#v0.21.0"
}
```

No registry, no publish step, no auth. npm installs straight from GitHub, and
because npm runs a git dependency's `prepare` script on install, the kit builds
itself (`"prepare": "tsc"`) on Vercel with no extra configuration.

### Why not a monorepo

A monorepo has the better developer experience and would normally win. It loses
here on one specific constraint: `ship` requires `.vercel/project.json` in the
current directory and deploys that directory as the project root. An app in
`apps/` would deploy without its sibling `packages/table-kit`, so every monorepo
app would need a bespoke deploy path — breaking the single-deploy-path invariant
that `ship` exists to enforce.

Standalone repos with a normal dependency keep `ship` working untouched.

### The kit is compiled in, not called

The mental model everything else rests on: **the kit is baked into each app's
bundle at build time.** It is not a service the app calls and not a shared
framework it links against at runtime.

```
package.json says  github:stacyspahr/table-kit#v0.3.0
        ↓  npm install  (locally, and again on Vercel's build machine)
node_modules/table-kit   ← that exact tag, fetched and built
        ↓  vite build
one bundle: app code + kit code, compiled together
        ↓  ship
Vercel
```

Closest familiar analogue: a Swift package pinned to a version in Xcode. It
compiles into the app. It is not a dylib the app finds at runtime.

Four consequences, and they are the whole reason this arrangement is safe:

- **Players' devices never know the kit exists.** One bundle, no second request,
  no runtime dependency on GitHub being reachable.
- **A live app cannot change until it is rebuilt.** Tag v0.4.0 today and Flip 7
  keeps serving v0.2.0 indefinitely — not because something protects it, but
  because its deployed bundle already contains v0.2.0. Nothing reaches in.
- **Apps can sit on different versions forever.** Separate bundles that never
  meet; there is no conflict to resolve and no pressure to keep them aligned
  beyond wanting the fixes.
- **`node_modules` is never committed.** The record is the tag in `package.json`
  plus the exact commit in `package-lock.json` — which is also why the
  `version.json` written at build time (§9) cannot drift from what shipped.

### Versioning and propagation

Pin to **tags**, never to a branch. A branch reference means redeploying an app
for an unrelated reason silently pulls in whatever the kit's `main` has that day
— which is a direct violation of principle 4.

Adoption is therefore explicit and per-app: tag the kit, then bump each app when
it is ready. Worth a small shell function next to `ship`:

```
kit-bump          # set this app to the kit's latest tag, install, show the diff
```

⚠️ **`kit-bump` does not exist.** Bumping is two commands, by hand, and both are
required:

```bash
npm install "github:stacyspahr/table-kit#v0.21.0"
rm -rf node_modules/.vite
```

A plain `npm install` does **not** move a git dependency — the lockfile holds the
commit SHA, so it resolves to the same commit it already had. And Vite caches
its pre-bundled copy of the dependency, so without clearing `.vite` the dev
server serves the *old* kit and anything new comes back `undefined`. Both of
those cost a confused half hour the first time.

Discipline that keeps drift from accumulating: after any kit release that fixes a
real bug, bump **every** app, even ones not being actively worked on. The cost is
one command and one deploy each; the cost of skipping it is that "the suite shares
a kit" quietly stops being true.

**This was exercised for the first time on 2026-08-03.** One playtest of Beat the
Heat produced a fix that belonged to every guest in every scorer (a browser tab's
address bar sitting over the primary button), so all three apps were bumped and
shipped the same afternoon. That is the whole thesis of this section working:
the bug was found at one table, in one game, and fixed for three.

### Local development loop

While building an app you will change kit code constantly, and tag-per-change is
absurd. Use `npm link ../table-kit` for local work — `package.json` still declares
the tag, so Vercel always installs the pinned published version.

**The footgun:** shipping an app whose local linked kit has changes that were
never tagged and pushed. The deploy silently uses the old tag. Guard against it —
the kit repo gets a `kit-release` script that bumps, tags, and pushes in one step,
and it should be habit to run it before shipping any app.

*As built:* `kit-release` does not exist either, and neither does the linking
habit — in practice a kit change is written, tested, tagged and pushed, and only
then re-pinned in the apps, which is a slower loop but has the footgun designed
out rather than guarded against. What *does* guard it is `kit-status`, which
warns when `~/table-kit` has commits of shipping code past the newest tag —
precisely the "never travelled" case above. See §7.

### First-deploy verification

The `prepare`-on-git-install path is well trodden but worth confirming on the very
first Vercel build rather than assuming. If it misbehaves, the fallback is to
commit the kit's `dist/` — ugly, bulletproof, and a five-minute change.

### On migrating Flip 7

Not immediately, but not "someday" either. Flip 7 is live and being played on, so
Beat the Heat is built first and the kit's API gets shaped by a second real
consumer before Flip 7 is touched.

**Then Flip 7 moves onto the kit.** Skipping this is what turns the whole plan
into two copies with extra steps: until app #1 consumes the package, improvements
only ever flow forward, which is precisely the problem this section exists to
solve. Schedule it as the first work after Beat the Heat's game-night checkpoint.

✅ **Done 2026-08-01**, and slightly ahead of that schedule — it went *before* the
checkpoint rather than after. Flip 7 consumes the core, not just a corner of it;
its parallel data layer is gone.

Static frontend deploys make this safer than it sounds. A deployed app runs the
bundle it was built with, so nothing changes under Flip 7 until someone runs
`ship` on it deliberately.

## 6. Backend

One shared PocketBase on the droplet (`spahrfamily.duckdns.org`), one app key per
game, collections prefixed to match. Hooks live in `~/app-platform-backend/pb_hooks/`
next to the Flip 7 ones (`flip7_join`, `flip7_rounds`, `flip7_roster`,
`flip7_invites` — Beat the Heat mirrors this set as `heat_*`, Play Nine as
`nine_*`).

Backups are already covered by the platform's daily R2 job; a new app inherits it
with no extra work.

Access follows the platform model: anyone may invite, only Stacy approves, in the
Platform · Access panel. Hosts authenticate; guests never do.

### Guests don't authenticate, but they are not unidentified

A distinction this document originally blurred, and `createGate` depends on it.
"Guests never authenticate" is true of the *platform* — no account, no OTP, no
password. But joining by QR does mint a throwaway credential in `<app>_guests`,
bound to exactly one game, and that credential is real: PocketBase will validate
it and say which game it belongs to.

Two consequences, and both are why the gate can exist at all:

- Every guest permission rule in the schema is expressible natively — "the
  credential you hold belongs to this game" — with no signed tokens and no
  custom auth middleware.
- A server-side endpoint can therefore ask *"is this phone sitting at a game
  that is still being played"* without the player ever having signed in. That
  is what opened the rules adviser to players in v0.21.0, where before it had
  to be host-only.

⚠️ **The active-game half of that check is the whole gate.** A credential from a
finished night still validates — every `<app>_join` hook deliberately lets a
returning phone back in so it can still see the final card — so admitting on the
credential alone would leave every game ever played holding a key to a paid
endpoint forever.

This also puts a second kind of consumer on the backend. Until v0.21.0 the only
things talking to PocketBase were phones and the hooks running inside it; now an
app's `/api` function does too, over plain REST, with the caller's own token. It
reads the game with the *caller's* credential rather than a privileged one
precisely so the collection rule does the scoping and the gate never restates
it.

## 7. Knowing what's in a version

Two artifacts, and they answer the two questions that actually come up.

### "What can version X do?" → `CHANGELOG.md` in the kit repo

Written in terms of **capabilities, not commits.** Nobody cares that `game.ts`
was refactored; they care that seats can now be renamed. Newest first:

```markdown
## v0.3.0
- Added: seats can be renamed mid-game
- Added: leaderboard reveal can run sequentially instead of all-at-once
- Fixed: offline queue dropped submissions when the tab was
  backgrounded mid-reconnect

## v0.2.0
- Added: draft autosave — entry survives a dead phone
- Fixed: unclaimed seats were missing from waitingOn
```

A breaking change says so loudly and says what to do:

```markdown
## v2.0.0
- CHANGED: submit() takes a payload object instead of a number.
  Each app must update its submit call — see MIGRATING.md.
```

### "What version is each app on?" → the apps themselves

Each app's `package.json` is the source of truth. To see them all at once,
a shell function next to `ship`:

```
kit-status
  table-kit          latest: v0.3.0
  flip7-scorer       v0.2.0   ← 1 behind
  beat-the-heat      v0.3.0   ✓
```

That one line is what stops silent drift. Run it before a game night.

**Built 2026-08-01, and one column wider than sketched above** — because
`package.json` turned out *not* to be the whole source of truth:

```
kit-status
  table-kit  latest v0.21.0

  app              pinned    deployed
  flip7-scorer     0.21.0    0.21.0    ✓
  beat-the-heat    0.21.0    0.21.0    ✓
```

**pinned** is what `package.json` asks for — i.e. what is *committed*.
**deployed** is what the live site's `version.json` reports — i.e. what is
*actually serving*. Those two diverge the moment a bump is committed but never
shipped, and that gap is invisible in any single-column view. It is the same
distinction §9 makes below, arriving a section early because it turned out to
matter at two apps rather than four.

Three more things it does that were not planned:

- Warns when `~/table-kit` has commits of *shipping code* past the newest tag —
  the §5 footgun, caught by the tool instead of by discipline. "Shipping code"
  is `src/` minus what `tsconfig.build.json` already excludes, so a tag that
  only adds tests never reads as a version anyone is behind on.
- Fetches `version.json` cache-busted. Vercel's edge will happily serve a HIT
  from minutes ago, which would report the *previous* build as current — the
  exact lie the whole function exists to prevent.
- Names the newest tag that actually moved shipping code, so a docs-only bump
  doesn't make three apps look stale.

⚠️ **It does not list Play Nine.** That one has to be checked by hand:
`curl -s https://play-nine-golf.vercel.app/version.json`.

### Version numbers mean something

Simple rule, no semver theory required:

| Bump | Means | Safe to take? |
|---|---|---|
| `v0.3.**1**` | Bug fix | Always. Just take it. |
| `v0.**4**.0` | New capability added, nothing else moved | Always. Nothing you use changed. |
| `v**1**.0.0` | Something changed shape | Read the changelog first. |

Only the third kind needs thought, and it should be rare — most kit work is
fixing things and adding things, both of which are free to adopt.

### Where the app records its side

Each app's README gets one line: **"Runs on table-kit vX.Y.Z."** So opening any
app repo cold tells you where it stands without going hunting.

⚠️ **Not done in any of the three apps, and it should probably be dropped
rather than backfilled.** A hand-written version line in a README is a second
copy of a number `package.json` already holds, with nothing keeping the two
honest — which is the precise failure mode §9 is about. `kit-status` answers the
same question from the source, so the README line is a stale fact waiting to
happen.

## 8. Every app is a PWA

Not a per-app choice — a suite-wide constraint, so the PWA plumbing belongs to
the kit: manifest, service worker, offline shell, install prompt, update banner.
An app supplies its icons, its name, and its theme color, and nothing else.

### Two populations, one app

The rule Flip 7 learned the hard way, and the kit now enforces:

| | Host | Guest |
|---|---|---|
| How they run it | Installed to home screen | Browser tab |
| Return visits | Frequent | Often exactly once |
| Storage durability | Good | **Assume none** |
| Install prompt | Offer it | **Never show it** |

Guests scan a QR, play for an hour, and leave. Designing as though they might
install produces an app that nags people at a party — a direct violation of
principle 5. **Suppress the install prompt unless the user is an authenticated
host.**

Consequences that follow, all of them already kit responsibilities:

- **Guest storage is ephemeral by assumption.** Nothing may depend on a guest's
  `device_id` surviving. Durable identity is the roster.
- **The join token stays in the URL.** A backgrounded tab gets discarded and
  reloads; stripping the token would lock a player out mid-game with no way back.
- **Design for a browser viewport, not standalone.** `svh` never `vh` — and
  never `dvh` either: `dvh` tracks the toolbar as it comes and goes, so the
  screen resizes mid-scroll and a centered one drifts while you are reading it.
  Respect `env(safe-area-inset-*)`, and test with Safari's URL bar both expanded
  and collapsed.

  ⚠️ **`svh` is not sufficient on its own, and a real game night proved it.**
  It sizes a screen that *fits*, and for one that fits it does keep a bottom
  button clear of the chrome. But a score-entry screen is taller than the
  viewport, so it scrolls — and at the end of a scroll iOS re-expands the
  toolbar *over* the last stretch of the page, which is exactly where the
  primary button belongs. A guest at the first Beat the Heat table had to scroll
  the page to reach the one control the round was waiting on.

  No viewport unit gives that space back; only padding does. The kit's `.screen`
  now takes extra bottom padding under `@media (display-mode: browser)` — the
  honest test for "am I in a tab", not a user-agent sniff, and it means an
  installed app carries no dead space for chrome it does not have.

  The general lesson is the row above about storage: **the guest's environment
  is the one nobody develops in.** The host installs, so the host — and whoever
  is building the app — sees a standalone window all day. Every guest sees
  something else, and it is only ever noticed at a table.

### The update banner

Non-technical players will never force-refresh. The service worker detects a new
build and the kit shows a tap-to-update banner. This is the standing pattern
across all of Stacy's apps and it goes in from day one, never bolted on.

It composes with §5: a kit bump changes the app's assets, so the next `ship`
naturally surfaces the banner to anyone with the app open.

### The collision with §9 — read this before caching

**A service worker must not cache `version.json`.** It is the file that reports
which kit version is deployed; served from cache it would report the *previous*
build, and the dashboard and the ntfy cron would both confidently tell you an app
is current when it is a version behind.

Serve it network-first, or exclude it from precaching entirely. This is the one
place where "cache everything for offline" and "report the truth about what is
deployed" pull in opposite directions, and freshness wins — an app that fails to
load `version.json` offline costs nothing, since only the dashboard reads it.

## 9. Knowing when to bump

`kit-status` only helps if you happen to be at a terminal thinking about it. The
durable answer is that the system tells you.

### Report what's deployed, not what's committed

The trap: a dashboard that reads each app's `package.json` from GitHub reports
what is in the **repo**. That is the wrong number. Bump the dependency and forget
to redeploy, and production is still running the old kit while the dashboard
says you are current.

So each app publishes what it was **built** with, as a static file written at
build time from its own `package.json`:

```
https://flip7-vengeance.vercel.app/version.json

{ "app": "flip7", "kit": "0.2.0", "built": "2026-07-28", "commit": "a3f9c21" }
```

A ~10-line prebuild script emits `public/version.json`. It cannot drift from
reality, because it is baked into the deployed bundle.

**Do this from day one in every app**, well before anything reads it. It is the
data source the rest of this section depends on, and retrofitting it later means
touching every app in the suite.

✅ **Built, in all three apps**, off `table-kit/build`'s `kitVersion()`. The
advice to do it before anything read it was right: `kit-status` arrived weeks
later and needed no app changes at all, because the data was already being
published. Live example:

```
https://beat-the-heat-chi.vercel.app/version.json
{ "app": "heat", "kit": "0.21.0", "buildId": "...", "built": "2026-08-03T05:50:43Z" }
```

### The viewer: a Kit panel in Doorman

**Not built.** Two things have changed under this heading since it was written:
the admin UI was renamed from `platform-admin` to **Doorman** (`~/doorman`, and
the Vercel project is still called `platform-admin`, so the URL and the folder
disagree), and `kit-status` turned out to cover the
need at three apps — see the sequencing table below, which said this arrives at
three or four. It is the next thing to build here, not an abandoned idea.

`~/doorman` already exists and is where platform-wide administration
lives. The Kit panel fetches each app's `version.json`, reads the kit's latest
tag from the GitHub API (public repo, no auth), and renders:

```
table-kit  latest v0.3.0

beat-the-heat   v0.3.0   current
flip7-scorer    v0.2.0   1 behind — draft autosave, waitingOn fix
```

Show **what is missing**, pulled from the changelog entries between the two
versions — not merely that a gap exists. A bare "1 behind" is a number to
ignore; "you are missing the fix for entry lost on a dead phone" is a reason to
act.

### The nudge: a weekly cron

**Not built**, and correctly so: the trigger for it is "when bumping starts
slipping," and it has not. The one release that mattered so far was adopted by
every app the same day.

`platform_kit_check.pb.js` in `~/app-platform-backend/pb_hooks/`, modeled
directly on `mileage_reminder.pb.js`: fetch each app's `version.json` weekly,
compare against the latest tag, and ntfy-push only when something is behind.
Silent otherwise.

This is the actual answer to "how will I know to bump" — you do not check, it
tells you. Consistent with principle 5: it is the one place a notification is
appropriate, because it is aimed at the maintainer between game nights, never at
a player during one.

### Sequencing

| When | Build | Status |
|---|---|---|
| Day one, every app | `version.json` prebuild step | ✅ all three |
| Two apps | `kit-status` shell function — enough on its own | ✅ 2026-08-01 (misses Play Nine) |
| Three or four apps | The Kit panel in Doorman | ⬜ next |
| When bumping starts slipping | The weekly ntfy cron | ⬜ not yet warranted |

Building the panel at two apps is infrastructure ahead of need. Skipping
`version.json` at two apps is a retrofit across the whole suite later. Only the
first row is urgent.

Judged at three apps, that sequencing held. The one correction worth recording:
`kit-status` at two apps was not merely "enough on its own" — it was where the
*pinned vs deployed* distinction was discovered, which is the single most useful
idea in this section and would have been found much later from a dashboard.
