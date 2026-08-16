import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADVICE_LABEL, askAdviser, normalizeAdvice } from './advice.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A fake endpoint that records what it was sent. */
function endpoint(reply: any, ok = true) {
  const sent: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    sent.push({ body: JSON.parse(init.body), headers: init.headers })
    return { ok, json: async () => reply }
  })
  return sent
}

const advice = {
  bucket: 'sheet',
  headline: 'The rulebook covers this — they just did not find it.',
  because: 'Scoring a matching four is spelled out under Bonuses.',
  rulebook: 'Two columns of the same number pay ten strokes off.',
  draft: '',
}

describe('asking what to do', () => {
  it('sends the question, the answer given, and how often it has come up', async () => {
    const sent = endpoint({ advice })

    await askAdviser({
      endpoint: '/api/triage',
      ruling: {
        question: 'Do two pairs of sevens cancel?',
        answer: 'No — matching cards cancel, but that is also a bonus.',
        context: 'Hole 4 of 9',
        askedBefore: 2,
      },
    })

    expect(sent[0].body.question).toBe('Do two pairs of sevens cancel?')
    expect(sent[0].body.answer).toContain('matching cards cancel')
    expect(sent[0].body.context).toBe('Hole 4 of 9')
    expect(sent[0].body.asked_before).toBe(2)
    // No advice yet and nothing asked: this is the first look.
    expect(sent[0].body.followups).toEqual([])
  })

  /**
   * ⚠️ The token is read at the moment of asking rather than captured when the
   * screen mounted. A host's session is refreshed behind the app's back, and a
   * triage list left open across one is exactly how a stale one gets presented.
   */
  it('reads the credential at the moment of asking', async () => {
    const sent = endpoint({ advice })
    let token = 'first'

    const ask = () =>
      askAdviser({
        endpoint: '/api/triage',
        authToken: () => token,
        ruling: { question: 'q', answer: 'a' },
      })

    await ask()
    token = 'refreshed'
    await ask()

    expect(sent[0].headers.Authorization).toBe('first')
    expect(sent[1].headers.Authorization).toBe('refreshed')
  })

  it('carries the advice and the thread back on a follow-up', async () => {
    const sent = endpoint({ reply: 'Because it is under Bonuses, not Scoring.' })

    const res = await askAdviser({
      endpoint: '/api/triage',
      ruling: { question: 'q', answer: 'a' },
      advice: normalizeAdvice(advice),
      followups: [{ role: 'user', content: 'Why is that not a gap?' }],
    })

    expect(sent[0].body.advice.bucket).toBe('sheet')
    expect(sent[0].body.followups).toHaveLength(1)
    expect(res.reply).toContain('under Bonuses')
    expect(res.advice).toBeUndefined()
  })

  it('surfaces the endpoint’s own message when it refuses', async () => {
    endpoint({ error: 'Only the host can review questions.' }, false)

    await expect(
      askAdviser({ endpoint: '/api/triage', ruling: { question: 'q', answer: 'a' } }),
    ).rejects.toThrow('Only the host can review questions.')
  })
})

describe('an answer off the wire', () => {
  it('keeps a real bucket', () => {
    expect(normalizeAdvice({ bucket: 'rule' }).bucket).toBe('rule')
    expect(normalizeAdvice({ bucket: 'sheet' }).bucket).toBe('sheet')
  })

  /**
   * The one that matters. A malformed bucket must not land on `rule` — that is
   * the button that ends in a new rulebook entry, and nothing should recommend
   * writing one because a field arrived in the wrong shape.
   */
  it('falls back to nothing-to-do rather than to a guess', () => {
    for (const raw of [null, {}, { bucket: 'gap' }, { bucket: 42 }, 'rule']) {
      expect(normalizeAdvice(raw).bucket).toBe('nothing')
    }
  })

  it('defaults every text field so nothing renders undefined', () => {
    const a = normalizeAdvice({ bucket: 'rule' })
    expect(a.headline).toBe('')
    expect(a.because).toBe('')
    expect(a.rulebook).toBe('')
    expect(a.draft).toBe('')
  })

  it('labels each recommendation with the button it points at', () => {
    expect(ADVICE_LABEL.rule).toBe('Needs a rule')
    expect(ADVICE_LABEL.sheet).toBe('Fix the sheet')
    expect(ADVICE_LABEL.nothing).toBe('Nothing to do')
  })
})
