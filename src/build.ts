/**
 * Build-time half of version tracking. Runs in Node, never in a browser.
 *
 * Imported from `table-kit/build` so a browser bundle never pulls `node:fs` in.
 *
 * Each app calls this from a prebuild script. The file it writes is the single
 * source of truth for what is actually DEPLOYED — as opposed to what happens to
 * be committed — which is the distinction the suite dashboard depends on.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The table-kit version this app is building against, read from the installed package. */
export function kitVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface WriteVersionOptions {
  /** Where to write it. Usually the app's `public/` so it lands at the site root. */
  dir: string
  /** App slug — same value as the kit's `appKey`. */
  app: string
  /** Short git sha, if the build has one to hand. */
  commit?: string
  /**
   * Overrides the generated build id. Leave unset in normal use — a fresh id
   * per build is exactly what update detection needs.
   */
  buildId?: string
  /** Overridable for deterministic tests. */
  now?: () => Date
}

export function writeVersionFile(opts: WriteVersionOptions): {
  app: string
  kit: string
  buildId: string
  built: string
  commit?: string
} {
  const now = opts.now ? opts.now() : new Date()
  const info = {
    app: opts.app,
    kit: kitVersion(),
    // Time-based rather than content-hashed: two deploys of identical source
    // are still two deploys, and a rebuild is the signal we want to surface.
    buildId: opts.buildId ?? String(now.getTime()),
    built: now.toISOString(),
    ...(opts.commit ? { commit: opts.commit } : {}),
  }

  mkdirSync(opts.dir, { recursive: true })
  writeFileSync(join(opts.dir, 'version.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8')
  return info
}
