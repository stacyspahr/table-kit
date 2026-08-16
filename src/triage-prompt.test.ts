import { describe, expect, it } from 'vitest'
import {
  ADVICE_SCHEMA,
  adviceAsSpoken,
  triageBrief,
  triageSystemPrompt,
} from './triage-prompt.js'

const base = { game: 'Play Nine', rulebook: 'Lowest score wins.' }

describe('the prompt', () => {
  it('carries the game and its whole rulebook', () => {
    const p = triageSystemPrompt(base)
    expect(p).toContain('a game of Play Nine')
    expect(p).toContain('<rulebook>\nLowest score wins.\n</rulebook>')
  })

  it('names all three buckets by the exact word the schema accepts', () => {
    const p = triageSystemPrompt(base)
    for (const bucket of ADVICE_SCHEMA.properties.bucket.enum) {
      expect(p).toContain(`"${bucket}"`)
    }
  })

  /**
   * ⚠️ The reason this feature exists. An unprompted model reaches for "write a
   * new rule" and the covered-but-not-found case is the one it misses, so the
   * prompt has to say outright which one to check first.
   */
  it('says to check for already-covered first', () => {
    expect(triageSystemPrompt(base)).toContain('check for it first')
  })

  it('leaves out the game-specific blocks when a game has none', () => {
    const p = triageSystemPrompt(base)
    expect(p).not.toContain('undefined')
    expect(p).not.toMatch(/\n\n\n\n/)
  })

  it('includes them when it has', () => {
    const p = triageSystemPrompt({ ...base, hotspots: 'Aces do not cancel.', note: 'No publisher.' })
    expect(p).toContain('Aces do not cancel.')
    expect(p).toContain('No publisher.')
  })

  /** Byte-identical between requests, or the cached rulebook is paid for twice. */
  it('is the same string every time it is built the same way', () => {
    expect(triageSystemPrompt(base)).toBe(triageSystemPrompt(base))
  })
})

describe('the question, on its own turn', () => {
  const subject = {
    question: 'Do two aces cancel?',
    answer: 'No — they score minus five each.',
    context: 'Hole 4 of 9',
    askedBefore: 0,
  }

  it('leads with the question and follows with what the official said', () => {
    const brief = triageBrief(subject)
    expect(brief).toContain('Do two aces cancel?')
    expect(brief).toContain('No — they score minus five each.')
    expect(brief).toContain('They were at: Hole 4 of 9')
  })

  /**
   * ⚠️ Stated even when the answer is "never". The per-bucket triggers turn on
   * this number, and left unsaid a first ask and a fourth look identical.
   */
  it('always says how often it has come up', () => {
    expect(triageBrief(subject)).toContain('Nothing like this has come up before')
    expect(triageBrief({ ...subject, askedBefore: 2 })).toContain('2 time(s) before')
  })

  it('leaves out a context or an answer it does not have', () => {
    const brief = triageBrief({ question: 'q', answer: '', context: '', askedBefore: 0 })
    expect(brief).not.toContain('They were at')
    expect(brief).not.toContain('The official answered')
  })
})

describe('advice read back to it', () => {
  it('reads as what was on the screen, not as the JSON it emitted', () => {
    const spoken = adviceAsSpoken({
      bucket: 'sheet',
      headline: 'Already covered.',
      because: 'It is under Bonuses.',
      rulebook: 'Two columns pay ten off.',
      draft: '',
    })
    expect(spoken).toContain('Already covered.')
    expect(spoken).toContain('The rulebook already says: Two columns pay ten off.')
    expect(spoken).not.toContain('Suggested wording')
    expect(spoken).not.toContain('bucket')
  })

  it('says so rather than going back empty', () => {
    expect(adviceAsSpoken(null)).toBe('No recommendation was recorded.')
  })
})
