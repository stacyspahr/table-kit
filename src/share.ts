/**
 * The share card — a game night leaving the app.
 *
 * The awards already capture the fun INSIDE the app. This is the same thing in
 * the group chat: one tap at the end of a game produces a branded picture of
 * who won and what happened, handed straight to the share sheet.
 *
 * ── Why this is kit code ─────────────────────────────────────────────────
 * Both inputs are already kit types — a board is `Standing[]`, an award is
 * `Award[]` — so the layout can be drawn without ever learning what a pepper
 * is. What the kit does NOT decide is a single word on the card: every string
 * is passed in, because "wins on 41 peppers — the fewest at the table" is the
 * game's sentence and inverting it is the whole point of that game.
 *
 * ⚠️ No React, and no network. The kit core has never depended on React and
 * this must not be the thing that changes it — the button is a game component,
 * this file is plain async functions. The mark is drawn from the already-cached
 * icon file, so a card renders at a card table with the wifi off.
 *
 * ⚠️ THE TRAP: rendering a PNG is an `await`, and iOS treats the user gesture
 * as over the moment you await — the share sheet then silently refuses to open.
 * The same trap is documented at `InviteHost.tsx`. So `renderCard` is called on
 * MOUNT, when the game is already over and the data is final, and `shareCard`
 * is called from the tap handler with a `File` already in hand.
 */

/** Colors and type. Everything here is the game's, never the kit's. */
export interface CardTheme {
  bg: string
  ink: string
  muted: string
  /** Winner's name, award names, the wordmark. */
  accent: string
  /** Hairlines between the three blocks. */
  rule: string
  font: string
  /** Some apps set their chrome in caps, some don't. */
  chromeCase: 'uppercase' | 'none'
}

export interface CardRow {
  place: number
  name: string
  /** Pre-formatted — the game decides whether a score carries a sign. */
  score: string
  /** Winners are drawn in the accent. More than one on a shared win. */
  won: boolean
}

export interface CardAward {
  title: string
  /** Absent for an award about the game rather than a person. */
  who?: string
  blurb: string
}

export interface CardSpec {
  wordmark: string
  /**
   * The game's shape, drawn under the wordmark — "Brutal, to 200".
   *
   * Omit for the standard game. A brutal night and an ordinary one would
   * otherwise produce identical cards, and brutal is the part worth bragging
   * about.
   */
  shape?: string
  /** Chrome, so it takes the app's case. "That's the game". */
  headline: string
  /** "Stacy", or "Stacy and Zak" on a shared win. */
  winnerName: string
  /** The game's own sentence, verbatim. */
  winnerLine: string
  /** Every seat, including the phoneless ones. The board is what people argue about. */
  board: CardRow[]
  awards: CardAward[]
  theme: CardTheme
  /** Usually `/icon-192.png` — already cached, so this costs no network. */
  markUrl?: string
}

/** 4:5 — the tallest crop Messages and Instagram show without a tap. */
const W = 1080
const H = 1350
const PAD = 72

/**
 * Canvas letter-spacing is not reliably supported, and the card leans on
 * tracked caps in three places. Drawing glyph by glyph works everywhere and
 * costs nothing at this size.
 */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
): void {
  const chars = [...text]
  const width =
    chars.reduce((sum, c) => sum + ctx.measureText(c).width, 0) + spacing * (chars.length - 1)
  let x = cx - width / 2
  for (const c of chars) {
    ctx.fillText(c, x, y)
    x += ctx.measureText(c).width + spacing
  }
}

/** Greedy wrap. Long enough for a blurb, and blurbs are one sentence by rule. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function loadMark(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    // A missing icon must not cost anybody their card. The lockup simply
    // becomes the wordmark alone, which still reads as the app.
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Draw the card and hand back a PNG.
 *
 * Call this on mount, never in a tap handler — see the trap at the top.
 */
