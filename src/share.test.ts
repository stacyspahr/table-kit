/**
 * The share card, tested where it can actually go wrong.
 *
 * Not "does it look right" — a canvas test cannot answer that, and a mockup
 * already did. What IS testable is the behavior a full table triggers: an
 * eight-seat game with five awards has to fit on a fixed 1080×1350 card, and
 * the rules about what gives are editorial decisions, not accidents.
 *
 * jsdom has no canvas, so `renderCard` is exercised against a stub context that
 * records what was drawn. That is enough to answer every question here: what
 * text reached the card, in what order, and what got dropped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderCard, shareCard, type CardSpec } from './share.js'

const theme = {
  bg: '#000',
  ink: '#fff',
  muted: '#999',
  accent: '#e80',
  rule: '#333',
  font: 'sans-serif',
  chromeCase: 'uppercase' as const,
}

/** Every string that reached the canvas, in draw order. */
let drawn: string[] = []
/** The stub context itself, for the few things drawn without any text. */
let pen: any

function stubCanvas() {
  drawn = []
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    ellipse: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    // 14px a character is close enough to real proportional text for the
    // wrapping and overflow maths to behave the way they will in a browser.
    measureText: (t: string) => ({ width: t.length * 14 }),
    fillText: (t: string) => drawn.push(t),
  }
  pen = ctx
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return {} as any
    return {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'], { type: 'image/png' })),
    } as any
  })
}

/** What reached the card as one string — glyphs are drawn one at a time. */
const asText = () => drawn.join('')

function spec(over: Partial<CardSpec> = {}): CardSpec {
  return {
    wordmark: 'Flip 7',
    headline: "That's the game",
    winnerName: 'Stacy',
    winnerLine: 'wins on 213 — first past 200',
    board: [
      { place: 1, name: 'Stacy', score: '213', won: true },
      { place: 2, name: 'Zak', score: '207', won: false },
    ],
    awards: [{ title: 'Photo Finish', blurb: '6 points in it.' }],
    theme,
    ...over,
  }
}

describe('renderCard', () => {
  beforeEach(stubCanvas)

  it('puts the winner, the board and the awards on the card', async () => {
    await renderCard(spec())
    const text = asText()
    expect(text).toContain('Stacy')
    expect(text).toContain('213')
    expect(text).toContain('Zak')
    expect(text).toContain('PHOTO FINISH')
  })

  it('draws every seat, including the ones nobody would miss', async () => {
    // A phoneless seat is a seat. The board is what the table argues about, and
    // an argument about a board with somebody left off it is a bug report.
    await renderCard(
      spec({
        board: Array.from({ length: 8 }, (_, i) => ({
          place: i + 1,
          name: `Player${i + 1}`,
          score: String(200 - i * 10),
          won: i === 0,
        })),
      }),
    )
    for (let i = 1; i <= 8; i++) expect(asText()).toContain(`Player${i}`)
  })

  it('trims awards from the TOP when a full table will not fit', async () => {
    // The list is editorially ordered with the funny one last. Cutting from the
    // end takes the punchline, so the card gives up the first one instead.
    await renderCard(
      spec({
        board: Array.from({ length: 8 }, (_, i) => ({
          place: i + 1,
          name: `Player${i + 1}`,
          score: '100',
          won: i === 0,
        })),
        awards: [
          { title: 'First Award', who: 'A', blurb: 'Some evidence for it.' },
          { title: 'Second Award', who: 'B', blurb: 'Some evidence for it.' },
          { title: 'Third Award', who: 'C', blurb: 'Some evidence for it.' },
          { title: 'Fourth Award', who: 'D', blurb: 'Some evidence for it.' },
          { title: 'Last Award', who: 'E', blurb: 'Some evidence for it.' },
        ],
      }),
    )
    const text = asText()
    expect(text).toContain('LAST AWARD')
    expect(text).not.toContain('FIRST AWARD')
  })

  it('keeps one award even on the most crowded card there can be', async () => {
    await renderCard(
      spec({
        board: Array.from({ length: 8 }, (_, i) => ({
          place: i + 1,
          name: `AVeryLongPlayerName${i + 1}`,
          score: '100',
          won: i === 0,
        })),
        awards: Array.from({ length: 5 }, (_, i) => ({
          title: `Award ${i}`,
          who: 'Somebody',
          blurb: 'A long sentence of evidence that will certainly have to wrap.',
        })),
      }),
    )
    expect(asText()).toContain('AWARD 4')
  })

  it('omits the shape line for a standard game and draws it otherwise', async () => {
    await renderCard(spec())
    expect(asText()).not.toContain('Brutal')

    await renderCard(spec({ shape: 'Brutal, to 200' }))
    expect(asText()).toContain('Brutal, to 200')
  })

  it('leaves the game its own sentence, verbatim', async () => {
    // The winner line is the one string the kit must never rewrite: "wins on 41
    // peppers — the fewest at the table" inverts the usual reading, and that
    // inversion is the whole of Beat the Heat.
    await renderCard(spec({ winnerLine: 'wins on 41 peppers — the fewest at the table' }))
    expect(asText()).toContain('the fewest at the table')
  })

  it('renders an award with no name — some are about the game, not a person', async () => {
    await renderCard(spec({ awards: [{ title: 'Photo Finish', blurb: '6 points in it.' }] }))
    const text = asText()
    expect(text).toContain('PHOTO FINISH')
    expect(text).toContain('6 points in it.')
  })

  it('still draws a card when there are no awards at all', async () => {
    const blob = await renderCard(spec({ awards: [] }))
    expect(blob.type).toBe('image/png')
    expect(asText()).toContain('Stacy')
  })

  it('lowercases nothing in the content, whatever the chrome case is', async () => {
    await renderCard(spec({ theme: { ...theme, chromeCase: 'none' } }))
    expect(asText()).toContain('Stacy')
    expect(asText()).toContain("That's the game")
  })
})

