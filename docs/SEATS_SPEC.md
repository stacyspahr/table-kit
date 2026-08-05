# Table size and the span of a seat — spec

**Status: steps 1–3 BUILT (v0.30.0, v0.31.0, v0.32.0); step 4 proposed.
Written 2026-08-04 and mostly built the same day.**

Three gaps, found by asking plain questions about a game night:

1. **Can it stop too many people sitting down?** No. Nothing anywhere caps a
   table — not `TableKitConfig`, not any app, not any join hook. A phone
   holding the QR can keep making seats until the box's own limit is a memory.
2. **Can somebody hand their seat to somebody else?** Mechanically yes, and
   nothing says so. The board keeps the first person's name for the rest of the
   night.
3. **Can somebody leave?** No, and mid-game that jams the table — see
   [The jam](#the-jam).

They are one spec because they are the same fact from three angles: **a table
has a size, and a seat has a span and an occupant.** The kit models the front
edge of the span (`joined_round`) and nothing else.

## ⚠️ The reordering, and why

This document originally treated **leaving** as the main event and the handover
as a footnote. That is backwards for the tables these apps are actually used at.

> *"Dad was playing and then needed to go check on the kids, and Mom wanted to
> jump in and finish the game."*

That is not somebody leaving. That is a seat **changing hands**, and it is the
commoner shape by a distance at a family table — because a game in progress has
a chair, a pile of cards and a running total sitting at it, and the natural
thing is for somebody to pick them up.

It also matters because a handover **keeps the round moving**: the seat never
stops owing, so none of [the jam](#the-jam) happens. Sitting out is only needed
when nobody replaces them — four playing, one goes to bed, three carry on. Real,
but rarer, and the most complicated thing here.

So the handover comes first, and it is nearly free.

---

## What exists today

| | |
|---|---|
| Floor | `minPlayers` in `TableKitConfig`, default 1. UI only — no hook checks it |
| Ceiling | `maxPlayers` + `seat_cap.pb.js`. Step 3, built in v0.32.0 — **and only Beat the Heat has one** |
| Arriving late | `joined_round` on the seat. Fully handled |
| Taking over a seat | `reclaimSeat({ takeOver })` — renames the seat and records it. Step 2, built in v0.31.0 |
| Leaving | `left_round` **column exists** (rode along with step 2's migration) but nothing writes or reads it |
| Removing a seat | `removeSeat`, **lobby only** — step 1, built in v0.30.0 |

### The jam

Three facts compose into a stuck table:

1. `waitingOn` counts every seat whose `joined_round` has passed.
2. The server flips a round `open → review` only once **every** owing seat is
   final.
3. On the play screens the round-close button does not render while anyone is
   owing — the table gets "Waiting on Nana." instead.

So a player who leaves is owed from forever. The only way forward is for
somebody to enter a score on their behalf **every remaining round**. The proxy
path makes that possible, which is why this is a nuisance rather than a
disaster — but it is a nuisance repeated once per round for the rest of the
night, and it silently corrupts the departed player's score with entries they
did not play.

---

## Part 1 — the handover

### What already works, and it is most of it

`reclaimSeat` updates the seat's `device_id` and `guest`. Michelle scans the
QR, sees the "Already sitting" list, taps Dad's name, confirms — and the seat
moves to her phone with its whole history attached, because submissions relate
to the **seat**, not to a person. A seat is a chair with a running total.

Two things are wrong with it, and they are different sizes.

### The small one: the words are written for a different situation

The confirm currently says:

> That seat is already on someone's phone. **If it's yours**, take it back —
> your score comes with you.

That is the *recovery* case: you, on a new phone, or after your storage was
wiped. Michelle reading *"Play as Dad?"* and *"if it's yours"* would reasonably
conclude she is doing something wrong. The mechanism supports a handover; no
screen admits it exists.

### The real one: the name never changes

For the rest of the night the board says Dad, and the share card credits Dad
with a game Michelle finished.

> ⚠️ **Renaming is not free either, and there is no option that is.** Rename to
> Michelle and holes 1–4 now sit under her name; keep Dad and holes 5–9 sit
> under his. The seat is one running total and the board has one name column.
> Something is going to be slightly wrong, so the question is only which
> wrongness is more useful — and what gets recorded so neither is a lie.

### The decision

**Rename the seat, and keep the handover as a fact.**

The live board's job is to tell the table who is holding the cards *right now*.
After hole five that is Michelle, so the row says Michelle. The seat remembers
where it came from, so history and the share card can say

> Michelle took over from Dad on hole 5

on a screen that has room for a sentence, rather than squeezing
"Michelle (for Dad)" into a name column on every phone for the rest of the
night.

### The shape

```
handovers   JSON, on the seat.   [{ from: "Dad", round: 5 }]
```

An **array**, because a seat can change hands more than once — Dad hands it to
Michelle, Dad comes back on hole seven. A single pair of fields cannot say that
and would have to be replaced the first time it happened.

Additive and nullable, so nothing reads it until the client does. No hook
touches it.

### The flow, and why it must ask

The app cannot tell Dad-on-a-new-phone from Michelle-taking-over. Only the
person holding the phone knows, so the confirm asks — one extra tap, on the
rarest screen in the app:

```
Play as Dad?
Dad's score so far comes with the seat.

[ It's me — this is my phone now ]   → reclaimSeat. No rename. Today's behavior.
[ Someone else is taking over ]      → name picker → reclaim + rename + log
```

The first button is the existing behavior and stays the default-looking one:
recovery is the commoner reason to be on this screen at all, and it must not
get slower to make room for the rarer case.

The second leads to the same name picker `SeatClaim` already draws — one tap
for anyone on the roster.

### The sharp bit: `roster_entry`

`roster_entry` is the durable identity, and it is what a future lifetime-stats
screen will count games against.

- If it moves to Michelle, Dad's record loses a game he played most of.
- If it stays with Dad, Michelle's record never shows the game she finished.

**Recommend: it moves, matching the name.** One seat, one current occupant, and
the display and the identity should not disagree. The `handovers` log is what
preserves the option of apportioning it properly later — **do not build the
apportioning now.** Lifetime stats do not exist yet, so this decision is cheap
today and expensive to revisit once they do; the log is the cheap insurance.

### Who may do it

Nobody new. This is the existing `reclaimSeat` path with better words — any
phone that can scan the QR can already do it, which is right, because the
person handing over usually walks off without touching anything.

---

## Part 2 — the ceiling

### The knob

```ts
maxPlayers?: number   // TableKitConfig, alongside minPlayers
```

Absent means no ceiling, which is what every game has today and what keeps this
a minor bump rather than a breaking one.

The NUMBER is the game's, never the kit's — same rule as `minPlayers`. A kit
that knew Flip 7 seats twelve would be a kit that knew the games.

`lobbyState` gains:

```ts
{ canStart, shortBy, minPlayers, seated,
  full: boolean,        // seated >= maxPlayers
  maxPlayers?: number,
  roomFor: number }     // seats left, Infinity when uncapped
```

### What the lobby should SHOW

> ⚠️ **Not a range, and above all not a fraction.** "4 of 10" reads as progress
> toward ten — a table of four who are all present would look six people short,
> which is the exact opposite of informative. A static "2–10" is no better: it
> is chrome that earns its place about twice a night.

The floor is already answered twice over — the start button says "Needs 1 more"
and then stops being disabled. So:

- **Normally:** the plain count, as now. *At the table 4*.
- **At the cap:** the count line says **Table full**. That is a fact that
  *changed*, which is what makes it worth the space.
- **"2 seats left" in between:** defensible, deliberately not recommended for a
  first cut. Ship without it and see whether anybody misses it.

The person who most needs to know is whoever is scanning into a full table, and
they are told on their own screen.

### Enforced in two places, and only one of them is a gate

> ⚠️ **The join hook is the gate. The UI is a courtesy.**
> A phone holding the join link talks to PocketBase directly. `nine_players`'
> create rule admits any guest bound to an active game, so a screen that hides
> the claim button stops nobody who has the URL. Hiding it is still worth
> doing — it is how everyone at the table finds out the table is full — but a
> ceiling that lives only in React is decoration.

**Client** — `SeatClaim` and `TakeSeat` show the table is full instead of a
name list. Wording is the game's: *"This table is full (10 seats)."*

**Server** — each `<app>_join` hook counts seats before letting a NEW phone
through, and returns a plain refusal. Notes on doing it correctly:

- Count `<app>_players` for the game, not `<app>_guests`. A guest credential is
  a phone; a seat is a chair, and a phone that joined and never claimed is not
  occupying one.
- **A phone that already holds a credential must always be admitted**, exactly
  as a finished game already admits one. Reloading a discarded tab is the
  normal case; being locked out of a game you are playing in because the table
  filled behind you is the worst possible failure here.
- The refusal belongs at claim time as well as at join time. Joining is not
  sitting down — a spectator holding the QR has a credential and no seat.
- ⚠️ **A handover must never be refused for fullness.** Taking over an existing
  seat does not add one. If the check is written against "is this phone allowed
  in" rather than "is a new seat being created", a full table becomes a table
  nobody can hand a seat over at — which is precisely when they want to.

> ⚠️ **The race is real and must lose gracefully.** Six people scan at once at
> a table with two seats left. `claimSeat` already walks `seat_order` past
> collisions and retries; a full-table refusal has to arrive as *"the table
> filled up while you were choosing"* and not as a 500 or a silent no-op. The
> `(game, device_id)` unique index is the model to copy — the guarantee is the
> constraint, the check is the fast path.

### Should the ceiling apply to phoneless seats?

Yes. A seat is a chair whether or not a phone is holding it, and the box's
limit is about chairs. `AddSeat` refuses at the same number.

---

## Part 3 — sitting out

Only for the case Part 1 does not cover: somebody leaves and **nobody takes the
seat**. If anyone picks it up, none of this is needed.

### Not a delete

Deleting the row takes the player's submissions with it (PocketBase cascades
from the game relation, and their entries relate to the seat). That would
rewrite the night's history to say somebody was never there — every closed
round's totals change, the share card loses a row, and lifetime stats lose the
games they played.

**In the lobby, before a card is dealt, a delete is correct** — that is step 1,
already built as `removeSeat`.

### The shape: `left_round`

```
joined_round   the round this seat started owing from      (exists)
left_round     the round this seat stopped owing from      (new, nullable)
```

Empty means still playing. Set means: from that round number on, this seat owes
nothing, and everything it already did stands.

**Why this shape.** The kit already models a seat as a span, it just only has
the front edge. There are exactly **three** places that read that edge, and all
three read it identically:

| File | Line | What it does |
|---|---|---|
| `state.ts` | `waitingOn` | `p.joined_round <= current.round_number` |
| `awards.ts` | `roundScope` | same filter, for round callouts |
| `reveal.ts` | `rowsForRound` | same filter, so a latecomer has no phantom row |

Those three are the entire surface. Each becomes a span test:

```ts
// One helper in state.ts, used by all three, so the rule cannot drift.
export function owesIn(p: PlayerRec, roundNumber: number): boolean {
  return p.joined_round <= roundNumber && (!p.left_round || p.left_round > roundNumber)
}
```

> ⚠️ **`left_round` is the first round they DON'T owe**, not the last one they
> played. Stating it the other way makes every comparison an off-by-one waiting
> to happen, and this number is read in three places that must agree.

### What does NOT change

- **`standings` and `committedTotals`.** A departed player keeps their total
  and their place. They played those rounds; the board should say so.
- **The share card.** Every seat is drawn, and that includes the one who went
  to bed.
- **`gameScope` awards.** End-of-game awards read closed submissions across the
  whole game and should keep considering them — they earned what they earned.
  ⚠️ Award *definitions* that divide by round count will now be comparing a
  five-round player against a nine-round one. Each game owns its own defs and
  has to decide; the kit cannot.

### Open decisions

**A. Can the game continue below the floor?**
`minPlayers` is checked once, in the lobby. If a four-hander drops to one, the
game currently keeps going. Options: leave it (the table can end the game
itself), or warn without blocking. **Recommend: leave it, warn nowhere.** The
floor is about dealing a fair game, not about policing one in progress, and a
scorer that refuses to score is worse than a short table.

**B. `tieAtFront` requires `state.players.length >= 2`.**
That counts every seat including departed ones. If two of four leave and the
remaining two tie at the goal, the game correctly plays on. If everyone but one
leaves, the check still passes on the raw count. Low stakes; needs a decision,
not a design.

**C. Does rematch carry a departed seat?**
`rematch` recreates every player with `joined_round: 1`. Somebody who left the
last game is, by the plainest reading, not at the next one. **Recommend: drop
seats with `left_round` set**, and let them rejoin by scanning like anyone
else — the roster still knows them, so it is one tap.
⚠️ It should NOT drop a seat that was handed over. That seat has somebody in it.

**D. Can they come back?**
Clearing `left_round` is the obvious undo and costs nothing to allow — but a
seat that left on round 3 and returned on round 6 owes nothing for 3–5, and a
single pair of numbers cannot say that. **Recommend: coming back means taking
the seat again via `reclaimSeat`, which sets `joined_round` to the current
round and clears `left_round`** — the same operation as a handover, which is
what it is when somebody else does it.

### Who may do it

The person leaving usually hands their phone back and walks off, so this cannot
be a button only their phone has. Any seated player can already enter for any
other seat; ending a seat is the same class of act. **Recommend: any seated
player, plus the host from the host screen** — and it is undoable by taking the
seat again, which is what keeps it from needing a confirm dialog.

### Wording

Not "leave" and never "remove" — both sound like deletion, and the whole point
is that nothing is deleted.

**Recommend "sitting out"**, matching how a table actually says it: *"Nana is
sitting out."* On the board the row keeps its total and takes a quiet mark, the
way a phoneless seat takes `NoPhone`. Each game owns its own sentence.

---

## Build order

Ordered by *what a table hits most often*, not by what is most interesting to
build. Each step ships on its own and is useful before the next one lands.

### 1. ~~Remove a seat in the lobby~~ — **BUILT, v0.30.0, all three apps**

`removeSeat` in the kit, refusing on anything but `lobby`. No schema change and
no backend change was needed: all three `*_players` collections already carry
`deleteRule: HOST`.

Two things the build decided that this spec had not:

- **It is a MODE, not always-tappable rows.** A tap on a name already means
  "that's me, I'll take that seat" on `SeatClaim`, and the `.row.tappable`
  chevron already means "enter for somebody else". A third meaning on a bare
  name row would be the same gesture with two opposite outcomes on screens a
  minute apart. So the lobby list is unchanged until the host taps a quiet
  "Take a seat away", which turns the rows into targets with a ✕ and a Done
  button.
- **The confirm is `tone: 'normal'`, not `'danger'`.** Red would say this costs
  something. In the lobby it costs a name and a seat order, and the body says so.

### 2. ~~The handover~~ — **BUILT, v0.31.0, all three apps, 2026-08-04**

Migrations `1786100000`–`1786100002` added `handovers` **and** `left_round` to
all three `*_players` collections in one trip, as this section recommended;
`left_round` is unread until step 4. Cold backup
`pb_data.bak-2026-08-04-preseatspan` on the box. Schema verified against the
live database after the restart rather than assumed from a clean exit.

What the build settled that this spec had left open:

- **`SeatClaim` asks rather than guessing**, with the handover as a SECOND
  button beside the unchanged "Yes, that's me". Recovery is the commoner reason
  to be on that screen and must not get slower to make room for the rarer case.
- **The offer only appears for a seat with a phone on it.** An unclaimed seat
  has no occupant to take over from — taking it is just taking it.
- **The seat list is hidden while the question is on screen.** Offering a list
  of other seats to take, mid-handover, is how somebody lands in the wrong chair
  with somebody else's score.
- **`Handovers` is a kit component taking a `unit` prop** rather than five
  copies of the same sentence across three apps. It renders on the end-of-game
  and results screens, where there is room for a sentence.

### 3. ~~The ceiling~~ — **BUILT, v0.32.0, all three apps, 2026-08-04**

⚠️ **The rulebooks changed this step's shape, and it is the finding worth
keeping.** Reading them rather than assuming a cap:

| | |
|---|---|
| Beat the Heat | *"Two to ten players"* — a real ceiling. **Set to 10.** |
| Flip 7 | *"Three to twelve players and the 108-card deck — past twelve the box recommends shuffling in a second one."* Twelve is where one DECK runs out, not where the game stops. **No cap** — refusing a thirteenth player at a table with two decks out would be the app overruling the box. |
| Play Nine | *"two or more players… a big table is no problem."* **No cap.** |

So the mechanism is the kit's and the number is the box's, and two of three
games correctly have none. That is why `maxPlayers` is optional rather than
defaulted: **a cap invented for tidiness refuses a real game.**

Also settled in the build:

- **Not a join-hook check, an `onRecordCreateRequest` guard on the players
  collections.** Joining is not sitting down, and the seat is created by a
  direct write the join hook never sees. One hook file covers all three, since
  the games collection is derivable from the players one.
- **Fail-open by construction.** The whole check sits inside one `try` and only
  a deliberate throw refuses a seat. This hook stands in front of every seat
  claim in three live apps; a wrong method name after a PocketBase upgrade,
  thrown loose, would first be discovered by a room full of people who cannot
  start their game.
- **`max_players` is snapshotted onto the game**, not read from config at
  display time, so the number in the message and the number in the gate cannot
  drift. It also means tonight's game keeps the ceiling it was dealt under.
- **Best-effort against a simultaneous scan.** Count-then-create is not atomic,
  so two phones claiming the last chair together can both pass. One over a soft
  ceiling costs nothing at a family table; a transaction around every seat claim
  for a case that ends in "budge up" costs more than it saves.

### 4. Sitting out

`left_round`, `owesIn`, the three call sites, the sitting-out UI, and the
round-close hooks re-checked.

> ⚠️ **The one step that can strand a live game.** A hook deciding "is every
> seat final" has its own copy of this rule and **must** learn the same span, or
> the client shows a table ready to score and the server never flips the round.
> Wants a throwaway game on the box first, the way the `heat_*` hooks were
> verified.

Rarest of the three cases, and the only one with no workaround today — but the
workaround for most of what it covers is step 2.

---

## What this does not solve

A **seatless host still cannot enter for anybody**, because `save` takes
`submittedBy` — a relation to a seat — and a host without one has no id to put
there. Sitting out does not help: a seat that is sitting out is still a seat,
so a host who takes one and immediately sits out could proxy for the table.
That works, and it is a workaround rather than a design. The real answer is a
decision about whether `submitted_by` may be empty, which is its own small spec.
