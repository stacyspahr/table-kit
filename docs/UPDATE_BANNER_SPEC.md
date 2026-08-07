# The update banner — when it is allowed to appear

The banner works. This spec is about *timing*: it currently arrives whenever the
poll notices a new build, including while somebody is aiming a thumb at a
number, and it moves every control on the screen when it does.

Affects all three apps — `UpdateBanner` and its CSS both live here.

## 1. What happened

Observed live, Oh Hell, 2026-08-06, during hand 5 of a 9-hand game. A deploy
landed mid-hand. The banner appeared between two taps on the trick picker:

- The tap aimed at GPa's row landed on Stacy Spahr's number buttons instead.
- It **overwrote a trick count that had already been entered**, silently. No
  error, no confirm — a number button is a number button.
- The wrong score was only caught because the next screenshot was read
  carefully. At a real table it would have been caught by the person whose
  score it was, or not at all.

⚠️ It lands on the one screen where a mis-tap writes a wrong score rather than
merely navigating. Bidding and trick entry are both single-tap-commits by
design — there is deliberately no confirm in front of entering for another seat
(`oh-hell/src/screens/PlayScreen.tsx:485`). That decision is right, and it is
what makes an unannounced 60px shift expensive.

Stacy, earlier the same evening, rejecting an unrelated auto-fill proposal:

> An errant tap would mess that up.

Same failure. The difference is that here the app causes it.

## 2. Why it moves the page

`styles.css:653`:

```css
.update-banner {
  position: sticky;
  top: 0;
  ...
  padding: calc(env(safe-area-inset-top) + 12px) 16px 12px;
}
```

`sticky` keeps the element **in normal flow**. Mounting it therefore inserts a
full banner's height — roughly 60px with the safe-area inset on a notched
phone — above everything else, and every control below shifts down by that
much. `fixed` would not do this; `sticky` does.

The component itself has no timing logic — `react.tsx:130`:

```tsx
useEffect(() => watchForUpdates({ buildId, onStale: () => setStale(true) }), [buildId])
if (!stale) return null
```

Stale is discovered by a poll, so arrival time is arbitrary with respect to what
the table is doing. All three apps mount it the same way, at `App.tsx`, as a
sibling above the whole screen.

## 3. What must not change

- **The banner stays.** From `styles.css:650`: *"The people using these apps do
  not force-refresh a web page, and will happily play a whole night on a stale
  build otherwise."* That is still true and is the entire reason it exists.
- **It stays in the kit.** It was duplicated across two apps once and drifted;
  Flip 7 kept its own polling while Beat the Heat used the kit's. Do not solve
  this per-app.
- **Its look.** Flip 7 already overrides only `font-size`, which should keep
  working.

## 4. The decision: the app says when, not the kit

The kit cannot know what screen is safe — it has no idea what a hand is. The app
does. So the kit gains a way to be told "not now", and each app decides.

### The shape

```tsx
UpdateBanner({ buildId, label?, hold? })
```

`hold` suppresses rendering while true, **without discarding the staleness that
was already detected**. When it goes false the banner appears immediately — the
poll does not have to come round again.

```tsx
if (!stale || hold) return null
```

Default `hold = false`, so any app that does not pass it behaves exactly as
today. No app is forced to adopt this in the same release.

⚠️ **Hold must not unmount the watcher.** Gating the `useEffect` on `hold` would
restart polling every time a hand changes and could miss the deploy entirely.
Only the render is gated.

### What each app passes

**Oh Hell.** Hold during bidding and trick entry; release on the scored screen,
which has no number pad — only *Next hand* and *Change my count* — and is the
natural pause in a hand anyway. It is also the screen the table is already
looking at together.

**Play Nine and Flip 7.** Same principle, their own call on which screen is the
quiet one. Not blocking this change; they can pass nothing and keep today's
behaviour until somebody picks the screen.

## 5. Considered and rejected

**`position: fixed` instead of `sticky`.** Removes the reflow, which is the
literal defect — but then the banner sits *over* the header, and in all three
apps the top-right of that header is the **Join code** button. Trading "a tap
lands on the wrong number" for "a tap reloads the page" is not obviously a
trade, and it makes the hand number unreadable while the banner is up.

Worth revisiting as defence in depth once `hold` is in, but it does not stand on
its own and it changes how the banner looks in every app.

**Reserving the banner's height permanently.** No reflow, but a dead 60px strip
at the top of every screen forever, on phones, on the one app family whose whole
readability bar is "big, glasses-free, one-handed."

**A confirm on trick entry.** Fixes the symptom by taxing every entry for the
rest of time, and reverses a decision made deliberately from table feedback.

## 6. Build order

1. `hold` prop on `UpdateBanner`, defaulting false. Kit-only, no app changes,
   nothing observable until an app passes it.
2. Oh Hell passes `hold` — true except on the scored screen.
3. Play Nine and Flip 7 when their quiet screen is chosen.

No CSS change. No schema change. Step 1 is additive and safe to ship alone.

## 7. What this does not solve

- **A deploy mid-tap on a screen with no quiet moment.** Holding narrows the
  window; it does not close it. An app that never has a safe screen would need
  the `fixed` change in §5.
- **The stale build itself.** Holding the banner means a table plays a little
  longer on the old build. That is the correct trade — the banner exists to
  catch people who would otherwise play the *whole night* stale, and one hand is
  not a night.
