import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFfmpegArgs, joinRtmp, redactArgs } from '../src/engine.js'
import { validateDestination, redactDestination, resolveRtmpUrl, PRESETS } from '../src/destinations.js'
import { DestinationStore } from '../src/store.js'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dest = (over = {}) => ({
  id: 'a',
  label: 'Test',
  platform: 'youtube',
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  streamKey: 'abcd-1234',
  ...over,
})

test('joinRtmp appends the key to a plain URL', () => {
  assert.equal(joinRtmp('rtmp://host/app', 'KEY'), 'rtmp://host/app/KEY')
})

test('joinRtmp inserts the key before query params', () => {
  // Twitch/Facebook style: params must survive after the key.
  assert.equal(
    joinRtmp('rtmp://live.twitch.tv/app?bandwidthtest=true', 'KEY'),
    'rtmp://live.twitch.tv/app/KEY?bandwidthtest=true',
  )
})

test('joinRtmp tolerates a trailing slash', () => {
  assert.equal(joinRtmp('rtmp://host/app/', 'KEY'), 'rtmp://host/app/KEY')
})

test('buildFfmpegArgs listens for a single ingest', () => {
  const args = buildFfmpegArgs({ ingestPort: 1935, destinations: [dest()] })
  assert.ok(args.includes('-listen'))
  assert.equal(args[args.indexOf('-listen') + 1], '1')
  assert.ok(args.includes('rtmp://127.0.0.1:1935/live/studio'))
})

test('buildFfmpegArgs maps once, not once per output', () => {
  // Repeating -map per tee target silently drops destinations; guard it.
  const args = buildFfmpegArgs({
    ingestPort: 1935,
    destinations: [dest({ id: 'a' }), dest({ id: 'b' }), dest({ id: 'c' })],
  })
  assert.equal(args.filter((a) => a === '-map').length, 2, 'expected exactly one -map 0:v and one -map 0:a')
  assert.equal(args.filter((a) => a === '-f').length, 2, 'expected -f flv (input) and -f tee (output)')
})

test('buildFfmpegArgs puts every destination in the tee target list', () => {
  const args = buildFfmpegArgs({
    ingestPort: 1935,
    destinations: [
      dest({ id: 'a', streamKey: 'KEY-A' }),
      dest({ id: 'b', streamKey: 'KEY-B' }),
      dest({ id: 'c', streamKey: 'KEY-C' }),
    ],
  })
  const tee = args[args.length - 1]
  assert.equal(tee.split('|').length, 3)
  assert.ok(tee.includes('KEY-A') && tee.includes('KEY-B') && tee.includes('KEY-C'))
  assert.ok(tee.includes('onfail=ignore'), 'a dead platform must not kill the others')
})

test('buildFfmpegArgs refuses an empty fan-out', () => {
  assert.throws(() => buildFfmpegArgs({ ingestPort: 1935, destinations: [] }), /zero destinations/)
})

test('redactArgs hides keys from logs', () => {
  const args = buildFfmpegArgs({ ingestPort: 1935, destinations: [dest({ streamKey: 'SUPERSECRET' })] })
  const safe = redactArgs(args).join(' ')
  assert.ok(!safe.includes('SUPERSECRET'))
  assert.ok(safe.includes('<redacted>'))
})

test('validateDestination accepts a complete destination', () => {
  assert.deepEqual(validateDestination(dest()), [])
})

test('validateDestination rejects whitespace in a key', () => {
  const problems = validateDestination(dest({ streamKey: 'abc def' }))
  assert.ok(problems.some((p) => /whitespace/.test(p)))
})

test('validateDestination requires a URL when the platform has no default', () => {
  const problems = validateDestination({ platform: 'tiktok', label: 'T', streamKey: 'k' })
  assert.ok(problems.some((p) => /RTMP server URL/.test(p)))
})

test('validateDestination rejects a non-rtmp URL', () => {
  const problems = validateDestination(dest({ rtmpUrl: 'https://example.com' }))
  assert.ok(problems.some((p) => /rtmp:\/\//.test(p)))
})

test('no preset claims to auto-fetch a stream key', () => {
  // This is a product promise, not just a default: we never replay a user's
  // platform session to mint a key they are not entitled to.
  for (const preset of Object.values(PRESETS)) {
    assert.equal(preset.supportsAutoKey, false, `${preset.id} must not advertise auto key fetch`)
  }
})

test('resolveRtmpUrl prefers an explicit URL over the preset default', () => {
  assert.equal(
    resolveRtmpUrl({ platform: 'youtube', rtmpUrl: 'rtmp://custom/app' }),
    'rtmp://custom/app',
  )
  assert.equal(resolveRtmpUrl({ platform: 'youtube' }), PRESETS.youtube.rtmpUrl)
})

test('redactDestination never leaks the key', () => {
  const safe = redactDestination(dest({ streamKey: 'TOPSECRET' }))
  assert.equal(safe.streamKey, undefined)
  assert.equal(safe.hasStreamKey, true)
  assert.ok(!JSON.stringify(safe).includes('TOPSECRET'))
  assert.match(safe.streamKeyFingerprint, /^[0-9a-f]{4}$/)
})

test('store encrypts keys at rest and round-trips them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-store-'))
  try {
    const store = new DestinationStore({ dataDir: dir })
    const created = store.create({
      platform: 'youtube',
      label: 'Chan',
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'PLAINTEXT-KEY',
    })

    // Public view must not contain the key.
    assert.ok(!JSON.stringify(created).includes('PLAINTEXT-KEY'))

    // On disk it must be encrypted.
    const onDisk = JSON.stringify(store.items)
    assert.ok(!onDisk.includes('PLAINTEXT-KEY'), 'key must not be stored in plaintext')

    // And it must still be recoverable for ffmpeg.
    assert.equal(store.getWithSecret(created.id).streamKey, 'PLAINTEXT-KEY')

    // Key file should not be world-readable where POSIX modes apply.
    const mode = statSync(store.keyPath).mode & 0o777
    if (process.platform !== 'win32') assert.equal(mode, 0o600)

    assert.equal(store.remove(created.id), true)
    assert.equal(store.list().length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store update keeps the existing key when none is supplied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-store-'))
  try {
    const store = new DestinationStore({ dataDir: dir })
    const created = store.create({
      platform: 'twitch',
      label: 'Old',
      streamKey: 'KEEP-ME',
    })
    store.update(created.id, { label: 'New' })
    assert.equal(store.getWithSecret(created.id).streamKey, 'KEEP-ME')
    assert.equal(store.get(created.id).label, 'New')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store rejects an invalid destination with a 400', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-store-'))
  try {
    const store = new DestinationStore({ dataDir: dir })
    assert.throws(() => store.create({ platform: 'youtube', label: '', streamKey: '' }), /Destination needs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
