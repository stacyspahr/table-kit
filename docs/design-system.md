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
| Tokens | per app | Colour, ink, lines, radius, gap, edge depth, chrome case. Same variable *names* everywhere, each game's own values. |
| Bones | table-kit | `.screen` `.card` `.row` `.btn` `.pill` `.linklike` `.tick`, tap sizes, safe areas, `dvh`. Written against tokens only — never a literal colour. |
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

In `table-kit/styles.css`, because both apps genuinely build these the same way:

- the whole `.btn` family — `.big`, `.primary`, `.ghost`, `.danger`,
  `:disabled`, and the pressed edge
- `.linklike` and `.linklike.danger`
- `.update-banner`
- `.fine`, `.muted`, `.center-text`
- `.danger-card`

Left per-app, because the two apps build them **differently**, and unifying
them is a decision about which construction wins rather than a move:

| Class | Beat the Heat | Flip 7 |
| --- | --- | --- |
| `.row` | wraps, so a long name never ellipsizes | space-between, with a gradient progress bar |
| `.tick` | a bare glyph | a filled circle that animates |
| `.pill` | caps, filled | lowercase, several semantic variants |
| `.card` | flex column with a gap | a block; children carry their own margins |
| `.screen` | px, `dvh`, container gap | rem, `svh`, container gap |
| `.qr-screen` | cream card on the app's dark ground | a full white screen |

Each row there is its own small design decision, and each one changes how a
screen looks. They are the next round, not this one.

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

## Order of work

Not before a game night. Each step ships separately; the first two are
invisible to players.

1. Agree token names, map each app's existing colours onto them. Nothing moves.
2. Move the 61 shared rules into `table-kit/styles.css`. Both apps import and
   delete their copies. Should be pixel-identical — anything that shifts means
   a token is wrong.
3. Apply decision A. The only step players notice, and only in Flip 7.
4. Rename per decision C, once, across both apps.
5. Fold Flip 7's leftover `lib/session.ts` into the kit — same disease, one
   file over. Its device-id storage key changes, so every phone gets a new id:
   do it between game nights, never during one.