describe('renderCard with a grid', () => {
  beforeEach(stubCanvas)

  const gridSpec = (rows: number, cols: number, over: Partial<CardSpec> = {}): CardSpec =>
    spec({
      board: undefined,
      grid: {
        nameLabel: 'player',
        columns: Array.from({ length: cols }, (_, i) => String(i + 1)),
        totalLabel: 'tot',
        ringWinner: true,
        rows: Array.from({ length: rows }, (_, r) => ({
          name: `Player${r + 1}`,
          cells: Array.from({ length: cols }, (_, c) => ({ text: String(c + 1) })),
          total: { text: String(40 + r) },
          won: r === 0,
        })),
      },
      ...over,
    })

  it('draws every hole of every player, plus the printed headings', async () => {
    await renderCard(gridSpec(4, 9))
    const text = asText()
    expect(text).toContain('player')
    expect(text).toContain('tot')
    for (let i = 1; i <= 4; i++) expect(text).toContain(`Player${i}`)
    // Nine headings and nine numbers a row — the whole point of the grid.
    expect(text).toContain('9')
    expect(text).toContain('40')
    expect(text).toContain('43')
  })

  it('rings the winning total, and only the winning total', async () => {
    await renderCard(gridSpec(4, 9))
    expect(pen.ellipse).toHaveBeenCalledOnce()
  })

  it('rings in the game’s own ink, not the number’s', async () => {
    // A −11 is written in red and still ringed in pencil, because on the table
    // the ring came from the pencil.
    const s = gridSpec(2, 3)
    s.grid!.ringColor = '#3a3c42'
    s.grid!.rows[0]!.total.color = '#b0322a'
    await renderCard(s)
    expect(pen.strokeStyle).toBe('#3a3c42')
  })

  it('leaves the ring off when the game does not ask for it', async () => {
    const s = gridSpec(4, 9)
    s.grid!.ringWinner = false
    await renderCard(s)
    expect(pen.ellipse).not.toHaveBeenCalled()
  })

  it('draws the grid instead of the board when a caller passes both', async () => {
    // Two drawings of the same block would print every total twice.
    await renderCard(
      gridSpec(2, 9, {
        board: [{ place: 1, name: 'FromTheBoardBlock', score: '213', won: true }],
      }),
    )
    expect(asText()).not.toContain('FromTheBoardBlock')
  })

  it('fits a full table over nine holes with awards still on the card', async () => {
    // The card this game actually produces: six seats, nine holes, and the
    // honors underneath. If this one overflows, nothing else matters.
    await renderCard(
      gridSpec(6, 9, {
        awards: [
          { title: 'Never Up Never In', who: 'Zak', blurb: 'Left it short four times.' },
          { title: 'The Big Wood', who: 'Stacy', blurb: 'Went red on the sixth.' },
        ],
      }),
    )
    const text = asText()
    expect(text).toContain('Player6')
    expect(text).toContain('THE BIG WOOD')
  })

  it('writes a tilted number at its own angle and puts the pen back', async () => {
    // The wobble comes from the game, seeded per cell, so the picture matches
    // the screen it was rendered from. All the kit does is honor it — and it
    // must restore the canvas, or every stroke after the first tilt is skewed.
    const s = gridSpec(2, 3)
    s.grid!.rows[0]!.cells[0]!.tilt = -3
    await renderCard(s)
    expect(pen.rotate).toHaveBeenCalledWith((-3 * Math.PI) / 180)
    expect(pen.restore).toHaveBeenCalled()
    expect(asText()).toContain('Player1')
  })

  it('still draws a short game — three holes is a grid too', async () => {
    await renderCard(gridSpec(2, 3))
    expect(asText()).toContain('Player2')
  })
})

describe('shareCard', () => {
  const file = new File(['x'], 'card.png', { type: 'image/png' })

  it('uses the share sheet when the phone will take a file', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })
    expect(await shareCard(file, 'Flip 7')).toBe('shared')
    expect(share).toHaveBeenCalledOnce()
  })

  it('treats a canceled sheet as done, not as a failure to fall back from', async () => {
    // Closing the sheet is the user doing exactly what they meant to. Silently
    // downloading the card instead would be the app arguing with them.
    const err = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const click = vi.fn()
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(err) })
    vi.spyOn(document, 'createElement').mockReturnValue({ click } as any)
    expect(await shareCard(file, 'Flip 7')).toBe('shared')
    expect(click).not.toHaveBeenCalled()
  })

  it('falls back to a download where files cannot be shared', async () => {
    const click = vi.fn()
    vi.stubGlobal('navigator', { canShare: () => false })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    vi.spyOn(document, 'createElement').mockReturnValue({ click } as any)
    expect(await shareCard(file, 'Flip 7')).toBe('downloaded')
    expect(click).toHaveBeenCalledOnce()
  })

  it('survives a browser with no share API at all', async () => {
    const click = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    vi.spyOn(document, 'createElement').mockReturnValue({ click } as any)
    expect(await shareCard(file, 'Flip 7')).toBe('downloaded')
  })
})
