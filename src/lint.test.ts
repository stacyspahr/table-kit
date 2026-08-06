/**
 * The class-coverage check.
 *
 * Every case here is a shape that actually appears in one of the four scorers,
 * because the failure mode this guards against is subtle and a check that cries
 * wolf gets switched off. The two that matter most are the two that must NOT
 * report anything: a bare identifier in a ternary, and the interpolated half of
 * a template literal.
 */

import { describe, expect, it } from 'vitest'
import { classCoverage, classesInSource, classesInStylesheet } from './lint.js'

const used = (code: string) => [...classesInSource(code)].sort()

describe('classesInSource', () => {
  it('reads a plain string attribute', () => {
    expect(used('<div className="screen center" />')).toEqual(['center', 'screen'])
  })

  it('reads both arms of a ternary', () => {
    expect(used(`<span className={isMe ? 'row mine' : 'row'} />`)).toEqual(['mine', 'row'])
  })

  it('does NOT read the identifier the ternary tests', () => {
    // The whole point. Demanding a `.busy` rule for a variable is nonsense the
    // first time somebody hits it and noise every time after.
    expect(used(`<button className={busy ? 'saving' : 'idle'} />`)).toEqual(['idle', 'saving'])
  })

  it('reads the static half of a template literal and drops the rest', () => {
    // `pill lobby` / `pill active` / `pill finished` — only `pill` is knowable
    // without running the app, and guessing the rest would fail honest code.
    expect(used('<span className={`pill ${g.status}`} />')).toEqual(['pill'])
  })

  it('survives the braces inside a template literal', () => {
    // A non-greedy \{([^}]*)\} stops at the FIRST closing brace and loses the
    // rest of the attribute — this is the case that breaks a regex.
    expect(used('<span className={`row ${a ? "mine" : "theirs"} big`} />')).toEqual([
      'big',
      'mine',
      'row',
      'theirs',
    ])
  })

  it('does NOT read a function argument inside an interpolation', () => {
    // ⚠️ Flip 7's card picker, verbatim. This shape produced seven false
    // positives in the first run of this check across the suite. `'on'` is a
    // class; `'zero'` is an argument that happens to sit inside the `${}`, and
    // demanding a `.zero` rule is how a check gets deleted rather than fixed.
    expect(used("<button className={`key wide ${isOn(0, 'zero') ? 'on' : ''}`} />")).toEqual([
      'key',
      'on',
      'wide',
    ])
  })

  it('still reads arguments OUTSIDE a template, where they usually are classes', () => {
    // `cx('a', 'b')` is the common helper shape, and there the arguments are
    // exactly what we are looking for.
    expect(used(`<div className={cx('one', 'two')} />`)).toEqual(['one', 'two'])
  })

  it('reads several attributes in one file', () => {
    expect(used('<a className="one" /><b className="two" />')).toEqual(['one', 'two'])
  })

  it('ignores things that are not class-shaped', () => {
    // Handlers, urls and sentences all live near classNames in real files.
    expect(used(`<div className={cx(styles.Thing, "real-class")} />`)).toEqual(['real-class'])
  })

  it('finds nothing in a file with no classes', () => {
    expect(used('export const x = 1')).toEqual([])
  })
})

describe('classesInStylesheet', () => {
  it('reads a plain rule', () => {
    expect([...classesInStylesheet('.screen { color: red }')]).toContain('screen')
  })

  it('reads both halves of a compound selector', () => {
    const found = classesInStylesheet('.row.mine { font-weight: 700 }')
    expect(found.has('row')).toBe(true)
    expect(found.has('mine')).toBe(true)
  })

  it('reads a class named only inside a pseudo-class', () => {
    // `.board-list .row:not(.tappable)::after` is how the chevron gutter is
    // reserved — `tappable` is styled, even though no rule is "for" it.
    expect(classesInStylesheet('.list .row:not(.tappable)::after { content: "›" }').has('tappable'))
      .toBe(true)
  })

  it('ignores classes named in comments', () => {
    // ⚠️ styles.css is heavily commented and its prose says things like
    // ".row wraps rather than squeezing". Counting that as a definition would
    // hide a genuinely missing rule behind a sentence describing it.
    expect(classesInStylesheet('/* .row wraps rather than squeezing */').has('row')).toBe(false)
  })

  it('ignores custom properties', () => {
    expect(classesInStylesheet(':root { --tk-row-gap: 8px }').has('tk-row-gap')).toBe(false)
  })
})

