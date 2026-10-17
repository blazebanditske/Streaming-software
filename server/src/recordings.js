/**
 * Recording paths for the fan-out's extra tee target.
 *
 * A recording is not a separate feature bolted onto streaming — it is one more
 * branch of the same tee. See `buildFfmpegArgs`. The only real work here is
 * picking a path that cannot escape the recordings directory, because the
 * stream label reaches this function from the browser.
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * MPEG-TS: the only container tested that stays playable after a hard kill.
 * See the note in `buildFfmpegArgs` for the measurements.
 */
export const RECORDING_EXT = '.ts'

/**
 * Reduce a user-supplied label to something safe to use as a file name.
 *
 * Everything outside a conservative allowlist is replaced rather than escaped:
 * a name that survives this function is one we can reason about, and a stream
 * label is cosmetic anyway.
 *
 * @param {string} label
 * @returns {string}
 */
export function safeLabel(label) {
  const cleaned = String(label || '')
    .replace(/[^a-zA-Z0-9 ._-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60)
  return cleaned || 'stream'
}

/** UTC timestamp that sorts lexicographically and has no separators. */
function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

/**
 * @param {{ dir: string, label?: string, at?: Date }} opts
 * @returns {string} absolute path inside `dir`
 */
export function recordingPath({ dir, label, at }) {
  const base = resolve(dir)
  const name = `${stamp(at)}-${safeLabel(label)}${RECORDING_EXT}`
  const full = join(base, name)

  // The allowlist above already makes traversal impossible, but the fan-out
  // writes wherever this returns, so assert containment rather than trust it.
  if (full !== resolve(base, name) || !full.startsWith(base + sep)) {
    throw new Error('Refusing to record outside the recordings directory.')
  }
  return full
}

/**
 * @param {string} dir
 * @returns {{ name: string, path: string, bytes: number, at: string }[]}
 */
export function listRecordings(dir) {
  const base = resolve(dir)
  let names
  try {
    names = readdirSync(base)
  } catch {
    // Nothing recorded yet, or the directory was removed under us.
    return []
  }

  return names
    .filter((n) => n.endsWith(RECORDING_EXT))
    .map((name) => {
      const info = statSync(join(base, name))
      return { name, path: join(base, name), bytes: info.size, at: info.mtime.toISOString() }
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}
