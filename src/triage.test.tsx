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

/**
 * Two different reads now: the open list, and the settled archive behind the
 * "asked before" count. The fake honours the filter rather than handing the
 * same rows to both — an open ruling appearing in its own archive would count
 * itself, which is a bug the fixture must be able to catch.
 */
function store(rows: any[], archive: any[] = []) {
  const updates: { id: string; data: any }[] = []
  const pb = {
    collection: () => ({
      getFullList: async (opts?: any) =>
        String(opts?.filter).includes('!=') ? archive : rows,
      update: async (id: string, data: any) => {
        updates.push({ id, data })
        return { ...rows.find((r) => r.id === id), ...data }
      },
    }),
  }
  return { pb, updates }
}

function list(rows: any[], archive: any[] = []) {
  const { pb, updates } = store(rows, archive)
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

describe('a question that has come up before', () => {
  it('says which time it is, counting the ones already settled', async () => {
    // ⚠️ The whole reason this exists. Dismissing the first ask is the correct
    // move — one person not finding a rule is one person — and it is also what
    // makes the second one unrecognisable without a count.
    list([covered], [{ ...covered, id: 'old', status: 'dismissed' }])
    expect(await screen.findByText('2nd time this has come up')).toBeTruthy()
  })

  it('stays quiet the first time something is asked', async () => {
    list([covered], [{ ...covered, id: 'old', question: 'What ends the game?' }])
    await screen.findByText('Can a person pass on the turn?')
    expect(screen.queryByText(/time this has come up/)).toBeNull()
  })

  it('never counts an open question against itself', async () => {
    // The archive is read with `status != "new"`, so the row on screen cannot
    // be in it. Worth a test: the tag would otherwise appear on everything.
    list([covered])
    await screen.findByText('Can a person pass on the turn?')
    expect(screen.queryByText(/time this has come up/)).toBeNull()
  })

  it('still renders the list when the archive cannot be read', async () => {
    // A nicety on top of the list. No count is a worse screen; a broken one is
    // a useless screen.
    const pb = {
      collection: () => ({
        getFullList: async (opts?: any) => {
          if (String(opts?.filter).includes('!=')) throw new Error('nope')
          return [covered]
        },
        update: async (id: string, data: any) => ({ id, ...data }),
      }),
    }
    render(<RulingsList pb={pb} collection="heat_rulings" onClose={() => {}} />)
    expect(await screen.findByText('Can a person pass on the turn?')).toBeTruthy()
  })
})
