/**
 * Does this app style every class it uses?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Oh Hell shipped a game-length picker nobody could see. `.seg` and `.seg-btn`
 * are deliberately NOT in the kit — design-system decision C left them per-app,
 * because Beat the Heat builds a flex column and Flip 7 builds a grid, and
 * giving two constructions one name is the `.topbar` mistake. So the kit offers
 * those names to nobody, the app used them anyway, and three preset buttons
 * rendered as bare `<button>` elements.
 *
 * ⚠️ **Nothing caught it, and nothing could have.** A class used and never
 * defined passes the typecheck, passes the build, passes every unit test, and
 * its only symptom is a control nobody can see. Nine more were in the same
 * state in that app — `.error` as body text, `.play-head` with no layout,
 * `.board-list` not reserving the chevron width so the totals column drifted
 * out of line. Every one of them was invisible to CI and visible to a person
 * within about four seconds of looking at the screen.
 *
 * Every app in the suite has this exposure every time somebody adds a screen,
 * which is what makes it the kit's problem rather than one app's.
 *
 * ── What it can and cannot see ───────────────────────────────────────────
 * Only STATIC class names, and deliberately so. `className={`pill ${status}`}`
 * yields `pill` and nothing else: the interpolated half is unknowable without
 * running the app, and guessing at it would produce false failures that teach
 * people to ignore this check. A composed class is the one case you still have
 * to look at with your eyes.
 *
 * Node-only — it reads files. Import from `table-kit/lint`, which no browser
 * bundle pulls in.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

/** Something that looks like a CSS class rather than a variable or a constant. */
const CLASS_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Every class name written literally in one file of source.
 *
 * ⚠️ Reads only STRING LITERALS inside a `className`, never bare identifiers.
 * `className={busy ? 'saving' : 'idle'}` must yield `saving` and `idle` and
 * NOT `busy` — treating an identifier as a class name would demand a
 * `.busy` rule for a variable, which is nonsense the first time somebody hits
 * it and noise every time after.
 */
export function classesInSource(code: string): Set<string> {
  const out = new Set<string>()

  for (const expr of classNameExpressions(code)) {
    for (const literal of stringLiterals(expr)) {
      for (const token of literal.split(/\s+/)) {
        if (CLASS_TOKEN.test(token)) out.add(token)
      }
    }
  }

  return out
}

/**
 * The text of every `className=…` in the file — the quoted string, or the
 * whole braced expression with its nesting balanced.
 *
 * Brace matching rather than a regex because a template literal carries its
 * own braces: `` className={`row ${a ? 'x' : 'y'}`} `` has three levels, and a
 * non-greedy `\{([^}]*)\}` stops at the first `}` and loses the rest.
 */
function classNameExpressions(code: string): string[] {
  const out: string[] = []
  /**
   * ⚠️ `=` OR `:`. Source says `className="row"`; COMPILED output says
   * `className: "row"` inside a `jsx(...)` call, and the compiled form is the
   * only one available for the kit's own components once an app has installed
   * them.
   *
   * That matters because the kit renders classes it does not style and leaves
   * them to the app — `.seg`, `.pill.source` — and those are precisely the
   * ones an app forgets. Scanning only the app's own components missed both.
   * A rulebook entry shipped reading "Say it out loud, then tap ittable
   * convention" for exactly this reason.
   */
  const attr = /className\s*[=:]\s*/g
  let m: RegExpExecArray | null

  while ((m = attr.exec(code))) {
    const start = m.index + m[0].length
    const opener = code[start]

    if (opener === '"' || opener === "'") {
      const end = code.indexOf(opener, start + 1)
      // ⚠️ `end + 1` — the CLOSING quote has to come along. Everything here is
      // handed to `stringLiterals`, which matches quoted pairs, so a slice that
      // kept only the opening quote parsed as no literal at all and the
      // commonest form of className in the codebase read as empty. Caught by
      // the first three tests, which is the whole reason they exist.
      if (end > start) out.push(code.slice(start, end + 1))
      continue
    }

    if (opener !== '{') continue

    let depth = 0
    for (let i = start; i < code.length; i++) {
      const ch = code[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          out.push(code.slice(start + 1, i))
          break
        }
      }
    }
  }

  return out
}

/**
 * Every string literal inside an expression that is plausibly a class name.
 *
 * ⚠️ **A quoted string inside `${ … }` is not automatically a class**, and
 * assuming it is produced seven false positives on Flip 7 in the first run of
 * this check. Its card picker writes:
 *
 * ```tsx
 * className={`key wide ${isOn(0, 'zero') ? 'on' : ''}`}
 * ```
 *
 * `'on'` is a class. `'zero'` is an argument to a function that happens to sit
 * inside the interpolation. Demanding a `.zero` rule is the kind of wrong that
 * gets a check deleted rather than fixed, so the rule is:
 *
 * - outside a template literal, every quoted string counts — that covers
 *   `{isMe ? 'row mine' : 'row'}` and `{cx(x, 'real-class')}` alike;
 * - inside `${ … }`, only strings in a TERNARY BRANCH count, i.e. ones
 *   directly after a `?` or a `:`. An argument sits after `(` or `,` and is
 *   left alone.
 *
 * The residual error is a false NEGATIVE — a class built some way this cannot
 * read goes unchecked. That is the right direction to be wrong in: a check
 * that misses one thing still catches the other ten, and a check that cries
 * wolf catches nothing because it gets switched off.
 */
