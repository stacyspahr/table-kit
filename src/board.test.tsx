/**
 * The watcher's board.
 *
 * The one that matters most here is the draft: `done` is the caller's to
 * build, and the whole reason this file says so twice is that three separate
 * bugs in the suite came from treating an autosave as an answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TableBoard, WaitingOn } from './board.js'
import { standings } from './state.js'
import type { GameState, GameRec, PlayerRec, RoundRec, SubmissionRec } from './state.js'

afterEach(cleanup)

const player = (id: string, name: string, seat: number): PlayerRec => ({
  id,
  game: 'g1',
  display_name: name,
  seat_order: seat,
  device_id: '',
  guest: '',
  roster_entry: '',
  joined_round: 1,
})

const ann = player('ann', 'Ann', 1)
const bo = player('bo', 'Bo', 2)

const sub = (
  round: string,
  playerId: string,
  score: number,
  status?: 'draft' | 'final',
): SubmissionRec => ({
  id: `${round}-${playerId}`,
  round,
  player: playerId,
  computed_score: score,
  submitted_by: playerId,
  client_uuid: `${round}-${playerId}`,
  created: '2026-08-04 20:00:00',
  ...(status ? { status } : {}),
})

function state(subs: SubmissionRec[], roundStatus: RoundRec['status'] = 'closed'): GameState {
  const round: RoundRec = { id: 'r1', game: 'g1', round_number: 1, status: roundStatus }
  return {
    game: { id: 'g1', join_token: 't', status: 'active', host_user: 'h', created: '' } as GameRec,
    players: [ann, bo],
    rounds: [round],
    submissions: subs,
    current: roundStatus === 'closed' ? null : round,
  }
}

describe('TableBoard', () => {
  it('draws every seat in board order with the game’s own numbers', () => {
    const s = state([sub('r1', 'ann', 4), sub('r1', 'bo', 9)])
    render(
      <TableBoard
        standings={standings(s, 'lowest')}
        done={new Set()}
        format={(n) => (n > 0 ? `+${n}` : `${n}`)}
      />,
    )
    const names = screen.getAllByText(/Ann|Bo/).map((el) => el.textContent)
    expect(names).toEqual(['Ann', 'Bo'])
    expect(screen.getByText('+4')).toBeTruthy()
    expect(screen.getByText('+9')).toBeTruthy()
  })

  it('marks who has handed in and who has not', () => {
    const s = state([sub('r1', 'ann', 4)], 'open')
    const { container } = render(
      <TableBoard standings={standings(s, 'lowest')} done={new Set(['ann'])} format={(n) => n} />,
    )
    const ticks = [...container.querySelectorAll('.tk-board-tick')].map((el) => el.textContent)
    expect(ticks).toEqual(['✓', '○'])
  })

  it('shows the empty note before anybody has a total, rather than an empty box', () => {
    render(
      <TableBoard
        standings={[]}
        done={new Set()}
        format={(n) => n}
        emptyNote="Nobody has teed off yet."
      />,
    )
    expect(screen.getByText('Nobody has teed off yet.')).toBeTruthy()
  })

  it('renders nothing at all when empty and given no note', () => {
    const { container } = render(
      <TableBoard standings={[]} done={new Set()} format={(n) => n} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('WaitingOn', () => {
  it('names the seats still owing', () => {
    render(<WaitingOn players={[ann, bo]} />)
    expect(screen.getByText('Waiting on Ann, Bo.')).toBeTruthy()
  })

  it('says its piece when nobody is owing', () => {
    render(<WaitingOn players={[]} none="Every card is in." />)
    expect(screen.getByText('Every card is in.')).toBeTruthy()
  })

  it('renders nothing when nobody is owing and there is nothing to say', () => {
    const { container } = render(<WaitingOn players={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('a seat sitting out', () => {
  const s = state([sub('r1', 'ann', 4)], 'open')
  const gone = { ...bo, left_round: 1 }
  const withGone: GameState = { ...s, players: [ann, gone] }

  it('takes neither mark — an empty circle would read as still to hand in', () => {
    const { container } = render(
      <TableBoard
        standings={standings(withGone, 'lowest')}
        done={new Set(['ann'])}
        format={(n) => n}
        round={1}
      />,
    )
    expect([...container.querySelectorAll('.tk-board-tick')].map((el) => el.textContent)).toEqual([
      '✓',
      '',
    ])
  })

  it('says so on the row, in the game’s own words', () => {
    render(
      <TableBoard
        standings={standings(withGone, 'lowest')}
        done={new Set()}
        format={(n) => n}
        round={1}
        sittingOutLabel="out this hand"
      />,
    )
    expect(screen.getByText('out this hand')).toBeTruthy()
  })

  it('marks nobody when no round is given — an old caller is unaffected', () => {
    const { container } = render(
      <TableBoard standings={standings(withGone, 'lowest')} done={new Set()} format={(n) => n} />,
    )
    expect(container.querySelectorAll('.pill').length).toBe(0)
  })

  it('rows are plain until a mode makes them tappable', () => {
    const { container, rerender } = render(
      <TableBoard standings={standings(withGone, 'lowest')} done={new Set()} format={(n) => n} />,
    )
    expect(container.querySelectorAll('button').length).toBe(0)
    const onPick = vi.fn()
    rerender(
      <TableBoard
        standings={standings(withGone, 'lowest')}
        done={new Set()}
        format={(n) => n}
        onPick={onPick}
      />,
    )
    fireEvent.click(screen.getByText('Ann'))
    expect(onPick).toHaveBeenCalledWith(ann)
  })
})
