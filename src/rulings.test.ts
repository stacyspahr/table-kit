import { describe, expect, it } from 'vitest'
import {
  askedBefore,
  completeRuling,
  decideRuling,
  dismissRuling,
  looksLikeGap,
  openRulings,
  ordinal,
  pastRulings,
  rulingsCollection,
  sameQuestion,
  splitRulings,
} from './rulings.js'

/** A fake collection that records what it was asked to do. */
function store(rows: any[] = []) {
  const calls: { getFullList: any[]; update: any[] } = { getFullList: [], update: [] }
  const pb = {
    collection: (name: string) => ({
      getFullList: async (opts?: any) => {
        calls.getFullList.push({ name, opts })
        return rows
      },
      update: async (id: string, data: any) => {
        calls.update.push({ name, id, data })
        return { id, ...data }
      },
    }),
  }
  return { pb, calls }
}

describe('where the rulings live', () => {
  it('derives the collection from the guest prefix, not the app slug', () => {
    // The same trap as createGate: flip7's collections are f7_*.
    expect(rulingsCollection('f7_guests')).toBe('f7_rulings')
    expect(rulingsCollection('heat_guests')).toBe('heat_rulings')
    expect(rulingsCollection('nine_guests')).toBe('nine_rulings')
  })
})

describe('spotting a gap in the rulebook', () => {
  it('reads the adviser saying so, in the phrasings the prompt invites', () => {
    expect(looksLikeGap("The rulebook doesn't cover this. I'd play it as…")).toBe(true)
    expect(looksLikeGap('The rulebook does not cover that situation.')).toBe(true)
    expect(looksLikeGap("That isn't covered anywhere in the rules.")).toBe(true)
    expect(looksLikeGap("The rulebook doesn't settle it either way.")).toBe(true)
  })

  it('does not flag an answer that came straight out of the rulebook', () => {
    // The real first question through the system, and the case that matters:
    // this is covered, plainly, and reading it as a gap would add an entry
    // saying what the sheet already says.
    expect(
      looksLikeGap(
        'No — every player plays exactly one card every turn, face down, and you all flip together.',
      ),
    ).toBe(false)
  })
})

describe('the two piles', () => {
  const rulings = [
    { id: 'a', bucket: '' },
    { id: 'b', bucket: 'rule' },
    { id: 'c', bucket: 'sheet' },
    { id: 'd' },
  ]

  it('separates what needs judging from what needs editing', () => {
    const { undecided, todo } = splitRulings(rulings)
    expect(undecided.map((r) => r.id)).toEqual(['a', 'd'])
    expect(todo.map((r) => r.id)).toEqual(['b', 'c'])
  })
})

describe('working through them', () => {
  it('asks only for what is still open, newest first', async () => {
    const { pb, calls } = store()
    await openRulings(pb, 'heat_rulings')
    expect(calls.getFullList[0]).toMatchObject({
      name: 'heat_rulings',
      opts: { filter: 'status = "new"', sort: '-created' },
    })
  })

  it('defaults a row written before a field existed', async () => {
    // Phase A shipped before `bucket` did, so the first rows on the box have no
    // such column. Rendering must not depend on one.
    const { pb } = store([{ id: 'r1', question: 'Can a person pass on the turn?' }])
    const [ruling] = await openRulings(pb, 'heat_rulings')
    expect(ruling).toMatchObject({ bucket: '', status: 'new', thread: [], answer: '' })
  })

  it('leaves a decided ruling OPEN, because deciding is not editing', async () => {
    // The rulebook is a file in a repo. Clearing it at the moment of decision
    // would file the decision and lose the job it created.
    const { pb, calls } = store()
    await decideRuling(pb, 'heat_rulings', 'r1', 'rule')
    expect(calls.update[0].data).toEqual({ bucket: 'rule' })
  })

  it('takes it off the list once the edit is made', async () => {
    const { pb, calls } = store()
    await completeRuling(pb, 'heat_rulings', 'r1')
    expect(calls.update[0].data).toEqual({ status: 'kept' })
  })

  it('clears the verdict when something is dismissed', async () => {
    // Otherwise a ruling triaged as "needs a rule" and then thought better of
    // sits in the archive claiming a rule was written for it.
    const { pb, calls } = store()
    await dismissRuling(pb, 'heat_rulings', 'r1')
    expect(calls.update[0].data).toEqual({ status: 'dismissed', bucket: '' })
  })
})

describe('has this come up before', () => {
  it('matches the same question asked in different words', () => {
    expect(
      sameQuestion('Can a person pass on the turn?', 'can you pass a turn if you want to'),
    ).toBe(true)
    expect(sameQuestion('Do I take the whole row?', 'does she take the whole row')).toBe(true)
  })

  it('sees through plurals, because a table types both', () => {
    expect(sameQuestion('how many peppers is that card', 'how many pepper on the cards')).toBe(true)
  })

  it('refuses two questions that merely share a word', () => {
    // ⚠️ Biased hard towards no. A wrong "asked before" writes a rulebook entry
    // for an argument that never happened twice; a missed one just leaves you
    // where you already were.
    expect(sameQuestion('Can a person pass on the turn?', 'can I pass the deal to her')).toBe(false)
    expect(sameQuestion('What ends the game?', 'What is a pepper worth?')).toBe(false)
  })

  it('counts the settled ones, which is the whole point', () => {
    // Dismissing the first time somebody asks is CORRECT under the triggers —
    // and it is also what makes the second one invisible without this.
    const past = [
      { question: 'can you pass a turn' },
      { question: 'what happens when the deck runs out' },
    ]
    expect(askedBefore('Can a person pass on the turn?', past)).toBe(1)
    expect(askedBefore('Who deals first?', past)).toBe(0)
  })

  it('asks the archive for everything already settled', async () => {
    const { pb, calls } = store()
    await pastRulings(pb, 'heat_rulings')
    expect(calls.getFullList[0]).toMatchObject({
      name: 'heat_rulings',
      opts: { filter: 'status != "new"', sort: '-created' },
    })
  })

  it('says which time it is', () => {
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(21)).toBe('21st')
  })
})
