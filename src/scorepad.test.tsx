/**
 * The score pad.
 *
 * Two of these are load-bearing rather than incidental: the open round must
 * never appear, and only the round the caller nominated may be tapped. Both are
 * the kind of thing that works on the night it ships and quietly stops working
 * when somebody reorders the rounds later.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScorePad, closedRounds, signed } from './scorepad.js'
import type { GameRec, GameState, PlayerRec, RoundRec, SubmissionRec } from './state.js'

afterEach(cleanup)

const player = (id: string, seat: number, joined = 1): PlayerRec => ({
  id,
  game: 'g1',
  display_name: id,
  seat_order: seat,
  device_id: '',
  guest: '',
  roster_entry: '',
  joined_round: joined,
})

const round = (id: string, n: number, status: RoundRec['status']): RoundRec => ({
  id,
  game: 'g1',
  round_number: n,
  status,
})

const sub = (roundId: string, playerId: string, score: number): SubmissionRec => ({
  id: `${roundId}-${playerId}`,
  round: roundId,
  player: playerId,
  computed_score: score,
  submitted_by: playerId,
  client_uuid: `${roundId}-${playerId}`,
  created: '2026-08-04 20:00:00',
})

function state(rounds: RoundRec[], submissions: SubmissionRec[]): GameState<GameRec, SubmissionRec> {
  return {
    game: { id: 'g1', join_token: 't', status: 'active', host_user: 'h', created: '' },
    players: [player('ann', 1), player('bo', 2)],
    rounds,
    submissions,
    current: rounds.find((r) => r.status !== 'closed') ?? null,
  }
}

const rounds = [round('r1', 1, 'closed'), round('r2', 2, 'closed'), round('r3', 3, 'open')]
const subs = [
  sub('r1', 'ann', 5),
  sub('r1', 'bo', 12),
  sub('r2', 'ann', 3),
  sub('r2', 'bo', 20),
  // The round in play. Nothing below may ever surface this.
  sub('r3', 'ann', 99),
  sub('r3', 'bo', 99),
]

describe('closedRounds', () => {
  it('keeps only banked rounds, newest first', () => {
    expect(closedRounds(rounds).map((r) => r.round_number)).toEqual([2, 1])
  })

  it('leaves out a round in review — it is not banked until it is closed', () => {
    const r = [round('r1', 1, 'closed'), round('r2', 2, 'review')]
    expect(closedRounds(r).map((r) => r.round_number)).toEqual([1])
  })
})

describe('signed', () => {
  it('marks a gain and leaves a loss alone', () => {
    expect(signed(12)).toBe('+12')
    expect(signed(-3)).toBe('-3')
    expect(signed(0)).toBe('0')
  })
})

describe('ScorePad', () => {
  it('opens on the round that just happened', () => {
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    expect(screen.getByRole('heading').textContent).toBe('Round 2')
  })

  it('never shows the round still being played', () => {
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    // Page all the way back; round 3 must not appear at either end.
    fireEvent.click(screen.getByLabelText(/before this one/))
    expect(screen.getByRole('heading').textContent).toBe('Round 1')
    expect(screen.queryByText('+99')).toBeNull()
  })

  it('shows what the round moved you by and where it left you', () => {
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    // Round 2: ann took 3 to sit on 8, bo took 20 to sit on 32.
    expect(screen.getByText('+3')).toBeTruthy()
    expect(screen.getByText('8 so far')).toBeTruthy()
    expect(screen.getByText('+20')).toBeTruthy()
    expect(screen.getByText('32 so far')).toBeTruthy()
  })

  it('pages back to round 1 and stops', () => {
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText(/before this one/))
    expect(screen.getByRole('heading').textContent).toBe('Round 1')
    expect(screen.getByLabelText(/before this one/)).toHaveProperty('disabled', true)
  })

  it('only lets you tap the round the caller nominated', () => {
    const onFix = vi.fn()
    render(
      <ScorePad
        state={state(rounds, subs)}
        winner="lowest"
        fixable={rounds[1]}
        onFix={onFix}
        onClose={() => {}}
      />,
    )
    // Round 2 is fixable — the seats are buttons.
    fireEvent.click(screen.getByText('bo'))
    expect(onFix).toHaveBeenCalledOnce()
    expect(onFix.mock.calls[0]![0].id).toBe('bo')

    // Round 1 is not. Tapping a name there does nothing at all.
    fireEvent.click(screen.getByLabelText(/before this one/))
    fireEvent.click(screen.getByText('bo'))
    expect(onFix).toHaveBeenCalledOnce()
    expect(screen.getByText(/Only the latest round can still be changed/)).toBeTruthy()
  })

  it('is entirely read-only when the caller nominates nothing', () => {
    const onFix = vi.fn()
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    fireEvent.click(screen.getByText('bo'))
    expect(onFix).not.toHaveBeenCalled()
  })

  it('does not promise a fix path the app does not have', () => {
    // ⚠️ Reported from an Oh Hell game: "entering the scorecard won't allow me
    // to change the last round count… if we shouldn't allow it, then the text
    // at the bottom shouldn't say only the latest hand can be changed."
    //
    // Three of the four scorers pass no `fixable` at all, and all three were
    // telling their table that the newest round was editable. It is not — there
    // is no route to editing anything.
    render(<ScorePad state={state(rounds, subs)} winner="lowest" onClose={() => {}} />)
    expect(screen.getByText('Scored and banked.')).toBeTruthy()
    expect(screen.queryByText(/can still be changed/)).toBeNull()
  })

  it('says so rather than showing an empty board before the first round is banked', () => {
    render(
      <ScorePad state={state([round('r1', 1, 'open')], [])} winner="lowest" onClose={() => {}} />,
    )
    expect(screen.getByText('Nothing has been scored yet.')).toBeTruthy()
  })
})
