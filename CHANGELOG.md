# Changelog

Written in terms of **capabilities**, not commits — the question this file
answers is "what can version X do," not "what files changed."

Bump meanings: patch = bug fix, always safe to take. Minor = something new
added, nothing you already use moved. Major = something changed shape, read
before bumping.

## v0.10.0

A phone remembers **one** name — the last person who sat down on it. It used to
keep three.

- Changed: `recalledSeats` returns at most one seat, so the seat-claim screen
  offers a single "I'm …" button instead of a short list. Nothing about the API
  moved; only how many rows come back.
- Why: three was for the household phone that gets handed round, which is real
  but rare, and it was charging the common case for it. A phone belongs to a
  person and the shortcut is meant to say "you" — two names is a question, and a
  question is what a one-tap shortcut exists to avoid.
- The failure that decided it: one mis-tap on somebody else's name and the phone
  offered two people from then on, with no way back short of "not me". At one, a
  mis-tap **replaces** the memory rather than adding to it, so the next correct
  pick fixes it.
- No migration. A phone already holding three sorts by recency and shows the
  newest, then shrinks to one the next time anyone sits down.

## v0.9.1

The card measures itself before it draws. Both bugs this fixes were only
visible once a real one was rendered.

- Fixed: a four-seat game with two awards left the bottom third of the card
  empty. Everything below the lockup is now centred in the space it has, so a
  short card reads as composed rather than as a long one that ran out of things
  to say.
- Fixed: an eight-seat game with five awards ran off the bottom. The trim was
  estimating award heights instead of measuring the wrapped text, so it stopped
  one award too early. It now wraps once, keeps the lines, and both the trim and
  the draw use the same numbers.

## v0.9.0

The share card, from `SHARE_CARD_SPEC.md`. One tap at the end of a game
produces a branded picture of who won and what happened, handed to the share
sheet.

- Added: `renderCard(spec)` → a PNG `Blob`, and `shareCard(file, title)` → the
  share sheet with a download fallback. Plain async functions: **the core still
  has no React dependency**, and the button stays a game component.
- The kit lays out the card and writes not one word of it. Wordmark, headline,
  winner line, award titles and blurbs are all passed in, because "wins on 41
  peppers — the fewest at the table" is Beat the Heat's sentence and inverting
  it is the point of that game.
- Every seat is drawn, phoneless ones included. When a full table will not fit,
  board rows lose their air first, then awards are trimmed **from the top** —
  the list is editorially ordered with the funny one last, so cutting from the
  end takes the punchline.
- `shareCard` treats a cancelled sheet as done rather than falling back to a
  download. Closing the sheet is the user doing what they meant to.
- ⚠️ Call `renderCard` on mount, never in a tap handler. iOS ends the gesture at
  the first `await` and then silently refuses to open the sheet — the same trap
  already documented in both apps' `InviteHost`.

## v0.8.0

Two classes both games needed the moment their home screens were rebuilt.

- Added: `.row.chosen` — a row picked but not yet committed to, which is what a
  new-game list becomes once its presets select instead of firing on tap. Border
  **and** a tint: at arm's length in bad light, a 1px border change on a row
  that already has a border is not a selection anybody can see.
- Added: `.screen-title` — the heading on a screen that isn't home. It is not
  the wordmark, deliberately; a sub-screen should say what it is rather than
  repeat the app's name to someone already holding the phone.
- `color-mix` does the tint against `--tk-row-bg`, so the selection works over
  whatever ground a game sets without either app hand-picking a fifth colour.

## v0.7.0

The brand lockup joins the kit — icon, wordmark, tagline, as one arrangement
both games share. Beat the Heat had it; Flip 7 had a bare `<h1>` in a top bar
and no tagline at all, which is why the two home screens never looked like
siblings.

- Added, in `styles.css`: `.brand`, `.lockup`, `.mark`, `.tagline`. Layout only
  — the mark itself is the game's own SVG and stays in the game, because art is
  never kit code.
- Added tokens: `--tk-brand-{ink,size,case,weight,tracking,gap,mark}`. The
  wordmark gets its own set rather than riding on `--tk-chrome-*` because an
  app whose buttons are sentence case can still want its own name in caps —
  which is exactly the Flip 7 case.
- Nothing moved. An app that already styles `.brand` itself keeps winning, since
  its own stylesheet loads second.

## v0.6.0

Night grouping becomes the kit's. It was the same function in both games, and
the two copies had drifted far enough that one Friday read differently
depending on which app you opened.

- Added: `nights.ts` in the core — `groupByNight`, `nightKey`, `nightLabel`,
  `parseStamp`, `timeOfDay`. Nothing already exported moved, so taking this is
  safe; the apps switch over on their own schedule.
