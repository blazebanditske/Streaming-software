import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCaptureArgs } from '../src/engine.js'
import { parseDshow, parseAvfoundation, listDevices } from '../src/devices.js'

/**
 * Capture argv is where a working camera turns into a confusing failure. Each
 * platform has its own input format, and getting it wrong produces an ffmpeg
 * error that does not mention the device name.
 */

test('linux capture uses v4l2 for video and alsa for audio', () => {
  const args = buildCaptureArgs({
    platform: 'linux',
    ingestPort: 1935,
    videoDevice: '/dev/video0',
    audioDevice: 'default',
  })

  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2), ['-f', 'v4l2'])
  assert.ok(args.includes('/dev/video0'))
  assert.ok(args.includes('alsa'))
  assert.ok(args.includes('default'))
})

test('linux capture publishes to the local ingest, never a platform', () => {
  const args = buildCaptureArgs({ platform: 'linux', ingestPort: 1935, videoDevice: '/dev/video0' })
  const url = args[args.length - 1]

  assert.equal(url, 'rtmp://127.0.0.1:1935/live/studio')
})

test('linux capture requires a video device', () => {
  assert.throws(
    () => buildCaptureArgs({ platform: 'linux', ingestPort: 1935, videoDevice: '' }),
    /video device is required/i,
  )
})

test('windows capture uses dshow and joins video and audio into one input', () => {
  const args = buildCaptureArgs({
    platform: 'win32',
    ingestPort: 1935,
    videoDevice: 'HD Webcam',
    audioDevice: 'Microphone (USB)',
  })

  assert.ok(args.includes('dshow'))
  const input = args[args.indexOf('-i') + 1]
  assert.equal(input, 'video=HD Webcam:audio=Microphone (USB)')
})

test('windows capture omits the audio half when no microphone is chosen', () => {
  const args = buildCaptureArgs({ platform: 'win32', ingestPort: 1935, videoDevice: 'HD Webcam' })
  const input = args[args.indexOf('-i') + 1]

  assert.equal(input, 'video=HD Webcam')
})

test('macos capture uses avfoundation with a video:audio index pair', () => {
  const args = buildCaptureArgs({
    platform: 'darwin',
    ingestPort: 1935,
    videoDevice: '0',
    audioDevice: '1',
  })

  assert.ok(args.includes('avfoundation'))
  assert.equal(args[args.indexOf('-i') + 1], '0:1')
})

test('macos capture with no audio keeps an empty audio slot rather than dropping it', () => {
  const args = buildCaptureArgs({ platform: 'darwin', ingestPort: 1935, videoDevice: '0' })
  assert.equal(args[args.indexOf('-i') + 1], '0:')
})

test('capture disables audio when there is no microphone', () => {
  // Publishing a video-only stream is valid; omitting -an is not, because
  // ffmpeg would then fail trying to encode a nonexistent audio input.
  const args = buildCaptureArgs({ platform: 'linux', ingestPort: 1935, videoDevice: '/dev/video0' })
  assert.ok(args.includes('-an'))
  assert.ok(!args.includes('-c:a'))
})

test('capture applies the requested resolution', () => {
  const args = buildCaptureArgs({
    platform: 'linux',
    ingestPort: 1935,
    videoDevice: '/dev/video0',
    encoding: { width: 1920, height: 1080 },
  })

  assert.equal(args[args.indexOf('-s') + 1], '1920x1080')
})

test('parseDshow separates video and audio devices', () => {
  const text = [
    '[dshow @ 0x1] "HD Webcam" (video)',
    '[dshow @ 0x1]   Alternative name "@device_pnp_\\\\?\\usb#vid_1234"',
    '[dshow @ 0x1] "Microphone (USB Audio)" (audio)',
    '[dshow @ 0x1] "OBS Virtual Camera" (video)',
  ].join('\n')

  const { video, audio } = parseDshow(text)
  assert.deepEqual(video, ['HD Webcam', 'OBS Virtual Camera'])
  assert.deepEqual(audio, ['Microphone (USB Audio)'])
})

test('parseAvfoundation reads indices from both sections', () => {
  const text = [
    '[AVFoundation indev @ 0x1] AVFoundation video devices:',
    '[AVFoundation indev @ 0x1] [0] FaceTime HD Camera',
    '[AVFoundation indev @ 0x1] [1] OBS Virtual Camera',
    '[AVFoundation indev @ 0x1] AVFoundation audio devices:',
    '[AVFoundation indev @ 0x1] [0] Built-in Microphone',
  ].join('\n')

  const { video, audio } = parseAvfoundation(text)
  assert.deepEqual(video, ['0: FaceTime HD Camera', '1: OBS Virtual Camera'])
  assert.deepEqual(audio, ['0: Built-in Microphone'])
})

test('device enumeration returns empty lists rather than throwing', async () => {
  // The UI's pickers are a convenience. A machine with no camera, or one where
  // the probe fails, must not turn into a 500 on /api/devices.
  const result = await listDevices({ platform: 'plan9' })

  assert.ok(Array.isArray(result.video))
  assert.ok(Array.isArray(result.audio))
  assert.match(result.note, /not implemented/i)
})
