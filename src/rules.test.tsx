import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RulesSheet, type RuleSection } from './rules.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SECTIONS: RuleSection[] = [
  {
    id: 'start',
    title: 'Never played? Start here',
    entries: [
      { title: 'The object', body: 'Finish with the fewest peppers.' },
      { title: 'A tie at the front', body: 'Play another round.', source: 'table' },
    ],
  },
  {
    id: 'scoring',
    title: 'Scoring',
    entries: [{ title: 'The sixth card', body: 'You take the row.' }],
  },
]

function sheet(props: Partial<Parameters<typeof RulesSheet>[0]> = {}) {
  return render(
    <RulesSheet
      sections={SECTIONS}
      sourceLabel={{ table: 'table ruling' }}
      canAsk={false}
      onClose={() => {}}
      {...props}
    />,
  )
}

describe('the rulebook half', () => {
  it('opens on the lesson, not on the ask box', () => {
    // The whole reason the rulebook is the default tab: a first-timer holding a
    // printed box with no rules in it needs the lesson, not a question box.
    sheet({ canAsk: true })
    expect(screen.getByText('Never played? Start here')).not.toBeNull()
    expect(screen.queryByText('Ask the rules official')).toBeNull()
  })

  it('filters to what the search matches', () => {
    sheet()
    fireEvent.change(screen.getByLabelText('Search the rules'), {
      target: { value: 'sixth' },
    })
    expect(screen.getByText('The sixth card')).not.toBeNull()
    expect(screen.queryByText('The object')).toBeNull()
  })

  it('says so rather than showing an empty page', () => {
    sheet()
    fireEvent.change(screen.getByLabelText('Search the rules'), {
      target: { value: 'zebra' },
    })
    expect(screen.getByText(/Nothing in the rulebook matches/)).not.toBeNull()
  })

  it('marks a table ruling as one, so it can be overruled', () => {
    sheet()
    expect(screen.getByText('table ruling')).not.toBeNull()
  })

  it('is one tap from leaving, wherever you have scrolled to', () => {
    const onClose = vi.fn()
    const { container } = sheet({ onClose })
    // Sticky is what makes it reachable from the bottom of a long rulebook.
    expect(container.querySelector('.sheet-top')).not.toBeNull()
    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the ask half', () => {
  it('is not offered at all without the right to use it', () => {
    sheet({ canAsk: false })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText(/Ask the host/)).not.toBeNull()
  })

  it('is one tap away when it is', () => {
    sheet({ canAsk: true, adviser: 'rules consultant' })
    fireEvent.click(screen.getByText('Ask'))
    expect(screen.getByText('Ask the rules consultant')).not.toBeNull()
  })

  it('presents the credential and the table context with the question', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ruling: 'She takes the row.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    sheet({
      canAsk: true,
      authToken: () => 'tok-123',
      askContext: { goal: '66 peppers' },
      askEndpoint: '/api/ruling',
    })
    fireEvent.click(screen.getByText('Ask'))
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'What happens on the sixth card?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/ruling')
    expect(init.headers.Authorization).toBe('tok-123')
    const body = JSON.parse(init.body)
    expect(body.goal).toBe('66 peppers')
    expect(body.messages).toHaveLength(1)

    await waitFor(() => expect(screen.getByText('She takes the row.')).not.toBeNull())
  })

  it('reads the token at asking time, not at mount', async () => {
    // A host's token is refreshed behind the app's back. A component holding
    // the value it had at mount eventually presents a dead one.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ruling: 'ok' }) })
    vi.stubGlobal('fetch', fetchMock)

    let token = 'old'
    sheet({ canAsk: true, authToken: () => token })
    fireEvent.click(screen.getByText('Ask'))
    token = 'fresh'
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'anything' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('fresh')
  })

  it('drops the unanswered question rather than stranding it in the thread', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'The rules official is not configured yet.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    sheet({ canAsk: true })
    fireEvent.click(screen.getByText('Ask'))
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'is that legal' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() =>
      expect(screen.getByText('The rules official is not configured yet.')).not.toBeNull(),
    )
    expect(screen.queryByText('is that legal')).toBeNull()
  })
})
