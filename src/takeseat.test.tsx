/**
 * Taking a seat in place.
 *
 * The load-bearing ones here are the two that are easy to lose later: an
 * occupied seat must never be offered inline (it is somebody's score, and the
 * confirm that protects it lives on the full screen), and `onOpen` must finish
 * before a single name is drawn (it is where the credential gets minted, and a
 * name tapped ahead of it writes with the wrong client).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TakeSeat } from './takeseat.js'
import { rememberSeat, recalledSeats, forgetSeats } from './roster.js'
import type { PlayerRec } from './state.js'

afterEach(() => {
  cleanup()
  forgetSeats(APP)
})

const APP = 'test'

const seat = (id: string, name: string, deviceId = ''): PlayerRec => ({
  id,
  game: 'g1',
  display_name: name,
  seat_order: 1,
  device_id: deviceId,
  guest: '',
  roster_entry: '',
  joined_round: 1,
})

const roster = [
  { id: 'r1', display_name: 'Stacy' },
  { id: 'r2', display_name: 'Michelle' },
]

function setup(props: Partial<Parameters<typeof TakeSeat>[0]> = {}) {
  const onClaim = vi.fn().mockResolvedValue(undefined)
  const onReclaim = vi.fn().mockResolvedValue(undefined)
  render(
    <TakeSeat
      appKey={APP}
      players={[]}
      roster={roster}
      onClaim={onClaim}
      onReclaim={onReclaim}
      {...(props as any)}
    />,
  )
  return { onClaim, onReclaim }
}

async function openPanel() {
  fireEvent.click(screen.getByText('Take a seat'))
  await waitFor(() => screen.getByText('Never mind'))
}

describe('TakeSeat', () => {
  it('shows nothing but the one button until it is opened', () => {
    setup()
    expect(screen.getByText('Take a seat')).toBeTruthy()
    expect(screen.queryByText('Never mind')).toBeNull()
    expect(screen.queryByText('Stacy')).toBeNull()
  })

  it('takes the game’s own wording for the act', () => {
    setup({ label: 'Play this one too' })
    expect(screen.getByText('Play this one too')).toBeTruthy()
  })

  it('runs onOpen before it draws a single name', async () => {
    const order: string[] = []
    const onOpen = vi.fn(async () => {
      order.push('open')
    })
    setup({ onOpen })
    fireEvent.click(screen.getByText('Take a seat'))
    await waitFor(() => screen.getByText('Never mind'))
    order.push('drawn')
    expect(onOpen).toHaveBeenCalledOnce()
    expect(order).toEqual(['open', 'drawn'])
  })

  it('reports an onOpen failure and stays shut, rather than listing names that cannot be tapped', async () => {
    const onOpen = vi.fn().mockRejectedValue(new Error('No signal.'))
    setup({ onOpen })
    fireEvent.click(screen.getByText('Take a seat'))
    await waitFor(() => screen.getByText('No signal.'))
    expect(screen.queryByText('Never mind')).toBeNull()
    // Still offered, so the failure is retryable rather than terminal.
    expect(screen.getByText('Take a seat')).toBeTruthy()
  })

  it('claims a roster name and remembers it for next time', async () => {
    const { onClaim } = setup()
    await openPanel()
    fireEvent.click(screen.getByText('Stacy'))
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('Stacy', 'r1'))
    expect(recalledSeats(APP)[0]?.display_name).toBe('Stacy')
  })

  it('shuts once the seat is taken — the list underneath is the answer', async () => {
    setup()
    await openPanel()
    fireEvent.click(screen.getByText('Stacy'))
    await waitFor(() => expect(screen.queryByText('Never mind')).toBeNull())
    expect(screen.getByText('Take a seat')).toBeTruthy()
  })

  it('surfaces a rejected write instead of looking inert', async () => {
    const onClaim = vi.fn().mockRejectedValue(new Error('That seat went.'))
    render(
      <TakeSeat
        appKey={APP}
        players={[]}
        roster={roster}
        onClaim={onClaim}
        onReclaim={vi.fn()}
      />,
    )
    await openPanel()
    fireEvent.click(screen.getByText('Stacy'))
    await waitFor(() => screen.getByText('That seat went.'))
    // Still open, so the next name along is one tap away.
    expect(screen.getByText('Never mind')).toBeTruthy()
  })

  it('offers an unclaimed seat back — the host who added themselves without a phone', async () => {
    rememberSeat(APP, { display_name: 'Stacy' })
    const players = [seat('p1', 'Stacy')]
    const { onReclaim } = setup({ players })
    await openPanel()
    fireEvent.click(screen.getByText("I'm Stacy"))
    await waitFor(() => expect(onReclaim).toHaveBeenCalledWith(players[0]))
  })

  it('NEVER offers a seat another phone is holding', async () => {
    rememberSeat(APP, { display_name: 'Stacy' })
    setup({ players: [seat('p1', 'Stacy', 'someone-elses-phone')] })
    await openPanel()
    expect(screen.queryByText("I'm Stacy")).toBeNull()
  })

  it('lets a name be typed when the roster has nobody left', async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined)
    render(
      <TakeSeat appKey={APP} players={[]} roster={[]} onClaim={onClaim} onReclaim={vi.fn()} />,
    )
    await openPanel()
    fireEvent.click(screen.getByText('Type your name'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Michelle'), { target: { value: 'Zak' } })
    fireEvent.click(screen.getByText("That's me"))
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('Zak'))
  })

  it('drops names already sitting from the list', async () => {
    setup({ players: [seat('p1', 'Michelle', 'her-phone')] })
    await openPanel()
    expect(screen.getByText('Stacy')).toBeTruthy()
    expect(screen.queryByText('Michelle')).toBeNull()
  })

  it('shuts on Never mind without claiming anything', async () => {
    const { onClaim, onReclaim } = setup()
    await openPanel()
    fireEvent.click(screen.getByText('Never mind'))
    await waitFor(() => expect(screen.queryByText('Never mind')).toBeNull())
    expect(onClaim).not.toHaveBeenCalled()
    expect(onReclaim).not.toHaveBeenCalled()
  })
})
