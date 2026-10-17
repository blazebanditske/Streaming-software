/**
 * Capture device enumeration.
 *
 * ffmpeg can list the cameras and microphones the OS exposes, but every
 * platform spells it differently and the output is human-readable text rather
 * than anything structured. This module runs the platform-appropriate probe
 * and parses it.
 *
 * Enumeration is best-effort by design. It is a convenience for the UI's device
 * pickers, not a requirement: a user can always type a device name or path by
 * hand, and on a headless or permission-restricted machine the probe returns
 * empty lists rather than failing the request.
 */

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'

/**
 * Collect ffmpeg's stderr for a probe command.
 * ffmpeg writes device listings to stderr and exits non-zero, which is expected.
 */
function probe(ffmpegPath, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }

    let proc
    try {
      proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return resolve('')
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      done()
    }, timeoutMs)

    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('error', done)
    proc.on('close', done)
  })
}

/** Windows: `[dshow @ ...] "HD Webcam" (video)` */
export function parseDshow(text) {
  const video = []
  const audio = []
  for (const line of text.split('\n')) {
    const m = line.match(/"([^"]+)"\s*\((video|audio)\)/i)
    if (!m) continue
    ;(m[2].toLowerCase() === 'video' ? video : audio).push(m[1])
  }
  return { video, audio }
}

/** macOS: `[AVFoundation indev @ ...] [0] FaceTime HD Camera` */
export function parseAvfoundation(text) {
  const video = []
  const audio = []
  let section = null
  for (const line of text.split('\n')) {
    if (/AVFoundation video devices/i.test(line)) {
      section = video
      continue
    }
    if (/AVFoundation audio devices/i.test(line)) {
      section = audio
      continue
    }
    const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/)
    if (m && section) section.push(`${m[1]}: ${m[2]}`)
  }
  return { video, audio }
}

/**
 * Linux has no single ffmpeg device listing. Video nodes are character devices
 * under /dev, and audio depends on which sound server is running.
 */
export async function listLinuxDevices() {
  let video = []
  try {
    const entries = await readdir('/dev')
    video = entries
      .filter((n) => /^video\d+$/.test(n))
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
      .map((n) => `/dev/${n}`)
  } catch {
    video = []
  }
  // ALSA's `default` works on virtually every Linux install, and probing for
  // card names needs a tool (arecord) we cannot assume is present.
  return { video, audio: ['default'] }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.ffmpegPath]
 * @param {NodeJS.Platform} [opts.platform]
 * @returns {Promise<{video: string[], audio: string[], note?: string}>}
 */
export async function listDevices({ ffmpegPath = 'ffmpeg', platform = process.platform } = {}) {
  if (platform === 'linux') {
    const { video, audio } = await listLinuxDevices()
    return {
      video,
      audio,
      ...(video.length ? {} : { note: 'No /dev/video* capture devices found.' }),
    }
  }

  if (platform === 'win32') {
    const text = await probe(ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'])
    return parseDshow(text)
  }

  if (platform === 'darwin') {
    const text = await probe(ffmpegPath, [
      '-hide_banner',
      '-f',
      'avfoundation',
      '-list_devices',
      'true',
      '-i',
      '',
    ])
    return parseAvfoundation(text)
  }

  return { video: [], audio: [], note: `Device enumeration is not implemented for ${platform}.` }
}
