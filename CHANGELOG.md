# Changelog

Written in terms of **capabilities**, not commits — the question this file
answers is "what can version X do," not "what files changed."

Bump meanings: patch = bug fix, always safe to take. Minor = something new
added, nothing you already use moved. Major = something changed shape, read
before bumping.

## v0.30.0

- New: `removeSeat` — take a seat away, **in the lobby only**. Somebody taps
  the wrong name, or a seat gets added for a person who then turns up with
  their own phone; until now there was no way to undo either, in any of the
  three apps.
- ⚠️ **It refuses once the game is active or finished, and that refusal is the
  feature.** A seat's submissions relate to it, so deleting one mid-game
  rewrites the night to say that player was never there: every closed round's
  totals change, the share card loses a row, and their lifetime stats lose the
  game. Somebody leaving mid-game is a real thing that needs a real answer —
  `docs/SEATS_SPEC.md` designs it as a SPAN on the seat rather than the absence
  of one — and it is deliberately not this function.
- ⚠️ The status check is a **guard, not a gate**: the collection's `deleteRule`
  is HOST with no status clause, so a host client can still delete a seat at any
  point whatever the kit says. What stops that today is that nothing offers it.
- Step 1 of `docs/SEATS_SPEC.md`, which is new in this release and specs the two
  gaps behind it: nothing caps a table, and nobody can leave one.

## v0.29.0

- New: `TakeSeat` — sitting down without leaving the screen you are on. The
  host made a game, watched the lobby fill, and then "take a seat" pushed the
  join URL and swapped the whole app into the guest view: the lobby vanished, a
  screen asked who you were, and you arrived at a SECOND lobby with the same
  seat list and the same start button. Nothing was starting the game — the seat
  claim and `startGame` were always separate calls — but a transition that
  erases the screen you were waiting on erases the sense of still waiting, and
  what is left reads as a commit. Now the name lands in the list already on
  screen and the start button already on screen comes alive.
- `TakeSeat` never offers a seat another phone is holding. Taking over an
  occupied seat is the recovery path and it needs the confirm that explains
  what is about to happen; a confirm folded into a panel inside a lobby is
  where a mis-tap costs somebody their score. The phone that needs it lands on
  `SeatClaim` anyway — it has no seat, so it scans the code like everyone else.
- `onOpen` runs before a single name is drawn, and a failure there shuts the
  panel rather than listing names that cannot be tapped. It is where an app
  does whatever handshake taking a seat requires of it — on a host's phone that
  means joining its own game, because a seat cannot be claimed with a host
  credential.
- New: `TableBoard` and `WaitingOn` — the table mid-game for a phone that is
  not entering a card. Nothing in the kit ever required the host to play, but
  every screen that SHOWED the game needed a seat, so a host who sat one out
  got a list of names and no way to see the score. Keeping score for a table of
  people playing without phones was the one arrangement the apps could not do.
- `TableBoard` takes a `format` function rather than rendering numbers itself.
  A total is `+4` in Play Nine, a count in Flip 7, a pepper tally in Beat the
  Heat — the kit orders the board and marks who is still owing, and the game
  says what a number looks like.
- ⚠️ `TableBoard`'s `done` set is the CALLER's to build, and must come from
  final submissions only. `submittedThisRound` already drops drafts. A board
  that ticks a seat off on an autosave tells the table it is waiting for nobody
  while somebody is still holding a card.

## v0.28.0

- New: `ScorePad` — every banked round, for anybody at the table who wants one
  back. Pages one round at a time rather than drawing a grid, because a
  rounds-by-players grid does not fit a phone without squeezing a name, and the
  question it gets opened for ("what happened to Michelle last round?") is about
  one round anyway. Rows read exactly like the board.
- `ScorePad` shows **closed rounds only**, always. The round in play stays
  hidden the way every game in the suite hides it — a pad that leaked it would
  be a hole in the reveal reachable from every phone at the table.
- Correcting a round is now expressed rather than assumed: pass `fixable` with
  the one round you are willing to reopen and only that round's rows become
  tappable. Pass nothing and the pad is entirely read-only, which is what a
  finished game wants. Beat the Heat's old "fix a score" panel was this with the
  paging taken out, and has been replaced by it.