describe('the two sets together', () => {
  it('reports a class the stylesheet never defines', () => {
    // The Oh Hell failure, reduced: the picker was three bare buttons.
    const src = classesInSource(`<button className="seg-btn on" />`)
    const css = classesInStylesheet('.btn { padding: 8px }')
    expect([...src].filter((c) => !css.has(c)).sort()).toEqual(['on', 'seg-btn'])
  })

  it('reports nothing when every class is styled', () => {
    const src = classesInSource(`<div className="screen"><span className="row mine" /></div>`)
    const css = classesInStylesheet('.screen{}.row{}.row.mine{}')
    expect([...src].filter((c) => !css.has(c))).toEqual([])
  })
})

describe('a condition is not a class', () => {
  it('ignores what a ternary compares against', () => {
    // ⚠️ Flip 7's mode picker, verbatim. `'on'` is the class; `'standard'` is
    // the value the condition tests. Same distinction as the interpolation
    // case, one level out.
    expect([...classesInSource(`<button className={mode === 'standard' ? 'on' : ''} />`)]).toEqual([
      'on',
    ])
  })

  it('falls back to every literal when there is no ternary at all', () => {
    expect([...classesInSource(`<div className={cx('one', 'two')} />`)].sort()).toEqual([
      'one',
      'two',
    ])
  })
})

describe('compiled components', () => {
  it('reads a className from compiled JSX, not just source', () => {
    // ⚠️ What `jsx()` output looks like. The kit's own components are only
    // available to an app in this form, and they render classes the kit does
    // NOT style — `.seg`, `.pill.source` — which are exactly the ones an app
    // forgets. Scanning source alone missed both.
    expect([...classesInSource('jsx("span", { className: "pill source" })')].sort()).toEqual([
      'pill',
      'source',
    ])
  })
})

describe('comments are not code', () => {
  it('ignores a className inside a block comment', () => {
    // ⚠️ Found for real: pointed at the kit's compiled output, this file's own
    // JSDoc examples came back as undefined classes.
    expect([...classesInSource('/** e.g. className="ghost-class" */')]).toEqual([])
  })

  it('ignores a className inside a line comment', () => {
    expect([...classesInSource('// className="ghost-class"')]).toEqual([])
  })

  it('does not mistake a url for a comment', () => {
    expect([...classesInSource(`<a href="https://x.test" className="real" />`)]).toEqual(['real'])
  })
})

describe('the kit owns its own namespace', () => {
  it('ignores tk- classes by default', () => {
    // ⚠️ `tk-note`, `tk-take-seat` and `tk-handovers` are modifiers on an
    // already styled base — `card tk-note`, `list tk-handovers` — rendered so
    // an app CAN target them, not because it must. All four apps reported all
    // three, and all four were fine.
    const r = classCoverage({ sources: [], stylesheets: [] })
    expect(r.undefined).toEqual([])
  })

  it('still reports a class the app itself owns', () => {
    // The line that matters: unnamespaced classes are the app's problem, and
    // those are the ones that actually shipped broken.
    const src = classesInSource('<div className="tk-note seg-btn" />')
    const defined = new Set<string>()
    const missing = [...src]
      .filter((c) => !defined.has(c))
      .filter((c) => !c.startsWith('tk-'))
    expect(missing).toEqual(['seg-btn'])
  })
})
