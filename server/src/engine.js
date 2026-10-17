/**
 * ffmpeg fan-out engine.
 *
 * The whole product rests on one idea: ffmpeg can listen for a single incoming
 * stream and simultaneously push it to many RTMP servers using the `tee`
 * muxer. So we do not need a cloud service, an account, or a relay — we need
 * one local ffmpeg process.
 *
 *   browser / OBS ──RTMP──▶ ffmpeg -listen 1 ──tee──┬──▶ YouTube
 *                                                   ├──▶ Twitch
 *                                                   ├──▶ Facebook
 *                                                   └──▶ TikTok
 *
 * Two implementation details matter and are easy to get wrong:
 *
 *  1. `-listen 1` makes ffmpeg act as the RTMP *server*. Our own studio pushes
 *     to us; an external encoder like OBS can too. That is why the studio does
 *     not need a "start streaming" handshake with any platform.
 *
 *  2. Only the first tee output gets `-map`. Every later output inherits the
 *     same mapping. Repeating `-map` per output is a common mistake that makes
 *     ffmpeg silently drop the extra destinations.
 *
 * Stream keys are passed to ffmpeg on stdin via an `-f concat`-free approach:
 * we build the argv ourselves and hand it to spawn() without a shell, so keys
 * never appear in a shell history and never get word-split.
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

/**
 * @typedef {object} Destination
 * @property {string} id
 * @property {string} label
 * @property {string} rtmpUrl
 * @property {string} streamKey
 */

/**
 * @typedef {object} StreamProfile
 * @property {number} ingestPort
 * @property {Destination[]} destinations
 * @property {{width:number,height:number,fps:number,videoBitrateKbps:number,audioBitrateKbps:number,preset:string}} encoding
 */

const DEFAULT_ENCODING = {
  width: 1280,
  height: 720,
  fps: 30,
  videoBitrateKbps: 3500,
  audioBitrateKbps: 128,
  preset: 'veryfast',
}

/**
 * Build the full ffmpeg argv for a fan-out.
 *
 * Exported separately from the process so it can be unit-tested without
 * spawning anything — the argv is where all the subtle bugs live.
 *
 * @param {StreamProfile} profile
 * @returns {string[]}
 */
export function buildFfmpegArgs(profile) {
  const enc = { ...DEFAULT_ENCODING, ...(profile.encoding || {}) }
  const dests = profile.destinations || []
  if (dests.length === 0) {
    throw new Error('Cannot build a fan-out with zero destinations.')
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',

    // Act as the RTMP server and wait for one publisher.
    '-listen', '1',
    '-f', 'flv',
    '-i', `rtmp://127.0.0.1:${profile.ingestPort}/live/studio`,
  ]

  // Single encode for all outputs. Re-encoding per destination would multiply
  // CPU cost by the number of platforms for no benefit, since every major
  // platform accepts a comparable H.264/AAC ladder.
  args.push(
    '-c:v', 'libx264',
    '-preset', enc.preset,
    '-tune', 'zerolatency',
    '-b:v', `${enc.videoBitrateKbps}k`,
    '-maxrate', `${enc.videoBitrateKbps}k`,
    '-bufsize', `${enc.videoBitrateKbps * 2}k`,
    '-pix_fmt', 'yuv420p',
    '-g', String(enc.fps * 2),
    '-r', String(enc.fps),
    '-s', `${enc.width}x${enc.height}`,
    '-c:a', 'aac',
    '-b:a', `${enc.audioBitrateKbps}k`,
    '-ar', '44100',
    '-ac', '2',
  )

  // tee muxer. `onfail=ignore` keeps a single dead platform from taking down
  // the whole broadcast; the surviving destinations keep running.
  const teeTargets = dests.map((d) => {
    const url = joinRtmp(d.rtmpUrl, d.streamKey)
    // Each output gets its own FLV muxer. `use_fifo` gives every destination
    // an independent send buffer, so one slow platform does not stall the
    // others — without it, TCP backpressure on one socket stalls all of them.
    return `[f=flv:onfail=ignore:use_fifo=1]${url}`
  })

  args.push('-map', '0:v', '-map', '0:a', '-f', 'tee', teeTargets.join('|'))

  return args
}

/**
 * Combine an RTMP server URL and a stream key into the URL ffmpeg pushes to.
 *
 * Two shapes exist in the wild:
 *   rtmp://host/app            + key   -> rtmp://host/app/key
 *   rtmp://host/app?params     + key   -> rtmp://host/app/key?params
 * Twitch and Facebook use the second shape. Getting this wrong produces an
 * authentication failure that looks like a bad key, so it is worth being
 * explicit about.
 *
 * @param {string} rtmpUrl
 * @param {string} streamKey
 */
export function joinRtmp(rtmpUrl, streamKey) {
  const base = (rtmpUrl || '').trim().replace(/\/+$/, '')
  const key = (streamKey || '').trim()
  if (!key) return base

  const q = base.indexOf('?')
  if (q === -1) return `${base}/${key}`
  return `${base.slice(0, q)}/${key}${base.slice(q)}`
}

/**
 * Runs one ffmpeg fan-out and reports what happens to it.
 *
 * Emits: 'started', 'stderr', 'exit', 'error'.
 */
export class StreamEngine extends EventEmitter {
  constructor({ ffmpegPath = 'ffmpeg' } = {}) {
    super()
    this.ffmpegPath = ffmpegPath
    /** @type {import('node:child_process').ChildProcess | null} */
    this.proc = null
    /** @type {StreamProfile | null} */
    this.profile = null
    this.startedAt = null
    /** @type {string[]} */
    this.recentStderr = []
  }

  get running() {
    return this.proc !== null && this.proc.exitCode === null
  }

  /**
   * @param {StreamProfile} profile
   */
  start(profile) {
    if (this.running) throw new Error('A stream is already running.')

    const args = buildFfmpegArgs(profile)
    this.profile = profile
    this.recentStderr = []

    const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    this.startedAt = new Date()

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk) => {
      // ffmpeg reports per-output health on stderr. Keep a short ring buffer
      // for the UI instead of letting it grow without bound on long streams.
      const lines = String(chunk).split('\n').filter(Boolean)
      for (const line of lines) this.recentStderr.push(line)
      if (this.recentStderr.length > 200) {
        this.recentStderr.splice(0, this.recentStderr.length - 200)
      }
      this.emit('stderr', String(chunk))
    })

    proc.on('error', (err) => {
      this.emit('error', err)
      this.proc = null
    })

    proc.on('exit', (code, signal) => {
      this.proc = null
      this.startedAt = null
      this.emit('exit', { code, signal })
    })

    this.emit('started', { pid: proc.pid, args: redactArgs(args) })
    return proc.pid
  }

  stop({ signal = 'SIGTERM' } = {}) {
    if (!this.proc) return false
    this.proc.kill(signal)
    return true
  }

  status() {
    return {
      running: this.running,
      pid: this.proc ? this.proc.pid : null,
      startedAt: this.startedAt,
      ingestPort: this.profile ? this.profile.ingestPort : null,
      destinationCount: this.profile ? this.profile.destinations.length : 0,
      destinations: this.profile
        ? this.profile.destinations.map((d) => ({ id: d.id, label: d.label, platform: d.platform }))
        : [],
      recentStderr: this.recentStderr.slice(-25),
    }
  }
}

/**
 * Remove stream keys from an argv before it is logged or sent to the UI.
 * @param {string[]} args
 */
export function redactArgs(args) {
  return args.map((a) => a.replace(/(rtmps?:\/\/[^/]+\/)([^?]+)/g, '$1<redacted>'))
}
