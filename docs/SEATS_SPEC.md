# Table size and the span of a seat — spec

**Status: step 1 BUILT (v0.30.0); steps 2 and 3 proposed. Written 2026-08-04.**

Two gaps found by asking two plain questions about a game night:

1. **Can it stop too many people sitting down?** No. Nothing anywhere caps a
   table — not `TableKitConfig`, not any app, not any join hook. A phone
   holding the QR can keep making seats until the box's own limit is a memory.
2. **Can somebody leave?** No, and mid-game that jams the table — see
   [The jam](#the-jam). Somebody going home on hole four is an ordinary game
   night, and the suite has no answer for it.

They are one spec because they are the same fact from two ends: **a table has a
size, and a seat has a span.** The kit already models the front edge of that
span (`joined_round`) and nothing else.

---

## What exists today

| | |
|---|---|
| Floor | `minPlayers` in `TableKitConfig`, default 1. UI only — no hook checks it |
| Ceiling | **Nothing** |
| Arriving late | `joined_round` on the seat. Fully handled |
| Leaving | **Nothing.** No flag, no UI, in the kit or in any app |
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

## Part 1 — the ceiling

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

## Part 2 — leaving

### Not a delete

Deleting the row takes the player's submissions with it (PocketBase cascades
from the game relation, and their entries relate to the seat). That would
rewrite the night's history to say somebody was never there — every closed
round's totals change, the share card loses a row, and lifetime stats lose the
games they played.

**In the lobby, before a card is dealt, a delete is correct** and should be
offered: nothing has been scored, and a seat claimed by mistake is just a
mistake. That is a different, smaller feature and can ship first.

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

**D. Can they come back?**
Clearing `left_round` is the obvious undo and costs nothing to allow — but a
seat that left on round 3 and returned on round 6 owes nothing for 3–5, and a
single pair of numbers cannot say that. **Recommend: coming back means taking
the seat again via `reclaimSeat`, which sets `joined_round` to the current
round and clears `left_round`.** Their earlier rounds keep their scores; the
gap in the middle is simply rounds they did not owe. One span per seat, and if
somebody manages to leave and return twice in a night, the second return is the
same operation again.

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

Each step is shippable on its own and useful before the next one lands.

1. ~~**Remove a seat in the lobby.**~~ **BUILT — table-kit v0.30.0, all three
   apps, 2026-08-04.** `removeSeat` in the kit, refusing on anything but
   `lobby`. No schema change and no backend change was needed: all three
   `*_players` collections already carry `deleteRule: HOST`.

   Two things the build decided that this spec had not:
   - **It is a MODE, not always-tappable rows.** A tap on a name already means
     "that's me, I'll take that seat" on `SeatClaim`, and the `.row.tappable`
     chevron already means "enter for somebody else". A third meaning on a bare
     name row would be the same gesture with two opposite outcomes on screens a
     minute apart. So the lobby list is unchanged until the host taps a quiet
     "Take a seat away", which turns the rows into targets with a ✕ and a Done
     button.
   - **The confirm is `tone: 'normal'`, not `'danger'`.** Red would say this
     costs something. In the lobby it costs a name and a seat order, and the
     body text says so.
2. **The ceiling.** `maxPlayers` + `lobbyState.full` + the claim UI + the three
   join hooks. Schema-free.
3. **`left_round`.** The migration on three `*_players` collections, `owesIn`
   in the kit, the three call sites, the sitting-out UI, and the round hooks
   re-checked — a hook that decides "is every seat final" has its own copy of
   this rule and **must** learn the same span, or the client shows a table
   ready to score and the server never flips the round.

> ⚠️ Step 3 touches the round-close hooks. That is the one part of this that
> can strand a live game, so it wants a throwaway game on the box before it
> goes near a real night — the same way the `heat_*` hooks were verified.

---

## What this does not solve

A **seatless host still cannot enter for anybody**, because `save` takes
`submittedBy` — a relation to a seat — and a host without one has no id to put
there. Sitting out does not help: a seat that is sitting out is still a seat,
so a host who takes one and immediately sits out could proxy for the table.
That works, and it is a workaround rather than a design. The real answer is a
decision about whether `submitted_by` may be empty, which is its own small spec.
