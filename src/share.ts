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

/**
 * One number in a box.
 *
 * ⚠️ The color is the GAME's, never the kit's. Play Nine writes a negative
 * hole in red because golf prints under par in red and here the negatives are
 * the good scores; a kit that decided "negative means red" would be stating
 * that opinion on behalf of every scorer it ever draws, and it would be wrong
 * the first time a game counted downward.
 */
export interface CardCell {
  text: string
  /** Overrides the cell ink. Omitted, it takes `theme.ink`. */
  color?: string
  /**
   * Degrees of tilt, for a game that writes its numbers rather than setting
   * them. The kit supplies no angle of its own and no randomness — a card that
   * re-rolled its own wobble would not match the screen it was rendered from.
   */
  tilt?: number
}

export interface CardGridRow {
  name: string
  /** One per column, in column order. */
  cells: CardCell[]
  total: CardCell
  /** Winners are drawn in the accent, and ringed if the grid asks for it. */
  won: boolean
}

/**
 * The board drawn round by round instead of as one line per player.
 *
 * A scorer whose rounds are worth looking at individually — nine holes of golf,
 * where the −20 on hole six is the story — hands this instead of `board`. One
 * that only has a running total (peppers eaten, points to 66) keeps `board`,
 * which stays the default because a grid of one column is not a grid.
 */