- New: `NoteBox`, `isOwner` and `saveNote` — an owner-only box for the snag you
  notice mid-game. Deliberately a plain `<textarea>`: the phone keyboard's own
  mic key is the dictation feature, so there is no speech API, no permission
  prompt and nothing to break offline.
- `isOwner` decides whether the button is DRAWN and nothing more. The
  `table_notes` collection names the same address server-side, which is what
  actually keeps the inbox private — see the platform backend.

## v0.27.0

- Changed: `LobbySeats` marks a phoneless seat with `NoPhone` instead of the
  `no phone` text pill. The lobbies kept the words on the grounds that they had
  the room — which lasted exactly one screenshot. The room was never the
  argument: a fact this load-bearing should not change shape between the screen
  where you meet it and the screen where you act on it, and the lobby is where
  you meet it.
- The mark sits beside the NAME rather than out at the right edge where the
  pill was. A lobby row has nothing on its right, so a pill there floated alone
  in open space with nothing to anchor it.
- ⚠️ An app with its own lobby list — all three have one on the host screen —
  has its own copy of the pill to swap. `.tk-lobby-seats .tk-no-phone` carries
  the gap the kit's own list needs; a list whose `.row-main` is already a flex
  box spaces it without help.

## v0.26.1

`NoPhone` redrawn, after looking at it on a phone rather than at the code.

- The glyph was a handset outline deliberately BROKEN at the corners the slash
  crosses — the theory being that it would read as struck through rather than
  smudged. At 17px it read as neither: a damaged rectangle. Now a plain rounded
  handset with a line laid across it, running past the body at both ends so it
  reads as a slash and not a crack.
- Sized at `1.15em` and barely dimmed, rather than `1em` at 0.75. It is a glyph
  among letterforms, so matching the cap height left it looking like a smudge —
  and this is the mark on the row that has to carry across a table, because it
  is the one asking somebody to volunteer.

## v0.26.0

- Added: `NoPhone` in `table-kit/react`. The mark for a seat playing without one
  — inline SVG, `currentColor`, `1em`, labelled for a screen reader. It exists
  because three apps were about to say the same thing three different ways, and
  "no phone" is the difference between a seat that fills itself in and one
  somebody has to volunteer for. Too important to look different per scorer.
- A glyph rather than the words, for the one place it has to go: ON a
  leaderboard row, beside a name, a tick, a total and sometimes a bar. The
  lobbies keep the text pill — they have the room, and a lobby is read once
  rather than glanced at every round.
- Added: `.tk-no-phone` to style it.
- Fixed: `button.row:active` set `background` — the SHORTHAND — which resets
  `background-image`. Flip 7 draws its distance-to-target bar as a gradient on
  the row itself, so the first time one of those rows became a button the bar
  blinked out for as long as a finger was on it. Now `background-color`.

## v0.25.0

Three things a second real game night asked for. All three were the same shape:
the app knew something and never told the table.

- Added: `startGame(gameId, client)` in the actions, completing the set that
  already had `closeRound`, `openNextRound` and `rematch`. ⚠️ The client is
  REQUIRED and must be a host — there is no guest default the way `loadState`
  has one, because only a host may write the games collection.
- Why it exists: a host is a player, and takes a seat through the same join
  link as everyone else. Once seated, all three scorers showed them "deal when
  everyone has scanned in" — on a screen with no way to deal. Dealing lived on
  the host screen alone, so the host bounced out of their seat to start the
  evening and then back into it. The host's phone holds a host credential
  already; now the button can live where the host is.
- Added: `Confirm` in `table-kit/react`. A card, not a modal — no overlay, no
  scroll lock, nothing that lands behind the iOS keyboard. `tone: 'danger'`
  for a brake in front of something destructive; the plain tone for a teacher
  in front of something merely unexpected. The confirm button carries the
  VERB, never "Yes."
- Added: `.row.tappable`, which draws a `›`. One mark on every row that goes
  somewhere, instead of a sentence under the list saying so. Beat the Heat's
  board said "tap a name to enter for that seat" in fine print under twelve
  rows, and a host who had played all evening had never read it.