export async function renderCard(spec: CardSpec): Promise<Blob> {
  const { theme } = spec
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser would not give us a canvas.')

  const caps = (s: string) => (theme.chromeCase === 'uppercase' ? s.toUpperCase() : s)

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  const mid = W / 2
  let y = PAD + 40

  // ── the lockup ────────────────────────────────────────────────────────
  const mark = spec.markUrl ? await loadMark(spec.markUrl) : null
  ctx.font = `800 46px ${theme.font}`
  const markSize = 60
  const gap = 20
  const wordWidth = (() => {
    const chars = [...caps(spec.wordmark)]
    return chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + 2 * (chars.length - 1)
  })()
  const lockWidth = (mark ? markSize + gap : 0) + wordWidth
  const lockLeft = mid - lockWidth / 2
  if (mark) {
    // Rounded to match the installed tile rather than drawn as a square.
    const r = markSize * 0.226
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(lockLeft, y - markSize + 12, markSize, markSize, r)
    ctx.clip()
    ctx.drawImage(mark, lockLeft, y - markSize + 12, markSize, markSize)
    ctx.restore()
  }
  ctx.fillStyle = theme.accent
  ctx.textAlign = 'left'
  {
    let x = lockLeft + (mark ? markSize + gap : 0)
    for (const c of [...caps(spec.wordmark)]) {
      ctx.fillText(c, x, y)
      x += ctx.measureText(c).width + 2
    }
  }
  y += 46

  ctx.textAlign = 'center'
  if (spec.shape) {
    ctx.font = `500 26px ${theme.font}`
    ctx.fillStyle = theme.muted
    ctx.fillText(spec.shape, mid, y)
    y += 40
  }

  // ── measure everything before drawing any of it ───────────────────────
  //
  // Two passes rather than one, because both of the things that go wrong on a
  // fixed-size card need the total height BEFORE the first stroke: a four-seat
  // game with two awards leaves a third of the card empty, and an eight-seat
  // game with five awards runs off the bottom. Drawing as you go can only ever
  // catch the second one, and only once it is too late to do much about it.
  //
  // Wrapping is done here and the lines are kept, so the draw pass measures
  // nothing twice and cannot disagree with what was planned.
  ctx.font = `400 30px ${theme.font}`
  const winnerLines = wrap(ctx, spec.winnerLine, W - PAD * 2 - 60)

  const wrapBlurb = (blurb: string) => {
    ctx.font = `400 26px ${theme.font}`
    return wrap(ctx, blurb, W - PAD * 2)
  }

  let rowStep = 54
  let awards = spec.awards.map((a) => ({ ...a, lines: wrapBlurb(a.blurb) }))

  const awardsHeight = (list: typeof awards) =>
    list.reduce((sum, a) => sum + 36 + (a.who ? 34 : 0) + a.lines.length * 34 + 20, 0)

  // Headline block, board block, awards block — everything below the lockup.
  const bodyHeight = () =>
    54 + 32 + 88 + winnerLines.length * 40 + 70 + spec.board.length * rowStep + 56 +
    awardsHeight(awards)

  const room = H - PAD - y

  // Rows lose their air before anything is dropped.
  if (bodyHeight() > room) rowStep = 46
  // Then awards go — from the TOP, because the list is editorially ordered with
  // the funny one last, and trimming from the end takes the punchline.
  while (awards.length > 1 && bodyHeight() > room) awards = awards.slice(1)

  /**
   * The slack, spent on centring rather than left at the bottom.
   *
   * The lockup stays pinned to the top, where a brand belongs. Everything under
   * it floats in what is left, so a short card reads as composed instead of as
   * a long card that ran out of things to say.
   */
  y += Math.max(0, (room - bodyHeight()) / 2)

  // ── the result ────────────────────────────────────────────────────────
  y += 54
  ctx.font = `800 26px ${theme.font}`
  ctx.fillStyle = theme.muted
  tracked(ctx, caps(spec.headline), mid, y, 6)

  y += 86
  ctx.font = `800 78px ${theme.font}`
  ctx.fillStyle = theme.ink
  ctx.fillText(spec.winnerName, mid, y)

  y += 46
  ctx.font = `400 30px ${theme.font}`
  ctx.fillStyle = theme.muted
  for (const line of winnerLines) {
    ctx.fillText(line, mid, y)
    y += 40
  }

  // ── the board ─────────────────────────────────────────────────────────
  y += 24
  ctx.fillStyle = theme.rule
  ctx.fillRect(PAD, y, W - PAD * 2, 2)
  y += 44

  for (const row of spec.board) {
    ctx.font = `${row.won ? 700 : 500} 34px ${theme.font}`
    ctx.textAlign = 'left'
    ctx.fillStyle = row.won ? theme.accent : theme.muted
    ctx.fillText(String(row.place), PAD, y)
    ctx.fillStyle = row.won ? theme.ink : theme.muted
    ctx.fillText(row.name, PAD + 56, y)
    ctx.textAlign = 'right'
    ctx.fillText(row.score, W - PAD, y)
    y += rowStep
  }

  // ── the honors ────────────────────────────────────────────────────────
  y += 6
  ctx.fillStyle = theme.rule
  ctx.fillRect(PAD, y, W - PAD * 2, 2)
  y += 48

  ctx.textAlign = 'left'
  for (const award of awards) {
    ctx.font = `800 22px ${theme.font}`
    ctx.fillStyle = theme.muted
    {
      let x = PAD
      for (const c of [...award.title.toUpperCase()]) {
        ctx.fillText(c, x, y)
        x += ctx.measureText(c).width + 3
      }
    }
    y += 36

    // Names on their own line in the accent, exactly like the Awards list on
    // screen — and blurbs never carry a name, so the two can't disagree.
    if (award.who) {
      ctx.font = `700 34px ${theme.font}`
      ctx.fillStyle = theme.accent
      ctx.fillText(award.who, PAD, y)
      y += 34
    }

    ctx.font = `400 26px ${theme.font}`
    ctx.fillStyle = theme.muted
    for (const line of award.lines) {
      ctx.fillText(line, PAD, y)
      y += 34
    }
    y += 20
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card.'))),
      'image/png',
    )
  })
}

export type ShareOutcome = 'shared' | 'downloaded' | 'unavailable'

/**
 * Hand the card to the share sheet.
 *
 * ⚠️ Call this DIRECTLY from the tap handler with a file already rendered.
 * Anything awaited before it costs you the gesture and the sheet never opens.
 *
 * The fallback is a download rather than an error: a phone that cannot share a
 * file can still save a picture, and the person then sends it themselves.
 * A canceled share is not a failure — it reports `shared`, because the user
 * did exactly what they meant to.
 */
export async function shareCard(file: File, title: string): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e: any) {
      // AbortError is the user closing the sheet. Nothing to report and
      // certainly nothing to "fall back" to.
      if (e?.name === 'AbortError') return 'shared'
    }
  }

  try {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    // Revoked on the next tick: revoking immediately races the download in
    // Safari and produces a saved file of zero bytes.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'downloaded'
  } catch {
    return 'unavailable'
  }
}
