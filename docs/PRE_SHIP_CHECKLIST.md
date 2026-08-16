# Pre-ship checklist

**Run this before the first real table sits down with a new scorer.**

Every line below is here because a real person hit it on a real evening, and
each one names the app that found it. That provenance is the point: this is not
a list of good ideas, it is a list of things that have already gone wrong, and
an item with a name against it is much harder to wave away.

> ## ⚠️ The reason this file exists
>
> **10,000 rediscovered four things the suite already knew.** Its first morning
> produced "no way to delete a game" — which is *word for word* what Oh Hell's
> first real game produced, already written down. It also shipped without a
> phoneless-seat control that Oh Hell has, and repeated a host-seat mistake Beat
> the Heat had already diagnosed and fixed.
>
> None of those were hard problems. They were **solved problems in a sibling
> app**, rebuilt around instead of inherited. That is the failure this checklist
> is aimed at — not the individual bugs.

Tick these against the app you are about to ship. An unticked line is a decision
to ship without it, which is fine — but make it a decision.

---

## 1 · Deploy plumbing

- [ ] **Deployment protection is actually off.** ⚠️ Check with `curl` and
      **no `-L`**:
      `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>`
      A 302 to `vercel.com/sso-api` means the whole site is a login page.
      *Every new Vercel project ships with this ON.* — **Crib Sheet, Oh Hell and
      10,000, three times in nine days.**
- [ ] ⚠️ **`ship` reported HTTP 200 all three of those times**, because it
      follows the redirect and lands on the login page. A green `ship` is not
      evidence the site is public.
- [ ] `version.json` is served and **not cached by the service worker**. Served
      from cache it reports the previous build, and everything reading it then
      confidently says the app is current when it is a version behind.
- [ ] `ANTHROPIC_API_KEY` is on the project **and a redeploy has happened since**
      — Vercel does not apply a new variable to an existing build.
- [ ] `kit-status` shows **pinned = deployed**. They diverge when a kit bump was
      never shipped, which is invisible any other way.
- [ ] Re-pinning the kit: `npm install "github:stacyspahr/table-kit#vX.Y.Z"`
      explicitly (the lockfile holds the SHA), then `rm -rf node_modules/.vite`,
      or Vite serves the old pre-bundled copy and new exports come back
      `undefined`.

---

## 2 · Test data you left behind

- [ ] ⚠️ **Purge `<app>_roster`.** Deleting a throwaway game does **not** cascade
      to the roster — `<app>_roster.pb.js` auto-promotes a name the moment a
      seat is created, so smoke-test names outlive the games that made them.
      — **10,000**, where the roster contained only *Ann, Bo, Cass, Dee, Eli*
      and the host's first act was to sit down as "Eli".
- [ ] Throwaway games deleted, and `<app>_guests` checked for probe credentials.
- [ ] Any temporary superuser created for testing is **deleted**, and verified
      deleted.

---

## 3 · The lobby — can a table actually start?

This is where every app in the suite has lost the most time, because it is the
one screen that must work before anyone can find out whether anything else does.

- [ ] **A phoneless seat can be added.** "No phone at all" is a NORMAL case at a
      table, not an edge case (principle 4). ⚠️ With `minPlayers: 2` and no such
      control, a host alone with one phone **cannot start at all** — the button
      reads "Needs 1 more" and nothing on screen can produce the seat.
      — **10,000.**
- [ ] **The host can start from the seat they just took.** Hosting and playing
      are the same evening. If start lives only on the screen the host has just
      left, they are stranded on the one they are standing on.
      — **Beat the Heat** ("I sit down and start the game at the same time"),
      **10,000** (start reachable only via a quiet "Host controls" link back).
- [ ] **A seated player can get back to their seat.** ⚠️ A lobby that always
      offers "take a seat" leads nowhere for somebody already sitting — it needs
      a `mySeat` check and a "Back to my hand". — **Oh Hell.**
- [ ] **The seat list marks which one is YOU.** ⚠️ The kit's `LobbySeats` draws
      bare names and cannot do this. "I take a seat and I don't see that I am
      in" was reported by somebody looking straight at a list containing them.
      — **10,000.**
- [ ] **The disabled start button says how far short the TABLE is, never who is
      missing.** `shortBy` is a distance to the floor and carries no information
      about who is still coming; "waiting for you" was wrong because one scanned
      guest against a floor of two could equally mean four more people are
      walking over. — **Beat the Heat.**
- [ ] ⚠️ **A host cannot claim a seat with the host credential.** `claimSeat`
      writes the caller's auth record into `guest`; a host user id there lands a
      seat no phone can take back. Join through `bootstrapJoin` like everyone
      else.
- [ ] **You did not wrap a kit component that already has its own trigger.**
      ⚠️ `TakeSeat` is a *button and the panel it opens*, holding its own state.
      Wrapped in a second same-labelled button, one tap swaps one for the other
      and **the screen appears completely dead**. Typechecks, builds, all tests
      pass. — **10,000.**

---

## 4 · Destructive taps

- [ ] **A game can be deleted.** ⚠️ Test games accumulate from the very first
      evening, because the first evening *is* testing.
      — **Oh Hell**, then **10,000 repeated it**, which is why this file exists.
