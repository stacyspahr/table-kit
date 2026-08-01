import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QrPanel } from './react.js'

const TOKEN = 'a'.repeat(32)

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
})

function stub(name: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true })
}

describe('the join QR', () => {
  it('puts an actual code on the screen', async () => {
    const { container } = render(<QrPanel token={TOKEN} gameName="Beat the Heat" onClose={() => {}} />)

    // Rendered from the generated SVG, so this failing means the code never
    // got made — not merely that it looks wrong.
    await waitFor(() => expect(container.querySelector('.qr-code svg')).not.toBeNull())
  })

  it('carries the token the scanner is supposed to read', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stub('share', share)

    render(<QrPanel token={TOKEN} gameName="Flip 7" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Send the link instead'))

    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0]![0].url).toContain(TOKEN)
  })

  it('names the game it is inviting people to', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stub('share', share)

    render(<QrPanel token={TOKEN} gameName="Beat the Heat" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Send the link instead'))

    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0]![0].title).toBe('Join the Beat the Heat game')
  })

  it('falls back to the clipboard on a phone with no share sheet, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('clipboard', { writeText })

    render(<QrPanel token={TOKEN} gameName="Flip 7" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Send the link instead'))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]![0]).toContain(TOKEN)
    // The label is the only confirmation there is — nothing else on screen
    // changes when a link goes to the clipboard.
    await screen.findByText('Link copied')
  })

  it('says nothing at all when the share sheet is dismissed', async () => {
    stub('share', vi.fn().mockRejectedValue(new Error('AbortError')))

    render(<QrPanel token={TOKEN} gameName="Flip 7" onClose={() => {}} />)
    fireEvent.click(screen.getByText('Send the link instead'))

    await waitFor(() => expect(screen.queryByText('Link copied')).toBeNull())
    expect(screen.getByText('Send the link instead')).toBeTruthy()
  })

  it('closes when Done is pressed', () => {
    const onClose = vi.fn()
    render(<QrPanel token={TOKEN} gameName="Flip 7" onClose={onClose} />)

    fireEvent.click(screen.getByText('Done'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
