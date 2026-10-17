/**
 * HTTP + WebSocket server.
 *
 * Serves the studio UI and a small JSON API. Deliberately dependency-light:
 * node:http for routing, `ws` for live status. No framework, so the whole
 * server is readable in one sitting.
 *
 * Routes:
 *   GET    /api/health
 *   GET    /api/presets                     platform defaults for the UI
 *   GET    /api/destinations                list (keys redacted)
 *   POST   /api/destinations                create
 *   PATCH  /api/destinations/:id            update
 *   DELETE /api/destinations/:id            delete
 *   POST   /api/stream/start                begin fan-out
 *   POST   /api/stream/stop                 end fan-out
 *   GET    /api/stream/status               current state
 *   GET    /api/devices                     local cameras and microphones
 *   POST   /api/capture/start               publish a local camera to the ingest
 *   POST   /api/capture/stop                stop that capture
 *   GET    /api/capture/status              capture state
 *   GET    /api/recordings                  files written by the tee
 *   WS     /ws                              pushes status + ffmpeg stderr
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { DestinationStore } from './store.js'
import { StreamEngine } from './engine.js'
import { CaptureEngine } from './capture.js'
import { listDevices } from './devices.js'
import { recordingPath, listRecordings, ensureDir } from './recordings.js'
import { PRESETS } from './destinations.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const MAX_BODY = 256 * 1024

/**
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {number} [opts.ingestPort]
 * @param {string} [opts.webDir]
 * @param {DestinationStore} [opts.store]
 * @param {StreamEngine} [opts.engine]
 */
