import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { safeLabel, recordingPath, listRecordings, ensureDir, RECORDING_EXT } from '../src/recordings.js'
import { buildFfmpegArgs } from '../src/engine.js'

/**
 * Recording is an extra tee branch, so the interesting risks are path safety
 * (the label comes from the browser) and whether the branch is actually wired
 * into the argv.
 */

test('safeLabel strips anything that could change the path', () => {
  assert.equal(safeLabel('../../etc/passwd'), 'etc-passwd')
  assert.equal(safeLabel('a/b\\c'), 'a-b-c')
  assert.equal(safeLabel('My Channel!'), 'My-Channel')
  assert.equal(safeLabel(''), 'stream')
  assert.equal(safeLabel('...'), 'stream')
})

test('safeLabel cannot produce a leading dot or separator', () => {
  for (const label of ['../x', '.hidden', '/abs', 'C:\\win']) {
    const safe = safeLabel(label)
    assert.ok(!safe.startsWith('.'), `${label} -> ${safe} must not start with a dot`)
    assert.ok(!safe.includes('/') && !safe.includes('\\'), `${label} -> ${safe} must not contain separators`)
  }
})

test('safeLabel caps length so a long label cannot break the file name', () => {
  assert.ok(safeLabel('x'.repeat(500)).length <= 60)
})

test('recordingPath always stays inside the recordings directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    for (const label of ['../../evil', 'ok', '..']) {
      const p = recordingPath({ dir, label })
      assert.ok(
        resolve(p).startsWith(resolve(dir)),
        `${label} escaped the directory: ${p}`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recordingPath produces a distinct name per stream', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    const a = recordingPath({ dir, label: 'Chan', at: new Date('2026-01-01T00:00:00Z') })
    const b = recordingPath({ dir, label: 'Chan', at: new Date('2026-01-01T00:00:01Z') })
    assert.notEqual(a, b)
    assert.ok(a.endsWith(RECORDING_EXT))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listRecordings returns only recordings, newest first', () => {
  const dir = ensureDir(mkdtempSync(join(tmpdir(), 'rec-')))
  try {
    writeFileSync(join(dir, '2026-01-01_00-00-00-old.ts'), 'x')
    writeFileSync(join(dir, '2026-01-02_00-00-00-new.ts'), 'yy')
    writeFileSync(join(dir, 'notes.txt'), 'ignore me')

    const found = listRecordings(dir)
    assert.equal(found.length, 2)
    assert.equal(found[0].name, '2026-01-02_00-00-00-new.ts')
    assert.equal(found[0].bytes, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listRecordings on a missing directory is empty, not an error', () => {
  assert.deepEqual(listRecordings(join(tmpdir(), 'definitely-not-here-xyz')), [])
})

/**
 * The tee muxer's target list: `-f tee <targets>`. Find the *last* `-f tee`
 * pair, since the input also uses `-f flv`.
 */
const teeOf = (args) => {
  const i = args.lastIndexOf('tee')
  return args[i + 1]
}

test('the fan-out argv gains a recording target when asked', () => {
  const base = {
    ingestPort: 1935,
    destinations: [{ id: 'a', label: 'A', rtmpUrl: 'rtmp://x/live', streamKey: 'k' }],
  }

  const without = buildFfmpegArgs(base)
  const withRec = buildFfmpegArgs({ ...base, recordPath: '/tmp/out.ts' })

  assert.ok(!teeOf(without).includes('out.ts'))
  assert.ok(teeOf(withRec).includes('/tmp/out.ts'))
  // The destination must still be present; recording adds a branch, not replaces one.
  assert.ok(teeOf(withRec).includes('rtmp://x/live/k'))
})

test('recording is the last tee branch so platforms are established first', () => {
  const args = buildFfmpegArgs({
    ingestPort: 1935,
    destinations: [{ id: 'a', label: 'A', rtmpUrl: 'rtmp://x/live', streamKey: 'k' }],
    recordPath: '/tmp/out.ts',
  })
  const branches = teeOf(args).split('|')
  assert.ok(branches[branches.length - 1].includes('/tmp/out.ts'))
})

test('recording uses a crash-tolerant container, not mp4/matroska', () => {
  const args = buildFfmpegArgs({
    ingestPort: 1935,
    destinations: [{ id: 'a', label: 'A', rtmpUrl: 'rtmp://x/live', streamKey: 'k' }],
    recordPath: '/tmp/out.ts',
  })
  const tee = teeOf(args)
  assert.ok(tee.includes('f=mpegts'))
  assert.ok(!tee.includes('f=mp4'))
  assert.ok(!tee.includes('f=matroska'))
})
