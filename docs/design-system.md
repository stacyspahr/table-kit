# The design system, written down

Status: **decisions A–D agreed; first pass built** in table-kit v0.4.2.
`styles.css` holds the shared bones; both apps import it before their own file.

What landed, and what deliberately did not, is at the bottom under
[What is shared, and what is not](#what-is-shared-and-what-is-not).

Beat the Heat and Flip 7 already share a design system. It just isn't written
anywhere, so it exists as two copies of one stylesheet that drift apart every
time a screen is added.

## The evidence

- **61 identical class names** across the two stylesheets — `.btn`, `.card`,
  `.row`, `.screen`, `.reveal-row`, the whole vocabulary.
- **The same button, two answers.** Rules is `.btn.ghost` in Beat the Heat and
  `.linklike` in Flip 7. Both apps define both classes; nothing forced it.
- **The same idea, two names.** `.row.mine` / `.row.me`, `.tick.on` /
  `.tick.in`, `.seg` / `.segmented`.
- **The same name, two jobs.** `.topbar` is Flip 7's play-screen action bar and
  Beat the Heat's rules-sheet header.

## Three layers, and only the middle one is shared

| Layer | Lives | Holds |
| --- | --- | --- |
| Tokens | per app | Color, ink, lines, radius, gap, edge depth, chrome case. Same variable *names* everywhere, each game's own values. |
| Bones | table-kit | `.screen` `.card` `.row` `.btn` `.pill` `.linklike` `.tick`, tap sizes, safe areas, `dvh`. Written against tokens only — never a literal color. |
| Skin | per app | Anything one game alone has: pips and tallies, card chips and the modifier pad, the icon, the reveal's character. |

## Decision A — what a control's shape means

| Shape | Means | Example |
| --- | --- | --- |
| `.btn.big.primary` | The one thing the table is waiting for. Max one per screen. | Enter my pile · Score the round |
| `.btn` | A real action that isn't the main one. | Submit · Start the next round |
| `.btn.ghost` | Go look at something. Changes nothing about the game. | Rules · Show the join code |
| `.linklike` | Leave this screen, or back out of what you started. | Back to the host screen |
| `.btn.danger` | Destroys something. Never without a confirm. | End the game |

**Recommended:** adopt as written. Beat the Heat already follows it. Flip 7's
Rules, Host and Join code come off the top bar and become bottom controls,
where a thumb already is. Stating the *why* is what stops the third scorer
inventing a third answer.

## Decision B — is CAPS a house rule or a Beat the Heat trait?

Beat the Heat: caps for chrome, sentence case for anything a person wrote.
Flip 7: sentence case throughout, lowercase pills.

**Recommended:** a per-app trait, but a declared one — a `--chrome-case` token
the shared button reads. Forcing both to caps would flatten the thing that
makes Beat the Heat look like Beat the Heat. No visible change to either app.

## Decision C — one name per concept

| Concept | Beat the Heat | Flip 7 | Proposed |
| --- | --- | --- | --- |
| The row that is you | `.row.mine` | `.row.me` | `.row.mine` |
| A ticked checklist item | `.tick.on` | `.tick.in` | `.tick.on` |
| Segmented control | `.seg` / `.seg-btn` | `.segmented` | `.seg` / `.seg-btn` |
| Screen action bar | `.topbar` (sheet header) | `.topbar` (action bar) | `.sheet-head` / `.topbar` |

**Recommended:** shorter name wins every time except `.topbar`, where both are
wrong to share it — the rules-sheet header becomes `.sheet-head`.

## Decision D — who owns the stylesheet

**Recommended:** a shared `styles.css` in table-kit, imported before each app's
own CSS. The app's stylesheet still loads after and can override for one
screen, so the escape hatch stays open without making divergence the default.
The cost is real: fixing a button then needs a kit release.

## What is shared, and what is not

Moving the CSS turned up something the class-name count hid: **the two apps
share names far more than they share shapes.**

In `table-kit/styles.css`:

- the whole `.btn` family — `.big`, `.primary`, `.ghost`, `.danger`,
  `:disabled`, and the pressed edge
- `.linklike` and `.linklike.danger`
- `.update-banner`
- `.fine`, `.muted`, `.center-text`
- `.danger-card`
- `.card`, and the form and `.qr-actions` inside it *(v0.4.3)*
- `.list`, `.row`, `.row-main`, `.row-note`, `.row.mine`, `.big-list`,
  and the pressed row *(v0.4.3)*
- `.screen`, `.screen.center`, and the `box-sizing` reset *(v0.4.4)*
- `.qr-screen`, `.qr-card`, `.qr-code`, `.qr-help` *(v0.4.5)*

Left per-app, because the two apps build them **differently**, and unifying
them is a decision about which construction wins rather than a move:

| Class | Beat the Heat | Flip 7 |
| --- | --- | --- |
| `.tick` | a bare glyph | a filled circle that animates |
| `.pill` | caps, filled | lowercase, several semantic variants |

Each row there is its own small design decision, and each one changes how a
screen looks.

### The card and the row (v0.4.3)

Both went to Beat the Heat's construction, and both come down to the same
principle: **the container owns the space, and a name is never squeezed.**

- **The card** carries one gap for every child; no child of a card carries a
  vertical margin. Margins collapse, double, and depend on the order children
  happen to sit in — adding a paragraph meant discovering which of its
  neighbors already had one. Flip 7 lost a dozen child margins in the
  conversion, including the `.card > .btn:not(.big)` rule that existed purely
  because no container had a gap. Where something genuinely needs more air than
  the rest (a modal's question above its answer) it now adds the difference,
  not the whole distance.
- **The row wraps** rather than squeezing. Past `--tk-name-basis` the pill and
  the total drop to their own line and the row gets taller. This fixed a real
  defect: at narrow widths Flip 7's `space-between` gave a long name a
  three-line sliver, and its `.big-list` rows printed their name and their note
  on top of each other.

`.row-main` is sizing only. What goes *inside* the name box stays each game's
business — Beat the Heat stacks a note under the name, Flip 7 sets pills beside
it — so each app keeps its own rule for the content model.

### The screen (v0.4.4)

Structurally the two rules were already the same, so this was mostly values
becoming tokens. Two things did change:

- **`svh`, never `vh` and never `dvh`.** Both apps had worked out that `vh` lies
  on iOS, where Safari's toolbar overlays the viewport it reports, and each
  landed on a different fix — Beat the Heat on `dvh`, Flip 7 on `svh`. `dvh`
  tracks the toolbar as it comes and goes, so the screen resizes mid-scroll and
  a centered one drifts while you are reading it. `svh` is the viewport with the
  toolbar *out*, the smallest it ever gets, so a bottom button is never
  underneath the chrome exactly when a thumb reaches for it. Beat the Heat's
  `.qr-screen` moved with it: a QR must not resize while somebody across the
  table is pointing a camera at it.
- **The canvas is 560px.** It was `34rem` in one app and `560px` in the other —
  sixteen pixels nobody had chosen, and visible only on a desktop browser.

The `box-sizing` reset came too, since every rule in the file assumes it.

### The join code (v0.4.5)

Both apps had the same reason written above different answers — *this gets
scanned across a table, at an angle, often in bad light.* Flip 7 turned the
whole screen white for it; Beat the Heat put a cream card on its own dark
ground.

The card won. The contrast a camera needs comes from the code's own
black-on-white and its quiet zone, not from the rest of the display, so going
white edge to edge bought very little and cost the app its face at the one
moment a stranger is pointing a phone at it.

Two defects surfaced during the move, both now fixed in **both** apps:

- **The quiet zone was one module, where the spec asks for four.** Enough that
  most phones coped, and exactly the thing that stops coping at an angle. It
  matters more under this decision, not less: the card behind the code is cream
  rather than white, so that border is the whole quiet zone and does not get to
  borrow the surface underneath.
- **`.qr-code` was sized at `88vw`.** Right on a full-bleed white screen, wrong
  the moment it sits inside something with padding — at narrow widths it grew
  straight through the card's edges. It measures against the card now.

### The component itself (v0.5.0)

`QrPanel` is the kit's now, behind a **`table-kit/react`** entry point.

The two copies differed by a share-sheet title and two comments. Everything else
— the QR generation, the wake lock, the clipboard fallback, the markup — was the
same code maintained twice, which is how the quiet zone came to be wrong in both
at once.

- **Separate entry point, on purpose.** The core stays framework-free: seats,
  sync, the offline queue and the awards engine have no business knowing what
  renders them, and importing `table-kit` must not pull React in behind it.
- **`react` and `qrcode` are optional peers.** Import `table-kit/react` and you
  need both; import the core and you need neither.
- **The one real difference became a prop.** `gameName` fills the share sheet's
  "Join the … game", and each app names itself once (`GAME_NAME`) rather than at
  every call site.

This is the first React code in the kit. Anything else moving here should clear
the same bar: identical in both apps, no game-specific wording or palette baked
in, and worth a peer dependency.

The same reasoning deferred one rename: Flip 7's `.segmented` was going to
become `.seg` / `.seg-btn` per decision C, but Beat the Heat's `.seg` is a flex
column and Flip 7's is a grid. Giving two different constructions one name is
the `.topbar` mistake again, so the rename waits until the control is actually
unified.

**Declared overrides.** Flip 7 keeps a handful of rules in its own file —
button margins, the full-width danger link, banner size. They are there because
Flip 7 spaces buttons with their own margins while Beat the Heat spaces them
from the container. That disagreement is real and unsettled; it is now visible
in a diff instead of buried in a second copy of the whole system.

### The chevron means somebody else (v0.25.0)

`.row.tappable` paints a `›` so a row that goes somewhere looks like it does.
Beat the Heat's second game night found the hole in that: the mark was on
*every* row of the live board, including your own, so it meant two different
things on one screen — "enter for them" on eleven rows and "enter mine" on
one. That put two routes to your own keypad on the screen at once, the row and
the big button under it, and it spent the one mark that was supposed to teach
proxy entry on the row that has nothing to do with proxying.

**The rule: your own row is not a control for you. The primary button is.**

- A row on a live board is marked `tappable` only when tapping it acts *for
  another seat*. The chevron then carries exactly one meaning, and it is the
  meaning nobody discovers on their own.
- Your own row stays a plain `.row.mine` — it still carries what you handed in,
  because that is information, not an instruction.
- The primary button owns your entry for the whole round, which means it does
  not vanish once you are in. It goes quiet: `.btn.big.primary` "Enter my pile"
  while you owe, `.btn.ghost` "Change my pile" after. Correcting your own entry
  was the only thing the row tap did that the button did not, and an unmarked
  tap target is the wrong home for it.

Both scorers follow this. Play Nine took it in two goes — chevrons and the end
of its fine-print sentence first, then its own row going plain a commit later —
which is worth knowing because the halves are separable and the first one alone
is the state that reads worst: every row marked, including the one the mark
does not describe.

**Flip 7 has neither half yet**, and it is the app the rule will fit least
comfortably — check what its board actually does before assuming this drops in.

The gutter is the part that bites. A list mixing tappable rows with plain ones
has to give the plain ones the chevron's width back, empty, or the column on
the right stops lining up — and that column is the one people read from across
a table. Both apps carry that rule in their own stylesheet as a declared
override, identical in both, waiting on the next kit release to come home
beside `.row.tappable::after`.

## Order of work

Not before a game night. Each step ships separately; the first two are
invisible to players.

1. Agree token names, map each app's existing colors onto them. Nothing moves.
2. Move the 61 shared rules into `table-kit/styles.css`. Both apps import and
   delete their copies. Should be pixel-identical — anything that shifts means
   a token is wrong.
3. Apply decision A. The only step players notice, and only in Flip 7.
4. Rename per decision C, once, across both apps.
5. ~~Fold Flip 7's leftover `lib/session.ts` into the kit.~~ **Done.** The
   warning attached to this step was wrong: it claimed the device-id storage
   key would change and hand every phone a new id. It does not. Flip 7's
   `APP_KEY` is `flip7` and the kit builds `${appKey}_device_id`, which is
   character-for-character the local module's `flip7_device_id`. Nothing was
   reset. That key is now pinned by a test in `session.test.ts`, because it is
   a data contract with every phone that has already played, not an
   implementation detail.
