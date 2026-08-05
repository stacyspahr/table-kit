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
  const attr = /className\s*=\s*/g
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
 * Every string literal inside an expression, including the STATIC halves of a
 * template literal.
 *
 * The interpolated halves are dropped on purpose — see the note at the top.
 */
function stringLiterals(expr: string): string[] {
  const out: string[] = []

  for (const m of expr.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    out.push(m[1] ?? m[2] ?? '')
  }

  for (const m of expr.matchAll(/`([^`]*)`/g)) {
    // Everything outside `${ … }` is literal text.
    out.push((m[1] ?? '').replace(/\$\{[^}]*\}/g, ' '))
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
    else if (extname(full) === '.tsx' || extname(full) === '.jsx') out.push(full)
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
