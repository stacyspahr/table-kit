import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RulingsList } from './triage.js'

afterEach(cleanup)

const covered = {
  id: 'r1',
  created: '2026-08-03 15:01:45.923Z',
  question: 'Can a person pass on the turn?',
  answer: 'No — every player plays exactly one card every turn.',
  context: '',
  thread: [
    { role: 'user', content: 'Can a person pass on the turn?' },
    { role: 'assistant', content: 'No — every player plays exactly one card every turn.' },
  ],
  status: 'new',
  bucket: '',
  asker_role: 'host',
  game: '',
}

const gap = {
  ...covered,
  id: 'r2',
  question: 'What if two people tie for fewest?',
  answer: "The rulebook doesn't cover this. I'd play another round.",
  context: 'goal 66',
}

function store(rows: any[]) {
  const updates: { id: string; data: any }[] = []
  const pb = {
    collection: () => ({
      getFullList: async () => rows,
      update: async (id: string, data: any) => {
        updates.push({ id, data })
        return { ...rows.find((r) => r.id === id), ...data }
      },
    }),
  }
  return { pb, updates }
}

function list(rows: any[]) {
  const { pb, updates } = store(rows)
  return { updates, ...render(<RulingsList pb={pb} collection="heat_rulings" onClose={() => {}} />) }
}

describe('reading the questions', () => {
  it('shows the question first and the ruling under it', async () => {
    list([covered])
    expect(await screen.findByText('Can a person pass on the turn?')).toBeTruthy()
    expect(screen.getByText(/every player plays exactly one card/)).toBeTruthy()
  })

  it('flags the one the adviser said was not in the rulebook', async () => {
    // The free marker, and the only tag that changes what you do about a
    // question. It comes from the adviser's own words, not from a classifier.
    list([gap])
    expect(await screen.findByText('not in the rulebook')).toBeTruthy()
  })

  it('does not flag one the rulebook already answered', async () => {
    list([covered])
    await screen.findByText('Can a person pass on the turn?')
    expect(screen.queryByText('not in the rulebook')).toBeNull()
  })

  it('reads as finished rather than broken when there is nothing waiting', async () => {
    // The most common state by far — this is a family game night, not a
    // support desk, and an empty list means every question has been dealt with.
    list([])
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy()
  })
})

describe('deciding what to do about one', () => {
  it('keeps a decided ruling on screen, moved to the edit pile', async () => {
    // Deciding is not editing: the rulebook is a file in a repo. Clearing it
    // here would file the decision and lose the job it created.
    const { updates } = list([covered])
    fireEvent.click(await screen.findByText('Fix the sheet'))

    await waitFor(() => expect(updates).toEqual([{ id: 'r1', data: { bucket: 'sheet' } }]))
    expect(await screen.findByText('Waiting on an edit')).toBeTruthy()
    expect(screen.getByText('Can a person pass on the turn?')).toBeTruthy()
  })

  it('takes a dismissed one off the list entirely', async () => {
    // ⚠️ The tap that keeps this feature alive. An inbox that never empties is
    // an inbox you stop opening.
    const { updates } = list([covered])
    fireEvent.click(await screen.findByText('Nothing to do'))

    await waitFor(() => expect(screen.queryByText('Can a person pass on the turn?')).toBeNull())
    expect(updates).toEqual([{ id: 'r1', data: { status: 'dismissed', bucket: '' } }])
  })

  it('clears it once the rules have caught up', async () => {
    const { updates } = list([{ ...covered, bucket: 'rule' }])
    fireEvent.click(await screen.findByText(/Done — the rules say it now/))

    await waitFor(() => expect(updates).toEqual([{ id: 'r1', data: { status: 'kept' } }]))
    expect(screen.queryByText('Can a person pass on the turn?')).toBeNull()
  })

  it('puts a row back when the write fails', async () => {
    // A decision that silently didn't save is worse than one that visibly
    // didn't — the whole point is that the list is the record.
    const pb = {
      collection: () => ({
        getFullList: async () => [covered],
        update: async () => {
          throw new Error('offline')
        },
      }),
    }
    render(<RulingsList pb={pb} collection="heat_rulings" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Nothing to do'))
    expect(await screen.findByText(/didn't save/)).toBeTruthy()
    expect(screen.getByText('Can a person pass on the turn?')).toBeTruthy()
  })
})

describe('the rest of the conversation', () => {
  it('stays folded away until asked for', async () => {
    // Not a transcript browser. The follow-ups are where the real question
    // usually landed, which is worth having and not worth showing.
    const withFollowUps = {
      ...covered,
      thread: [
        { role: 'user', content: 'Can a person pass on the turn?' },
        { role: 'assistant', content: 'No.' },
        { role: 'user', content: 'What if their hand is empty?' },
        { role: 'assistant', content: 'It cannot be before the tenth turn.' },
      ],
    }
    list([withFollowUps])

    expect(screen.queryByText('What if their hand is empty?')).toBeNull()
    fireEvent.click(await screen.findByText(/The rest of it/))
    expect(screen.getByText('What if their hand is empty?')).toBeTruthy()
  })
})
