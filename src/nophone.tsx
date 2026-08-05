/**
 * The mark for a seat with no phone on it.
 *
 * ── Why it is its own file ───────────────────────────────────────────────
 * `board.tsx` needs it and `react.tsx` re-exports `board.tsx`, so importing
 * it across would be a cycle. It is also the single most reused glyph in the
 * suite — the lobby, the host board and two play screens all draw it — which
 * is reason enough on its own.
 *
 * Still exported from `table-kit/react`, so nothing consuming it changes.
 */

/**
 * A seat with no phone of its own.
 *
 * ── Why the kit owns the MARK ────────────────────────────────────────────
 * Because three apps were about to say the same thing three ways. "No phone"
 * is one of the load-bearing facts at a card table — it is the difference
 * between a seat that will fill itself in and one somebody has to volunteer
 * for — and a fact that important cannot look like a different fact depending
 * on which scorer is open.
 *
 * A glyph rather than the words. It went onto the leaderboard first, where
 * there was no room for two words beside a name, a tick, a total and a bar —
 * and the lobbies kept the text pill on the grounds that they had the space.
 * That lasted one screenshot. The space was never the argument: a fact that
 * important should not change shape between the screen where you meet it and
 * the screen where you act on it, and the lobby is where you meet it.
 *
 * `currentColor`, so it takes the color of whatever it is set beside without an
 * app having to style it.
 */
export function NoPhone({ title = 'no phone' }: { title?: string }) {
  return (
    <svg
      className="tk-no-phone"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* A plain handset with a line through it, and plain is the point. An
          earlier cut broke the outline at the corners the slash crosses, on the
          theory that it would read as struck through rather than smudged. At
          17px it read as neither — just a damaged rectangle. The slash runs
          past the body at both ends, which is what makes it a slash and not a
          crack. */}
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  )
}