- Docs: a note in the awards engine on why a "nearest to X" award needs an
  eligibility floor. Without one it is not an award, it is a ranking of
  everybody who didn't cross, and somebody wins it on a night when the nearest
  player was half a game away.

<!--
  v0.22.0 – v0.24.0 were tagged without entries and are BACKFILLED, written on
  2026-08-03 from the tags, the diffs and the commit messages rather than at the
  time. They are the rulings loop, built in three phases across two days: keep
  the question, read the questions, count the repeats. Treat the reasoning as
  accurate — it is quoted from the commits — and the framing as reconstructed.
-->

## v0.24.0

A question can say it is not the first of its kind.

- Added: `askedBefore`, `sameQuestion`, `questionTerms`, `ordinal` and
  `pastRulings` in `table-kit`. A question arriving on the triage screen now
  carries how many times it has been asked before.
- Why it was needed: the guidance says a question about something the rulebook
  already covers wants two or three askings before the sheet is worth touching
  — and the correct handling of the first one is to dismiss it, which is exactly
  what makes the second one unrecognisable. "Wait for a repeat" was a rule
  nobody could act on.
- How it matches: word overlap after stopwords and a crude plural strip, biased
  hard toward saying no — two shared subject words AND a third of the union. It
  will miss a rephrasing, and that is the trade taken on purpose. A missed
  repeat leaves you where you already were; a false one writes a rulebook entry
  for an argument that never happened twice.
- ⚠️ The archive read fails SILENTLY. No count is a worse screen; a broken one
  is a useless screen.
- Added: `.tk-ruling-tag.again`.

## v0.23.0

Somewhere to read the questions, and decide what they mean. Phase B — v0.22.0
kept every question, this is the screen where somebody reads them.

- Added: `RulingsList` in `table-kit/react`, plus `openRulings`,
  `decideRuling`, `completeRuling`, `dismissRuling`, `splitRulings`,
  `looksLikeGap`, `rulingsCollection`, `OPEN_RULINGS_FILTER` and
  `BUCKET_LABEL` in `table-kit`.
- It is the whole feature for as long as the volume stays where it is, and it
  works with no mail at all — the app gets opened before a game night anyway.
- Three buttons, not four. Two of the spec's buckets both end in editing text
  that already exists, so they are one choice. The one worth understanding is
  "fix the sheet": if people keep asking something the rulebook already answers
  plainly, the rule is not the problem, the sheet buried it, and a fourth entry
  saying the same thing makes the sheet longer and no clearer.
- ⚠️ Deciding is not doing. A triaged ruling stays OPEN — `bucket` set,
  `status` still new — because the rulebook is a file in a repo and the edit
  happens later on a machine with an editor. Clearing it at the moment of
  decision would file the decision and lose the job it created. Hence two
  piles: one wants thirty seconds of judgement, the other wants a laptop.
- `looksLikeGap` reads the ADVISER's own words rather than classifying
  anything. Every scorer's prompt already tells it to say when the rulebook
  doesn't settle something, so those rows identify themselves — no classifier,
  no second model call, nothing added to the wait at the table. A hint and
  never a filing decision: it is prose matching and can miss a phrasing.
- Added: the `.tk-ruling-*` block.

## v0.22.0

The kit keeps the question, not just the ruling. Phase A.

- Added: `logRuling` on the gate from `table-kit/server`, and the
  `RulingRecord` shape. Each question the adviser is asked is filed against the
  night it came from.
- Why: the Ask box answered and threw the question away. A question is a hole
  in the rulebook with a person standing in it, and a question asked three
  times on three nights is the strongest evidence there is that a rule is
  missing.
- ⚠️ The collection is derived from the GUEST prefix, not the app slug. Flip 7
  is `flip7` while its collections are `f7_*`, so the obvious derivation would
  post into thin air for exactly one app — and silently, because logging is not
  allowed to fail loudly. A lost question is a shame; a lost ruling is somebody
  standing over a hand mid-argument.