export function createApp(opts = {}) {
  const port = opts.port ?? 8080
  const ingestPort = opts.ingestPort ?? 1935
  const webDir = opts.webDir || resolve(process.cwd(), 'web')
  const store = opts.store || new DestinationStore()
  const engine = opts.engine || new StreamEngine()
  const capture = opts.capture || new CaptureEngine({ ffmpegPath: opts.ffmpegPath })
  const recordingsDir = opts.recordingsDir || resolve(store.dataDir, 'recordings')

  /** @type {Set<import('ws').WebSocket>} */
  const sockets = new Set()

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload, at: new Date().toISOString() })
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(msg)
    }
  }

  engine.on('stderr', (text) => broadcast('stderr', text))
  engine.on('exit', (info) => broadcast('stream', engine.status()))
  engine.on('started', () => broadcast('stream', engine.status()))
  engine.on('error', (err) => broadcast('error', { message: err.message }))

  capture.on('stderr', (text) => broadcast('stderr', text))
  capture.on('started', () => broadcast('capture', capture.status()))
  capture.on('exit', () => broadcast('capture', capture.status()))
  capture.on('error', (err) => broadcast('error', { message: `Capture: ${err.message}` }))

  const json = (res, status, body) => {
    const data = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
      'cache-control': 'no-store',
    })
    res.end(data)
  }

  const readBody = (req) =>
    new Promise((resolvePromise, reject) => {
      let size = 0
      /** @type {Buffer[]} */
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('Request body too large.'), { statusCode: 413 }))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (!chunks.length) return resolvePromise({})
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(Object.assign(new Error('Body must be valid JSON.'), { statusCode: 400 }))
        }
      })
      req.on('error', reject)
    })

  async function serveStatic(res, urlPath) {
    // Contain path traversal: resolve inside webDir and verify containment.
    const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
    const target = join(webDir, rel === '/' ? 'index.html' : rel)
    if (!target.startsWith(webDir)) {
      json(res, 403, { error: 'Forbidden' })
      return
    }

    try {
      const info = await stat(target)
      if (info.isDirectory()) throw new Error('is a directory')
      const body = await readFile(target)
      res.writeHead(200, {
        'content-type': MIME[extname(target)] || 'application/octet-stream',
        'content-length': body.length,
      })
      res.end(body)
    } catch {
      // SPA fallback so client-side routes work on refresh.
      try {
        const body = await readFile(join(webDir, 'index.html'))
        res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': body.length })
        res.end(body)
      } catch {
        json(res, 404, { error: 'Not found' })
      }
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const path = url.pathname
    const method = req.method || 'GET'

    try {
      if (path === '/api/health') {
        return json(res, 200, { ok: true, version: '0.1.0', ingestPort })
      }

      if (path === '/api/presets' && method === 'GET') {
        return json(res, 200, { presets: Object.values(PRESETS) })
      }

      if (path === '/api/destinations' && method === 'GET') {
        return json(res, 200, { destinations: store.list() })
      }

      if (path === '/api/destinations' && method === 'POST') {
        const body = await readBody(req)
        return json(res, 201, { destination: store.create(body) })
      }

      const destMatch = path.match(/^\/api\/destinations\/([a-f0-9]+)$/)
      if (destMatch && method === 'PATCH') {
        const body = await readBody(req)
        const updated = store.update(destMatch[1], body)
        if (!updated) return json(res, 404, { error: 'No such destination.' })
        return json(res, 200, { destination: updated })
      }
      if (destMatch && method === 'DELETE') {
        if (!store.remove(destMatch[1])) return json(res, 404, { error: 'No such destination.' })
        return json(res, 200, { ok: true })
      }

      if (path === '/api/stream/start' && method === 'POST') {
        const body = await readBody(req)
        if (engine.running) {
          return json(res, 409, { error: 'Already streaming. Stop the current stream first.' })
        }

        const ids = Array.isArray(body.destinationIds) ? body.destinationIds : []
        if (!ids.length) {
          return json(res, 400, { error: 'Select at least one destination.' })
        }

        const destinations = ids.map((id) => store.getWithSecret(id)).filter(Boolean)
        if (destinations.length !== ids.length) {
          return json(res, 400, { error: 'One or more destinations no longer exist.' })
        }

        const pid = engine.start({
          ingestPort,
          destinations,
          encoding: body.encoding || undefined,
          recordPath: body.record
            ? recordingPath({ dir: ensureDir(recordingsDir), label: body.recordLabel })
            : undefined,
        })
        return json(res, 202, { ok: true, pid, status: engine.status() })
      }

      if (path === '/api/stream/stop' && method === 'POST') {
        const stopped = engine.stop()
        return json(res, 200, { ok: true, stopped, status: engine.status() })
      }

      if (path === '/api/stream/status' && method === 'GET') {
        return json(res, 200, engine.status())
      }

      if (path === '/api/devices' && method === 'GET') {
        const devices = await listDevices({ ffmpegPath: opts.ffmpegPath })
        return json(res, 200, { ...devices, platform: process.platform })
      }

      if (path === '/api/capture/start' && method === 'POST') {
        const body = await readBody(req)
        if (capture.running) {
          return json(res, 409, { error: 'Capture is already running.' })
        }
        // The fan-out must be listening before capture connects, otherwise
        // ffmpeg's publisher gets a refused connection and exits immediately.
        if (!engine.running) {
          return json(res, 409, {
            error: 'Start the stream first — the encoder has to be listening before capture can publish to it.',
          })
        }
        const pid = capture.start({
          ingestPort,
          videoDevice: body.videoDevice,
          audioDevice: body.audioDevice,
          encoding: body.encoding || undefined,
        })
        return json(res, 202, { ok: true, pid, status: capture.status() })
      }

      if (path === '/api/capture/stop' && method === 'POST') {
        const stopped = capture.stop()
        return json(res, 200, { ok: true, stopped, status: capture.status() })
      }

      if (path === '/api/capture/status' && method === 'GET') {
        return json(res, 200, capture.status())
      }

      if (path === '/api/recordings' && method === 'GET') {
        return json(res, 200, { recordings: listRecordings(recordingsDir), dir: recordingsDir })
      }

      if (path.startsWith('/api/')) {
        return json(res, 404, { error: `No route for ${method} ${path}` })
      }

      return serveStatic(res, path)
    } catch (err) {
      const status = err.statusCode || 500
      if (status >= 500) console.error('[server]', err)
      return json(res, status, { error: err.message, problems: err.problems })
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    ws.send(JSON.stringify({ type: 'stream', payload: engine.status(), at: new Date().toISOString() }))
    ws.on('close', () => sockets.delete(ws))
    ws.on('error', () => sockets.delete(ws))
  })

  server.on('close', () => {
    capture.stop()
    engine.stop()
  })

  return { server, store, engine, capture, wss, port, ingestPort }
}

export { DestinationStore, StreamEngine, CaptureEngine }