export interface CardGrid {
  /** Over the name column. "player". */
  nameLabel: string
  /** One heading per round. "1".."9". */
  columns: string[]
  /** Over the last column. "tot". */
  totalLabel: string
  rows: CardGridRow[]
  /** The ink for the printed labels, as against the ink in the boxes. */
  printed?: string
  /** The numbers, when the game writes them in something else. */
  cellFont?: string
  /** Ring the winning total, the way somebody at the table would. */
  ringWinner?: boolean
  /**
   * The ring's own ink, when it is not the number's.
   *
   * Play Nine writes a winning total of −11 in red and still rings it in
   * pencil, because on the table the ring came from the pencil and the red is
   * a convention about the number. A ring that inherited the number's color
   * would be a detail the photograph got wrong.
   */
  ringColor?: string
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
  /**
   * Every seat, including the phoneless ones. The board is what people argue
   * about.
   *
   * One of `board` or `grid`, never both — they are two drawings of the same
   * block, and a card carrying each would say the totals twice. `grid` wins if
   * a caller passes both.
   */
  board?: CardRow[]
  /** The round-by-round board, for a game whose rounds are worth reading. */
  grid?: CardGrid
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

/** One number, in its box, at whatever angle the game asked for. */
function writeCell(
  ctx: CanvasRenderingContext2D,
  cell: CardCell,
  cx: number,
  y: number,
  theme: CardTheme,
): void {
  ctx.fillStyle = cell.color ?? theme.ink
  if (!cell.tilt) {
    ctx.fillText(cell.text, cx, y)
    return
  }
  // Rotated about the number itself rather than the canvas origin, or a 3°
  // tilt at the right-hand edge of the card becomes a 30px shift.
  ctx.save()
  ctx.translate(cx, y)
  ctx.rotate((cell.tilt * Math.PI) / 180)
  ctx.fillText(cell.text, 0, 0)
  ctx.restore()
}

/**
 * The round-by-round block, drawn as boxes on a card.
 *
 * ── Why the columns are capped ───────────────────────────────────────────
 * Nine holes across a 936px card give 70px boxes, which is about right. Three
 * holes given the same width give 230px boxes with a two-character number
 * floating in the middle of each, which reads as a mistake rather than as a
 * short game. So a box has a maximum size and a short grid is centred in the
 * room it does not need.
 *
 * ── Why the name column is measured ──────────────────────────────────────
 * The suite's one hard layout rule is that a name is never squeezed. The name
 * column is therefore as wide as the longest name at the table, and it is the
 * boxes that give way — up to the point where the boxes would stop being
 * legible, after which the name is allowed to run under its own row instead.
 *
 * Returns the y of the first baseline below the block.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: CardGrid,
  theme: CardTheme,
  top: number,
  rowStep: number,
): number {
  const cellFont = grid.cellFont ?? theme.font
  const printed = grid.printed ?? theme.muted
  const cols = grid.columns.length

  ctx.font = `500 30px ${theme.font}`
  const widest = grid.rows.reduce((w, r) => Math.max(w, ctx.measureText(r.name).width), 0)
  const nameW = Math.min(300, Math.max(150, widest + 24))
  const totalW = 118
  const colW = Math.min(104, Math.max(46, (W - PAD * 2 - nameW - totalW) / cols))
  const gridW = nameW + colW * cols + totalW
  const x0 = Math.round((W - gridW) / 2)

  // Every vertical boundary: after the name, between the boxes, before the total.
  const edges: number[] = [x0 + nameW]
  for (let i = 1; i <= cols; i += 1) edges.push(x0 + nameW + colW * i)

  let y = top
  const baselines: number[] = []
  ctx.textBaseline = 'alphabetic'

  // ── the printed headings ──────────────────────────────────────────────
  ctx.font = `700 22px ${theme.font}`
  ctx.fillStyle = printed
  ctx.textAlign = 'left'
  ctx.fillText(grid.nameLabel, x0 + 4, y)
  ctx.textAlign = 'center'
  grid.columns.forEach((label, i) => {
    ctx.fillText(label, x0 + nameW + colW * i + colW / 2, y)
  })
  ctx.fillText(grid.totalLabel, x0 + nameW + colW * cols + totalW / 2, y)

  const gridTop = y + 14
  y += 40

  // ── the numbers ───────────────────────────────────────────────────────
  for (const row of grid.rows) {
    baselines.push(y)
    ctx.font = `500 30px ${theme.font}`
    ctx.fillStyle = row.won ? theme.accent : theme.ink
    ctx.textAlign = 'left'
    ctx.fillText(row.name, x0 + 4, y)

    ctx.font = `400 34px ${cellFont}`
    ctx.textAlign = 'center'
    row.cells.slice(0, cols).forEach((cell, i) => {
      writeCell(ctx, cell, x0 + nameW + colW * i + colW / 2, y, theme)
    })

    const totalX = x0 + nameW + colW * cols + totalW / 2
    writeCell(ctx, row.total, totalX, y, theme)

    // The way you would circle it. The only ink on the card that isn't a number.
    if (row.won && grid.ringWinner) {
      const w = ctx.measureText(row.total.text).width
      ctx.save()
      ctx.strokeStyle = grid.ringColor ?? row.total.color ?? theme.ink
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(totalX, y - 11, Math.max(26, w / 2 + 14), 24, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    y += rowStep
  }

  // ── the boxes, drawn last so no number sits on a line ─────────────────
  const gridBottom = (baselines[baselines.length - 1] ?? gridTop) + 16
  ctx.fillStyle = theme.rule
  ctx.fillRect(x0, gridTop, gridW, 1)
  ctx.fillRect(x0, gridBottom, gridW, 1)
  // Off each baseline rather than evenly through the block, so a line never
  // lands across the tops of a row of numbers.
  for (const b of baselines.slice(1)) ctx.fillRect(x0, b - 34, gridW, 1)
  for (const x of edges) ctx.fillRect(x, gridTop, 1, gridBottom - gridTop)

  ctx.textAlign = 'center'
  return y
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

  // One block or the other, never both — a card carrying a grid AND a board
  // would print every total twice.
  const grid = spec.grid
  const board = grid ? [] : (spec.board ?? [])
  const seats = grid ? grid.rows.length : board.length
  // The grid pays for its row of printed headings; the board has none.
  const boardHeight = () => (grid ? 40 : 0) + seats * rowStep

  // Headline block, board block, awards block — everything below the lockup.
  const bodyHeight = () =>
    54 + 32 + 88 + winnerLines.length * 40 + 70 + boardHeight() + 56 + awardsHeight(awards)

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

  if (grid) {
    y = drawGrid(ctx, grid, theme, y, rowStep)
  } else {
    for (const row of board) {
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
