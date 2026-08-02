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

// ── the extracted chrome ──────────────────────────────────────────────────
// Screens with no game in them, which is why they can live here at all.

import { HostLogin, InviteHost, NoAccess, Pending, UpdateBanner } from './react.js'

/** A PocketBase stand-in that records what was asked of it. */
function fakePb(overrides: Record<string, any> = {}) {
  const calls: { method: string; collection: string; arg?: any }[] = []
  const api = (name: string) => ({
    create: vi.fn(async (arg: any) => {
      calls.push({ method: 'create', collection: name, arg })
      return overrides.create?.(arg) ?? { id: 'x' }
    }),
    requestOTP: vi.fn(async (arg: any) => {
      calls.push({ method: 'requestOTP', collection: name, arg })
      return { otpId: 'otp1' }
    }),
    authWithOTP: vi.fn(async (...arg: any[]) => {
      calls.push({ method: 'authWithOTP', collection: name, arg })
      if (overrides.authFails) throw new Error('nope')
      return {}
    }),
    getFullList: vi.fn(async () => overrides.invites ?? []),
    delete: vi.fn(async (id: string) => {
      calls.push({ method: 'delete', collection: name, arg: id })
    }),
  })
  const memo: Record<string, any> = {}
  return {
    calls,
    pb: { collection: (n: string) => (memo[n] ??= api(n)) },
  }
}

describe('the update banner', () => {
  it('says nothing while the build is current', () => {
    const { container } = render(<UpdateBanner buildId="abc" />)
    expect(container.querySelector('.update-banner')).toBeNull()
  })
})

describe('host sign in', () => {
  it('shows the app its own lockup rather than one of its own', () => {
    render(<HostLogin pb={fakePb().pb} brand={<h1>Play Nine</h1>} onDone={() => {}} />)
    expect(screen.getByText('Play Nine')).toBeTruthy()
  })

  it('creates the account and asks for a code in one step', async () => {
    const { pb, calls } = fakePb()
    render(<HostLogin pb={pb} onDone={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('you@email.com'), {
      target: { value: ' Stacy@Example.com ' },
    })
    fireEvent.click(screen.getByText('Email me a code'))

    // One door for new and returning people: try to create, ignore the failure,
    // then send the code either way.
    await waitFor(() => expect(screen.getByText('Enter your code')).toBeTruthy())
    expect(calls.map((c) => c.method)).toEqual(['create', 'requestOTP'])
    expect(calls[1]!.arg).toBe('Stacy@Example.com')
  })

  it('still sends a code when the account already exists', async () => {
    const { pb, calls } = fakePb({
      create: () => {
        throw new Error('already registered')
      },
    })
    render(<HostLogin pb={pb} onDone={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('you@email.com'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByText('Email me a code'))

    await waitFor(() => expect(screen.getByText('Enter your code')).toBeTruthy())
    expect(calls.some((c) => c.method === 'requestOTP')).toBe(true)
  })

  it('will not submit a code that is not six digits', async () => {
    const { pb } = fakePb()
    render(<HostLogin pb={pb} onDone={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('you@email.com'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByText('Email me a code'))
    await waitFor(() => screen.getByText('Enter your code'))

    const box = screen.getByPlaceholderText('123456') as HTMLInputElement
    // Letters are stripped rather than rejected — a pasted "code: 12ab" should
    // not become an error message.
    fireEvent.change(box, { target: { value: '12ab34' } })
    expect(box.value).toBe('1234')
    expect((screen.getByText('Sign in') as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls back once the code checks out', async () => {
    const onDone = vi.fn()
    const { pb } = fakePb()
    render(<HostLogin pb={pb} onDone={onDone} />)
    fireEvent.change(screen.getByPlaceholderText('you@email.com'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByText('Email me a code'))
    await waitFor(() => screen.getByText('Enter your code'))
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Sign in'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})

describe('the access gates', () => {
  it('names the app somebody has no grant for', () => {
    render(<NoAccess appName="Play Nine" onLogout={() => {}} />)
    expect(screen.getByText(/Play Nine access/)).toBeTruthy()
  })

  it('offers a way out of both gates', () => {
    const out = vi.fn()
    render(<Pending onLogout={out} />)
    fireEvent.click(screen.getByText('Sign out'))
    expect(out).toHaveBeenCalled()
  })
})

describe('inviting a host', () => {
  const props = {
    collection: 'nine_invites',
    appName: 'Play Nine',
    url: 'https://play-nine.example',
  }

  it('stays out of the way until asked', () => {
    render(<InviteHost pb={fakePb().pb} {...props} />)
    expect(screen.queryByText('Invite a host')).toBeNull()
    fireEvent.click(screen.getByText('Invite someone to host'))
    expect(screen.getByText('Invite a host')).toBeTruthy()
  })

  it('opens the share sheet BEFORE awaiting the save', async () => {
    // ⚠️ The iOS rule both apps learned the hard way. Await the create first and
    // the activation window has closed, and the sheet silently never opens.
    const order: string[] = []
    const share = vi.fn(async () => {
      order.push('share')
    })
    stub('share', share)

    let resolveCreate: (v: unknown) => void = () => {}
    const { pb } = fakePb({
      create: () =>
        new Promise((res) => {
          order.push('create-started')
          resolveCreate = res
        }),
    })

    render(<InviteHost pb={pb} {...props} />)
    fireEvent.click(screen.getByText('Invite someone to host'))
    fireEvent.change(screen.getByPlaceholderText('them@email.com'), {
      target: { value: 'Friend@Example.com' },
    })
    fireEvent.click(screen.getByText('Create invite & share'))

    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(order).toEqual(['create-started', 'share'])
    resolveCreate({ id: 'i1' })

    // And the address is normalised, so the grant matches at signup.
    await waitFor(() => expect(screen.getByText('friend@example.com')).toBeTruthy())
  })

  it('falls back to the clipboard where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('clipboard', { writeText })
    render(<InviteHost pb={fakePb().pb} {...props} />)
    fireEvent.click(screen.getByText('Invite someone to host'))
    fireEvent.change(screen.getByPlaceholderText('them@email.com'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByText('Create invite & share'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(props.url))
  })

  it('keeps the invite even when the share is cancelled', async () => {
    stub('share', vi.fn().mockRejectedValue(new Error('AbortError')))
    const { pb, calls } = fakePb()
    render(<InviteHost pb={pb} {...props} />)
    fireEvent.click(screen.getByText('Invite someone to host'))
    fireEvent.change(screen.getByPlaceholderText('them@email.com'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.click(screen.getByText('Create invite & share'))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'create' && c.collection === 'nine_invites')).toBe(
        true,
      ),
    )
  })

  it('lists who is still to sign up, and can cancel one', async () => {
    const { pb, calls } = fakePb({ invites: [{ id: 'i1', email: 'a@b.com', role: 'editor' }] })
    render(<InviteHost pb={pb} {...props} />)
    fireEvent.click(screen.getByText('Invite someone to host'))
    await waitFor(() => expect(screen.getByText('a@b.com')).toBeTruthy())
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(calls.some((c) => c.method === 'delete')).toBe(true))
  })
})