function stringLiterals(expr: string): string[] {
  const out: string[] = []

  // Blank out template literals as they are consumed, so the sweep afterwards
  // sees only what was never inside one. Index-based rather than `replace`,
  // which would mishandle two identical templates in one expression.
  const chars = [...expr]

  for (const m of expr.matchAll(/`([^`]*)`/g)) {
    const body = m[1] ?? ''

    // Everything outside `${ … }` is literal class text.
    out.push(body.replace(/\$\{[^}]*\}/g, ' '))

    // Inside it, only the branches of a ternary.
    for (const interp of body.matchAll(/\$\{([^}]*)\}/g)) {
      for (const branch of (interp[1] ?? '').matchAll(/[?:]\s*(?:'([^']*)'|"([^"]*)")/g)) {
        out.push(branch[1] ?? branch[2] ?? '')
      }
    }

    for (let i = m.index; i < m.index + m[0].length; i++) chars[i] = ' '
  }

  const outsideTemplates = chars.join('')

  /**
   * ⚠️ The same distinction one level out. Flip 7's mode picker writes
   * `className={mode === 'standard' ? 'on' : ''}` — `'on'` is the class and
   * `'standard'` is what the condition compares against.
   *
   * So: if this expression has ternary branches, they ARE the classes and
   * everything else in it is machinery. If it has none, it is something like
   * `cx('one', 'two')` and every literal is a candidate.
   *
   * Detected by trying rather than by looking for a `?`, which would misread
   * optional chaining and `??`.
   */
  const branches = [...outsideTemplates.matchAll(/[?:]\s*(?:'([^']*)'|"([^"]*)")/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  )

  if (branches.length) {
    out.push(...branches)
  } else {
    for (const m of outsideTemplates.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      out.push(m[1] ?? m[2] ?? '')
    }
  }

  return out
}

/**
 * Every class a stylesheet defines.
 *
 * `.row.mine` contributes both, and so does `:not(.tappable)` — this is asking
 * "is there any rule mentioning this class", not "is there a rule for exactly
 * this selector". The looser question is the right one: a class styled only in
 * combination is still styled, and demanding a standalone rule would fail on
 * every modifier in the file.
 *
 * ⚠️ Comments are stripped first. `styles.css` is heavily commented and its
 * prose says things like ".row wraps rather than squeezing", which would
 * otherwise register as a definition and hide a genuinely missing rule.
 */
export function classesInStylesheet(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const out = new Set<string>()

  for (const m of withoutComments.matchAll(/\.(-?[a-z][a-z0-9-]*)/gi)) {
    const name = m[1]
    if (name && CLASS_TOKEN.test(name)) out.add(name)
  }

  return out
}

/** Every `.tsx`/`.jsx` file under a directory, or the file itself. */
function sourceFiles(path: string): string[] {
  const stat = statSync(path)
  if (!stat.isDirectory()) return [path]

  const out: string[] = []
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(path, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    // `.js` so an app can point this at the kit's COMPILED components, which
    // is the only way to see the classes the kit renders and the app styles.
    else if (['.tsx', '.jsx', '.js'].includes(extname(full))) out.push(full)
  }
  return out
}

export interface ClassCoverage {
  /** Used in a component, defined by no stylesheet. The failures. */
  undefined: string[]
  /** How many distinct classes were found in the source. Context for a report. */
  used: number
}

/**
 * The check an app's test calls.
 *
 * ```ts
 * expect(classCoverage({
 *   sources: ['src'],
 *   stylesheets: ['node_modules/table-kit/styles.css', 'src/index.css'],
 * }).undefined).toEqual([])
 * ```
 *
 * ⚠️ Point `stylesheets` at the INSTALLED kit stylesheet rather than a copy.
 * The whole failure this prevents is an app assuming the kit provides something
 * it does not, and a stale copy would assume it right back.
 */
export function classCoverage(opts: {
  sources: string[]
  stylesheets: string[]
  /**
   * Classes to accept without a rule — ones applied by something outside the
   * stylesheets, or composed at runtime.
   *
   * Keep this list short and say why in a comment beside each entry. Every
   * entry is a place this check has been told to stop looking.
   */
  allow?: string[]
}): ClassCoverage {
  const used = new Set<string>()
  for (const src of opts.sources) {
    for (const file of sourceFiles(src)) {
      for (const c of classesInSource(readFileSync(file, 'utf8'))) used.add(c)
    }
  }

  const defined = new Set<string>()
  for (const sheet of opts.stylesheets) {
    for (const c of classesInStylesheet(readFileSync(sheet, 'utf8'))) defined.add(c)
  }

  for (const c of opts.allow ?? []) defined.add(c)

  return {
    undefined: [...used].filter((c) => !defined.has(c)).sort(),
    used: used.size,
  }
}