- [ ] **Nothing destructive is one tap.** Two taps, a sentence saying what goes,
      and never a swipe. The destructive action at a table is the one somebody
      does by accident while passing their phone across to show the board.
      ⚠️ 10,000 shipped seat-removal as a single tap inside a `<details>`
      labelled "Remove a seat" — opening a disclosure triangle to see what it
      does is exactly what a person does with one.
- [ ] Deleting a game cascades to seats/rounds/submissions but **never the
      roster** — those are the people who play here, and they outlive any night.
- [ ] `removeSeat` is **lobby-only**, and the refusal is the feature: deleting a
      seat mid-game rewrites the night to say that player was never there.

---

## 5 · The play screen

- [ ] **A guest plays in a browser TAB.** ⚠️ The primary button sits under
      Safari's address bar without extra `.screen` bottom padding at
      `@media (display-mode: browser)`. **`svh` cannot fix this** — it sizes a
      screen that FITS, and an entry screen scrolls. — **Beat the Heat**, and it
      was invisible from every chair except a guest's.
- [ ] **A draft is not an answer.** `waitingOn`, the totals, the board's ✓, the
      entry screen's mount condition and the server hook must all require
      `final`. Three separate bugs came from forgetting it.
- [ ] The round hook filters **`status = 'final'`**, not `status != 'draft'`, if
      the app has any third state or writes drafts frequently. — **Oh Hell**
      (a `bid` is not an answer), **10,000** (a draft on every keypad tap).
- [ ] **Never auto-navigate to an entry screen.** The board is the default
      always; one primary button is whatever the table is waiting on.
- [ ] **Keys do not move between taps.** A chip strip that grows as it fills
      pushes the keypad around mid-count, and re-aiming between taps is the
      thing a keypad exists to prevent. — **Beat the Heat.**
- [ ] The update banner is **deferred on any screen whose taps commit on
      contact**. It is sticky and in normal flow, so it shifts everything below
      it by ~60px, and a poll can land it between two taps. — **Oh Hell**, where
      a deploy mid-entry overwrote a count that was already in.
- [ ] Flex gotcha: a note nested inside a name box runs into the name, because
      the name box is a flex **item**, not a container. — **Oh Hell.**
- [ ] ⚠️ **Every text input is `font-size: 16px` or larger.** iOS Safari zooms
      the whole page in when you focus anything smaller, and there is no way to
      decline it except by being 16px. An input inheriting a label's `0.85rem`
      is ~13.6px and will do it. **Do not fix this with `maximum-scale=1` or
      `user-scalable=no`** — that takes pinch-zoom away from everybody for the
      whole app, which at a table in bad light is the opposite of the point.
      — **10,000**, on an autofocused "add someone without a phone" field.
- [ ] ⚠️ **Copy `src/styles.test.ts` in** — `classCoverage` from
      `table-kit/lint`, pointed at BOTH your source and
      `node_modules/table-kit/dist`, against BOTH stylesheets.
      **The classes an app forgets are the ones the KIT renders and leaves it to
      style**, so nothing in your own files mentions them and no amount of
      reading your code finds them. — **Oh Hell**, whose game-length picker
      shipped invisible; **10,000**, which then shipped without the guard and
      had seven unstyled classes on the rules sheet, including the whole Ask
      box. ⚠️ `used` in the return is a COUNT, not an array.

---

## 6 · Ending, and after

- [ ] The share card is offered **when the game ends**, not only from history.
      — **Beat the Heat** was the only app that didn't, and it showed.
- [ ] ⚠️ `renderCard` on mount, `shareCard` in the tap handler. iOS ends the
      user gesture at the first `await` and then refuses the sheet with no error.
- [ ] A scored round can still be corrected, if the app has a reopen path at
      all — and a correction **never writes a draft** over a banked entry.
- [ ] Awards: `measure` returning `null` is NOT ELIGIBLE, which is not zero.

---

## 7 · The rules sheet

- [ ] **It teaches from zero.** These games are given away in printed boxes with
      no rulebook, so this sheet is the only rules the recipient will ever have.
      Object → what you need → how a turn runs → what scores → what goes wrong →
      a fully worked example → scoring. The search box serves reference use; the
      *order* serves a beginner.
- [ ] **One source, two readers** — the sheet and the adviser's prompt read the
      same file, so they cannot disagree at the same table.
- [ ] The worked example is a **test fixture**, asserted against the engine.
- [ ] The adviser is reachable by **anyone at a game still being played**, not
      just the host. — **Beat the Heat.**
- [ ] House rules are **printed back into the sheet**. A rule nobody can look up
      mid-game may as well not exist.
- [ ] ⚠️ Never prompt a **guest** to install. They scan a QR, play for an hour
      and leave.

---

## 8 · Before the phones are put away

- [ ] `kit-status` once more.
- [ ] ⚠️ **iOS evicts localStorage after ~7 days without interaction**, so a
      player who does not add the PWA to their home screen is signed out almost
      every time an occasional group plays. Installed PWAs are exempt. Say so
      loudly right after joining. — **Crib Sheet**, where it is load-bearing
      rather than polish.

---

## How to use this on app #6

Read it **before writing the lobby**, not after shipping. Most of §3 and §4 is
half a day of work in total and every hour of it has already been paid for once
by somebody at a table with the dice in their hand.

When a new app finds something new, it goes in here **with the app's name
against it** — that is what turns one evening's annoyance into something the
next app inherits instead of rediscovering.
