/**
 * Server-side capture supervisor.
 *
 * Opens a local camera and microphone with ffmpeg and publishes them to our own
 * RTMP ingest, so the studio can go live without OBS. The fan-out engine picks
 * the stream up from there exactly as it would an external encoder.
 *
 *   camera ──ffmpeg(capture)──▶ rtmp://127.0.0.1:1935 ──ffmpeg(tee)──▶ platforms
 *
 * Why a separate process from the fan-out: capture is local and disposable,
 * destinations are remote and stateful. If a camera is unplugged mid-stream the
 * fan-out should survive it, and restarting capture should not drop the
 * platform connections.
 *
 * Caveat worth knowing: this process runs as the *server's* user, so on macOS
 * and Windows the camera permission prompt belongs to the app, not the browser.
 * That is why the browser preview and this path both exist.
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { buildCaptureArgs } from './engine.js'

export class CaptureEngine extends EventEmitter {
  constructor({ ffmpegPath = 'ffmpeg' } = {}) {
    super()
    this.ffmpegPath = ffmpegPath
    /** @type {import('node:child_process').ChildProcess | null} */
    this.proc = null
    this.config = null
    this.startedAt = null
    /** @type {string[]} */
    this.recentStderr = []
  }

  get running() {
    return this.proc !== null && this.proc.exitCode === null
  }

  /**
   * @param {{ingestPort:number, videoDevice?:string, audioDevice?:string, encoding?:object}} config
   */
  start(config) {
    if (this.running) throw new Error('Capture is already running.')

    const args = buildCaptureArgs(config)
    this.config = config
    this.recentStderr = []

    const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    this.startedAt = new Date()

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        this.recentStderr.push(line)
      }
      if (this.recentStderr.length > 200) {
        this.recentStderr.splice(0, this.recentStderr.length - 200)
      }
      this.emit('stderr', String(chunk))
    })

    proc.on('error', (err) => {
      this.proc = null
      this.emit('error', err)
    })

    proc.on('exit', (code, signal) => {
      this.proc = null
      this.startedAt = null
      this.emit('exit', { code, signal })
    })

    this.emit('started', { pid: proc.pid })
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
      videoDevice: this.config ? this.config.videoDevice || null : null,
      audioDevice: this.config ? this.config.audioDevice || null : null,
      recentStderr: this.recentStderr.slice(-25),
    }
  }
}
