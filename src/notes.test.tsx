/**
 * Notes to self.
 *
 * `isOwner` is the one worth the most care. It decides whether a control is
 * drawn, and the failure it must not have is the quiet one — being wrong for a
 * reason nobody can see, like a capital letter in an address.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteBox, isOwner, saveNote } from './notes.js'

afterEach(cleanup)

const store = (email?: string, create = vi.fn().mockResolvedValue({})) => ({
  authStore: { record: email === undefined ? null : { email } },
  collection: () => ({ create }),
})

describe('isOwner', () => {
  it('is true for the address the app was given', () => {
    expect(isOwner(store('stacy@example.com'), 'stacy@example.com')).toBe(true)
  })

  it('does not care about case or stray spaces', () => {
    expect(isOwner(store(' Stacy@Example.com '), 'stacy@example.com')).toBe(true)
  })

  it('is false for any other host', () => {
    expect(isOwner(store('michelle@example.com'), 'stacy@example.com')).toBe(false)
  })

  it('is false for a guest, who has no address at all', () => {
    expect(isOwner(store(undefined), 'stacy@example.com')).toBe(false)
    expect(isOwner(store(''), 'stacy@example.com')).toBe(false)
  })

  it('is false when the app was configured with nothing — never open by default', () => {
    expect(isOwner(store('stacy@example.com'), undefined)).toBe(false)
    expect(isOwner(store('stacy@example.com'), '')).toBe(false)
  })
})

describe('saveNote', () => {
  it('files the note with its stamp and trims what was typed', async () => {
    const create = vi.fn().mockResolvedValue({})
    await saveNote(store('s@e.com', create), { app: 'heat', game: 'g1', round: 4 }, '  totals look off \n')

    expect(create).toHaveBeenCalledWith({
      app: 'heat',
      game: 'g1',
      game_label: '',
      round: 4,
      body: 'totals look off',
      sent: false,
    })
  })

  it('stamps round 0 when there is no round on screen', async () => {
    const create = vi.fn().mockResolvedValue({})
    await saveNote(store('s@e.com', create), { app: 'nine', game: 'g2' }, 'x')
    expect(create.mock.calls[0]![0].round).toBe(0)
  })
})

describe('NoteBox', () => {
  it('will not file an empty note', () => {
    render(<NoteBox pb={store('s@e.com')} stamp={{ app: 'heat', game: 'g1' }} onClose={() => {}} />)
    expect(screen.getByText('Save the note')).toHaveProperty('disabled', true)
  })

  it('clears itself after saving so a second thought is one tap away', async () => {
    const create = vi.fn().mockResolvedValue({})
    render(
      <NoteBox
        pb={store('s@e.com', create)}
        stamp={{ app: 'heat', game: 'g1', round: 2 }}
        onClose={() => {}}
      />,
    )
    const box = screen.getByLabelText('Your note')
    fireEvent.change(box, { target: { value: 'the reveal ran twice' } })
    fireEvent.click(screen.getByText('Save the note'))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect((box as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText(/Saved\./)).toBeTruthy()
  })

  it('says what the note is being stamped with', () => {
    render(
      <NoteBox
        pb={store('s@e.com')}
        stamp={{ app: 'heat', game: 'g1', round: 7 }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/round 7/)).toBeTruthy()
  })

  it('keeps what was typed when the save fails', async () => {
    const create = vi.fn().mockRejectedValue({ response: { message: 'nope' } })
    render(
      <NoteBox pb={store('s@e.com', create)} stamp={{ app: 'heat', game: 'g1' }} onClose={() => {}} />,
    )
    const box = screen.getByLabelText('Your note')
    fireEvent.change(box, { target: { value: 'do not lose me' } })
    fireEvent.click(screen.getByText('Save the note'))

    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy())
    expect((box as HTMLTextAreaElement).value).toBe('do not lose me')
  })
})