- Docs: `TABLE_KIT_ARCHITECTURE.md` moved in from beat-the-heat — it stopped
  being that repo's document once three games shared it — and the spec sheet
  caught up with the server entry point and the rules sheet.

## v0.21.0

The rules sheet becomes the kit's, and so does the gate in front of the adviser.
Both came out of Beat the Heat's first real game night; all three scorers had
their own near-identical copy of each.

- Added: `RulesSheet` in `table-kit/react`. The offline rulebook, the search
  box and the ask thread, with the rulebook and the voice arriving as props —
  `sections`, `adviser`, `askIntro`, `askExample`, `askContext`. A game owns
  its rules and what it calls its adviser; nothing else about the screen is
  the game's.
- Two fixes come with it, both off the table. The header is STICKY, so leaving
  a long rulebook no longer costs a scroll back to the top. And the two halves
  are TABS rather than stacked, so reaching the adviser is one tap instead of
  scrolling the whole rulebook past — while the rulebook stays what opens,
  because a first-timer needs the lesson and not a question box.
- Added: `createGate` in a new `table-kit/server` entry — plain `fetch`, no
  DOM, no SDK, importable from a Vercel function. `verifyHost`, `verifyPlayer`
  and `verifyAsker` against any app's own collections.
- Why `verifyPlayer` matters: the adviser was host-only everywhere, which made
  the host a bottleneck during exactly the argument the adviser exists for. A
  guest credential is bound to one game and PocketBase will vouch for it, so
  "is this phone at a game still being played" is answerable — and it is the
  right question. ⚠️ The active-game check is the whole gate for a player: a
  credential from a finished night still validates.