- Changed, for whoever adopts it: **the label for today is `Today`, not
  `Tonight`.** Both games said Tonight for anything created on the current day,
  which is wrong every time somebody plays in the morning — an 11:15am game
  filed under "Tonight" looks like a bug in the history. "Today" is true at
  every hour and costs nothing, because the clock time is already on each row.
  The bucket is still a night. Only the label stopped claiming to know.
- The kit's version takes Beat the Heat's 5am rollover (a game finishing at
  00:40 stays with the evening that produced it) and Flip 7's short date format
  (`Fri, Jul 24`, which doesn't wrap on a phone). Flip 7 keyed on the calendar
  day, so games it used to split across two dates now group as one night.
- `Night<T>` carries `items`, matching Beat the Heat. Flip 7's own copy called
  it `games`; that rename is the one edit its screen needs.

## v0.5.2

Nothing an app can call changed — this is a housekeeping release, tagged so
`kit-status` stops reporting untagged work that apps can never install.

- Added: five tests pinning the auth-store key names. `${appKey}_host` and
  `${appKey}_guest` are a contract with every phone already carrying a session,
  not an implementation detail: rename one and every host is signed out, and
  getting back in means waiting on an emailed code — which at a table on a
  Friday night is the end of the game. Flip 7's migration onto `createKit` was
  only safe because `${appKey}_host` lands on exactly the `flip7_host` its
  hand-rolled clients used.
- Docs: v0.5.0 and v0.5.1 shipped as tags without changelog entries. Both are
  written up below now.

## v0.5.1

- Added: `guest` on `PlayerRec`. Both games' players collections have carried
  the column since the day they were created; the kit simply never modelled it,
  because Beat the Heat's client never reads it. Flip 7's does — it is how a
  returning phone works out which seat is already its own, alongside
  `device_id`. Nothing changed in the database. Only the type was missing.

## v0.5.0

The join QR becomes the kit's. It was the same component in both games,
differing by a share-sheet title and two comments — which is how its quiet zone
came to be wrong in both at once.

- Added: `table-kit/react`, a NEW entry point, and `QrPanel` in it. The core
  stays framework-free: seats, sync, the offline queue and the awards engine
  have no business knowing what renders them, and importing the core must not
  pull React in behind it. Import this module and you need `react` and
  `qrcode`; import the core and you need neither — they are optional peers for
  exactly that reason.
- Added: `gameName` on `QrPanel`, the one genuine difference between the two
  copies. It fills the share sheet's "Join the … game", so each app names
  itself once rather than at every call site.
- The panel arrives wearing whichever game imported it — every class it renders
  is the kit's own, in the `.qr-*` block of `styles.css`.

## v0.4.0

Finding yourself on the seat-claim screen. The roster is permanent and never
stops growing, which is right for lifetime stats and wrong for a phone: after a
season, sitting down means scrolling past everyone who has ever played.

- Added: `rememberSeat(appKey, seat)` and `recalledSeats(appKey)`. The phone
  records who sat down on it, so a regular arriving on their usual handset gets
  a one-tap button instead of a list. This is the fix that matters — almost
  everyone comes back on the same phone.
- Added: `seatChoices({roster, seated, recalled, query, limit})`. Returns
  `suggested` (what this phone knows), `reclaimable` (a seat already at this
  table matching what it knows — a host-added seat waiting for its player, or
  one they were in before), a `list` capped at `limit`, and `hiddenCount`.
- Added: search. `query` filters the whole roster, uncapped, with names that
  start with what was typed ranked above names that merely contain it.
- Added: `forgetSeats(appKey)`, for a "not me" escape hatch.
- Memory is per app key and best-effort: evicted storage degrades to the full
  list, never to a locked-out player. Anyone already sitting is dropped from
  the roster side entirely, so a returning player takes their seat back rather
  than opening a second one under the same name.
- Also importable as `table-kit/roster` — it is pure logic with no PocketBase
  in it, so an app that has not adopted the kit core can still take it.
- No markup, as ever. The kit ships the decisions; each game draws them.

## v0.3.0

The awards engine — the "capture the fun" layer, minus any opinion about what
is fun in your game.

- Added: `runAwards(defs, ctx)`. A game supplies definitions (what to measure
  per player, which end wins); the kit runs eligibility, ranking, ties, and
  drops awards nobody qualified for. It never learns what is being measured.
- Added: `pick: 'highest' | 'lowest' | 'all'`. The third is for threshold
  awards — "never took more than five in a round" is true or it isn't, and
  ranking the people it's true of would hand it to one of them for no reason.
- Added: `measure` returns `number | null`, where null means NOT ELIGIBLE. That
  is a different thing from zero: "took the most cards" with nobody having
  taken a card should produce no award, not a three-way tie on nothing.
- Added: `submissionsByPlayer(ctx)` and `closedSubmissions(rounds, subs)` —
  the two scopings every definition wants. Both exclude drafts.
- Ties always share. There is no tiebreak option: at a table an award is a
  thing you say out loud, and "Nana and Grandpa both got scorched" is a fine
  sentence.

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