- Added: `.sheet-top`, `.sheet-head`, `.tabs`, `.tab` and a `--tk-page` token
  (the page's own ground, which the sticky header needs behind it).
- ⚠️ `.sheet-head` no longer carries the sticky behavior — `.sheet-top` wraps
  it. An app with its own `.sheet-head` rule keeps it for voice; delete any
  position/margin from it.

## v0.20.3

- Fixed: a screen running in a browser TAB now clears the browser's own bottom
  chrome. `.screen` and `.qr-screen` take extra bottom padding under
  `@media (display-mode: browser)`, tunable as `--tk-screen-pad-browser`.
- Why it matters: the host installs, but every GUEST plays in a tab, and at a
  real table the hand-in button sat under Safari's address bar — you had to
  scroll the page to reach the one control the round was waiting on. `svh`
  sizes a screen that FITS and cannot help here: an entry screen scrolls, and
  iOS re-expands the toolbar over the end of a scrolled page.
- An installed app is untouched — no dead space for chrome it doesn't have.

## v0.20.2

- Fixed: `loadState(gameId, client?)` now takes the client to read with, and
  defaults to the guest as before.
- Why it matters: the guest credential is bound to ONE game — its token carries
  the game it joined, and every rule that admits a guest admits it only for
  that game. Reading any other game with it comes back **empty rather than
  failing**, so a host screen opening an old game showed an empty board with
  nothing to say why. Flip 7's host screen was doing exactly this; it had a
  `pb` parameter it passed and the kit quietly ignored.
- A host client is admitted for every game it owns, so a host screen should
  pass `pbHost`. Play Nine and Beat the Heat read their host screens with
  `pbHost` directly and were never affected.
- Widening only. Passing nothing behaves exactly as before.

## v0.20.1

- Fixed: `.btn` is `display: block`, so a `CountdownRing` inside one sat on the
  text's baseline instead of beside it. A button containing a ring is now a
  centred flex row, scoped with `:has()` so no app needs a modifier class and a
  button without a ring keeps the block layout it always had.
- Button height is unchanged with the ring in place — measured, not assumed.

## v0.20.0

Four playability fixes off a real game night.

- Added: `minPlayers` on the config, `lobbyState()`, and a `useLobby` hook that
  polls the seats. A lobby now fills up in front of the host instead of sitting
  as dead space, and the start is held until the table is big enough.
- The FLOOR is the game's, never the kit's — Flip 7 needs three, the other two
  play with two. `lobbyState` reports `shortBy` and `minPlayers` so the app can
  write its own sentence around a number that is guaranteed to be the one being
  enforced. The default is 1, which is the `players.length === 0` check every
  app was already carrying, expressed as a rule.
- Added: `LobbySeats` — names only. What the lobby SAYS stays with the game.
- Added: `useAutoSubmit` + `CountdownRing`. Once everybody's score is down, a
  ring drains over 15 seconds and the round hands itself in.
- ⚠️ Exactly ONE device may arm it. Every phone renders the same "score the
  round" button, so arming it everywhere would have the whole table close the
  same round at the same instant — and a close is not a no-op, the server
  opens the next round off it. The app passes `armed` on the host's phone and
  false on the rest; the kit does not pick.
- Any touch cancels, and it stays cancelled for that round. The game is played
  on the table, and fifteen seconds after the last score the table is often
  still talking. Re-arming after someone has said wait is the app arguing.
- ⚠️ Changed shape: `shareCard(file)` no longer takes a title. iOS staples one
  beside the image as a line of text, so a card that already says the game's
  name across the top went out with the name written twice. Callers must drop
  the second argument.

## v0.19.0

- Added: `bootstrapJoin` takes an optional `rosterSort`, defaulting to the
  alphabetical sort it already used.
- Why: `seatChoices` CAPS the list it shows, so the roster's sort decides which
  names survive the cap — not merely the order they appear in. Flip 7's roster
  carries `last_played` and `games_count` and sorted on them deliberately, so
  the six names offered are the people most likely to be at the table. Reading
  that roster alphabetically instead would have quietly changed who gets
  offered a one-tap seat.
- It is a parameter for the same reason `rosterFilter` beside it is one: the
  columns differ per game — Play Nine's roster has no counters to sort on — and
  the kit must not learn any of them.
- Widening only. An app that passes nothing behaves exactly as before.

## v0.15.0

- Added to `styles.css`: `label`, `input`, `textarea`, `select`, `.code-input`,
  and the `--tk-label-*` / `--tk-field-*` tokens behind them.
- Why: v0.12–v0.13 moved screens that RENDER form fields into the kit
  (`HostLogin`, `SeatClaim`, `InviteHost`) while leaving the fields themselves
  unstyled. A new app got an inline label beside a shrink-to-fit input — the
  component only looked right in an app that happened to already have the
  rules. Shipping a component without its bones is shipping it broken.
- The label's case is a declared per-app trait, like chrome case. The default
  is Beat the Heat's uppercase, so nothing changes for an app that adopts this;
  Play Nine sets `--tk-label-case: none`.
- A label sits ABOVE its field, never beside it. Inline labels put the field at
  a different x-position on every row, so the eye re-finds it each time.

## v0.14.0

- Changed: `claimSeat` with an EMPTY `deviceId` makes a phoneless seat — no
  `device_id` and no `guest`. That absence is what marks a seat unclaimed, and
  it is what lets anyone at the table enter for it or take it over later.
- Why it is the same function rather than a second one: a phoneless player is a
  seat like any other and appears in `waitingOn` like any other, which is what
  stops them being quietly forgotten at the end of a round. A separate code
  path is exactly how that guarantee gets lost. It also removes a second copy
  of the collision retry, which both apps' host lobbies were carrying.
- Widening only — passing a device id behaves exactly as before.

## v0.13.1

- Fixed: an unused import left the repo's `typecheck` failing. The published
  v0.13.0 package is unaffected — `tsconfig.build.json` excludes test files, so
  `dist/` was byte-identical — but a red typecheck on main is a red typecheck.

## v0.13.0

Joining a game night is the kit's, all the way to the seat.

- Added: `bootstrapJoin`, `claimSeat`, `reclaimSeat` — the token exchange, the
  already-seated reload check, seat allocation past a collision, and taking
  back an existing seat.
- Added to `table-kit/react`: `SeatClaim` — the "who are you?" screen. Takes
  the app's lockup as `brand` and nothing else game-shaped.
- Added: `Collections.roster`, optional, defaulting to `<appKey>_roster`. Flip
  7's collection is `f7_roster`, which predates the convention — naming it in
  config is what keeps a per-app special case out of kit code, which the seam
  rule forbids outright.
- NOT included, deliberately: the lobby copy, what a game calls its goal, and
  the play screen. Those differ per game for real reasons, and swallowing them
  would need a prop per sentence. An app's join screen is now: call
  `bootstrapJoin`, render `SeatClaim` while claiming, render its own screens
  once seated.
- `claimSeat` walks the seat number up past a unique-index collision rather
  than failing. Everyone scans the QR at the same moment, so the player list a
  screen loaded with is stale immediately — this is the normal case, not an
  edge one.

## v0.12.0

The screens with no game in them move into the kit, so a third app stops being
a third copy.

- Added to `table-kit/react`: `UpdateBanner`, `HostLogin`, `NoAccess`,
  `Pending`, `InviteHost`. All take the app's PocketBase client and its name as
  props; `HostLogin` takes the app's own lockup as `brand`, because a sign-in
  page that introduces the app differently from the app is where "which one is
  this again" starts.
- Added to the core: `reveal.ts` — `RevealRow`, `totalsAsOf`, `rowsForRound`,
  `revealLayout`. The leaderboard re-sort, which both apps had their own
  character-identical copy of.
- `revealLayout` now takes `{ winner, rowHeight, gap }`. Those were the ONLY
  differences between the two copies: Beat the Heat sorted ascending at 68px
  rows, Flip 7 descending at 56px.
- `rowsForRound` reads a round that is still in `review`, deliberately.
  Requiring `closed` would mean every row's `after` equalled its `before` and
  nothing ever moved — the reveal plays before the round closes.
- The drift this was fixing, as evidence it was real: Beat the Heat's update
  banner used the kit's `watchForUpdates`; Flip 7's still carried its own copy
  of the polling loop. A fix to one was not a fix to the other.
- The iOS share-sheet ordering in `InviteHost` is now covered by a test that
  asserts `navigator.share` is called BEFORE the create is awaited. Await first
  and the activation window has closed and the sheet silently never opens.
  Both apps learned that the hard way; now it can only be learned once.

NOT extracted, and the reason matters: `JoinScreen`. The two versions differ by
about half, and not only because Flip 7 is behind — `f7_roster` carries
`games_count` / `last_played` / `active` where `heat_roster` carries `retired`.
Sharing it means deciding which roster shape wins, which is a design decision
rather than a move. Same test the design system already applies to `.tick` and
`.pill`.

## v0.11.0

A game can end after a fixed number of rounds — and can tell it is on the last
one *before* that round is played.

- Added: `EndCondition`, either `{ type: 'points', value }` or
  `{ type: 'rounds', value }`, accepted anywhere a bare goal number was. A bare
  number still reads as points, so nothing has to change to take this.
- Added: `endReached`, `roundsPlayed`, `roundsLeft`, `isFinalRound`.
  `goalReached` is now an alias of `endReached` and behaves exactly as before.
- Added: `roundScope(state, round)` and `gameScope(state)` — the two contexts
  the awards engine was already written to accept.
- Why the type rather than a second function: the two shapes answer different
  questions. `points` asks "has anyone got there yet", which depends on how
  people are playing. `rounds` asks "have we played them all", which depends
  only on the calendar and is therefore knowable in advance. `isFinalRound`
  exists to sell exactly that asymmetry, and returns false for a points game
  always — not because it might not be the last round, but because nobody could
  know.
- Why the scopes: per-round callouts were bespoke code in each app, so a third
  game meant a third copy. They are now the same machinery as end-of-game
  awards pointed at different submissions. `roundScope` deliberately does NOT
  require the round to be closed — the reveal plays while the round is still in
  review, and waiting for closed would mean a callout never fires. It also drops
  seats that joined later, so no game has to remember to return null for a
  latecomer in every measure it writes.

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
  empty. Everything below the lockup is now centered in the space it has, so a
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
- `shareCard` treats a canceled sheet as done rather than falling back to a
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
  whatever ground a game sets without either app hand-picking a fifth color.

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
  the column since the day they were created; the kit simply never modeled it,
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
