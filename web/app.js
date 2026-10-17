/**
 * Studio UI.
 *
 * Talks to the local server over fetch + a status WebSocket. Everything here
 * is plain DOM — no framework, so the file stays auditable.
 *
 * The camera capture is intentionally minimal: getUserMedia -> <video>. Pushing
 * that track to the RTMP ingest needs an encoder, which is the one part of this
 * stack that a browser cannot do on its own; see docs/capture.md for the two
 * supported paths (bundled ffmpeg, or MediaRecorder + a WHIP bridge).
 */

const $ = (id) => document.getElementById(id)

const state = {
  presets: [],
  destinations: [],
  selected: new Set(),
  running: false,
  /** @type {MediaStream | null} */
  media: null,
}

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

const showError = (msg) => {
  const el = $('dest-error')
  if (!msg) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = msg
}

function logLine(text) {
  const el = $('log')
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
  el.textContent += text.endsWith('\n') ? text : `${text}\n`
  // Keep the DOM bounded on long streams.
  if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000)
  if (atBottom) el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------- presets

async function loadPresets() {
  const { presets } = await api('/api/presets')
  state.presets = presets

  const select = $('platform')
  select.innerHTML = ''
  for (const p of presets) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.label
    select.append(opt)
  }
  applyPreset(select.value)
  select.addEventListener('change', () => applyPreset(select.value))
}

function applyPreset(id) {
  const preset = state.presets.find((p) => p.id === id)
  if (!preset) return
  $('rtmpUrl').value = preset.rtmpUrl || ''
  $('rtmpUrl').placeholder = preset.rtmpUrl || 'rtmp://…'
  $('key-hint').textContent = `${preset.keyHint} — ${preset.ingestNote}`
  if (!$('label').value) $('label').value = preset.label
}

// ------------------------------------------------------------ destinations

async function loadDestinations() {
  const { destinations } = await api('/api/destinations')
  state.destinations = destinations

  // Drop selections for destinations that no longer exist.
  const live = new Set(destinations.map((d) => d.id))
  for (const id of [...state.selected]) if (!live.has(id)) state.selected.delete(id)

  renderDestinations()
}

function renderDestinations() {
  const list = $('dest-list')
  list.innerHTML = ''

  if (!state.destinations.length) {
    const li = document.createElement('li')
    li.className = 'muted'
    li.textContent = 'No destinations yet. Add one above.'
    list.append(li)
    return
  }

  for (const d of state.destinations) {
    const li = document.createElement('li')
    li.className = 'dest-item'

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = state.selected.has(d.id)
    cb.id = `dest-${d.id}`
    cb.setAttribute('aria-label', `Send stream to ${d.label}`)
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(d.id)
      else state.selected.delete(d.id)
    })

    const meta = document.createElement('div')
    meta.className = 'dest-meta'

    const name = document.createElement('div')
    name.className = 'dest-name'
    name.textContent = d.label

    const sub = document.createElement('div')
    sub.className = 'dest-sub'
    const url = d.rtmpUrl || '(platform default)'
    sub.textContent = `${url} · key ${d.streamKeyFingerprint || 'unset'}`

    meta.append(name, sub)

    const remove = document.createElement('button')
    remove.className = 'btn btn--ghost btn--tiny'
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove "${d.label}"?`)) return
      await api(`/api/destinations/${d.id}`, { method: 'DELETE' })
      state.selected.delete(d.id)
      await loadDestinations()
    })

    li.append(cb, meta, remove)
    list.append(li)
  }
}

async function addDestination(event) {
  event.preventDefault()
  showError('')

  const payload = {
    platform: $('platform').value,
    label: $('label').value.trim(),
    rtmpUrl: $('rtmpUrl').value.trim(),
    streamKey: $('streamKey').value.trim(),
  }

  try {
    await api('/api/destinations', { method: 'POST', body: JSON.stringify(payload) })
    $('streamKey').value = ''
    await loadDestinations()
  } catch (err) {
    showError(err.message)
  }
}

// ----------------------------------------------------------------- camera

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const fill = (select, kind, fallback) => {
    const current = select.value
    select.innerHTML = ''
    const matching = devices.filter((d) => d.kind === kind)
    if (!matching.length) {
      const opt = document.createElement('option')
      opt.textContent = fallback
      opt.value = ''
      select.append(opt)
      return
    }
    for (const d of matching) {
      const opt = document.createElement('option')
      opt.value = d.deviceId
      opt.textContent = d.label || fallback
      select.append(opt)
    }
    if (current) select.value = current
  }
  fill($('video-device'), 'videoinput', 'Default camera')
  fill($('audio-device'), 'audioinput', 'Default microphone')
}

async function startCamera() {
  const [w, h] = $('resolution').value.split('x').map(Number)
  const videoId = $('video-device').value
  const audioId = $('audio-device').value

  state.media = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: w },
      height: { ideal: h },
      ...(videoId ? { deviceId: { exact: videoId } } : {}),
    },
    audio: audioId ? { deviceId: { exact: audioId } } : true,
  })

  $('preview').srcObject = state.media
  $('cam-start').disabled = true
  $('cam-stop').disabled = false

  const note = $('capture-note')
  note.hidden = false
  note.textContent =
    'Preview is live. Sending this to the RTMP ingest needs an encoder process — see docs/capture.md.'
}

function stopCamera() {
  if (state.media) {
    for (const track of state.media.getTracks()) track.stop()
    state.media = null
  }
  $('preview').srcObject = null
  $('cam-start').disabled = false
  $('cam-stop').disabled = true
  $('capture-note').hidden = true
}

// ------------------------------------------------------------------ stream

function applyStatus(status) {
  state.running = Boolean(status.running)
  $('go-live').disabled = state.running
  $('stop-live').disabled = !state.running

  const live = $('live')
  live.textContent = state.running ? 'live' : 'offline'
  live.className = `pill ${state.running ? 'pill--live' : 'pill--idle'}`
}

async function goLive() {
  showError('')
  if (state.selected.size === 0) {
    showError('Check at least one destination.')
    return
  }
  try {
    const res = await api('/api/stream/start', {
      method: 'POST',
      body: JSON.stringify({ destinationIds: [...state.selected] }),
    })
    logLine(`▶ started fan-out (pid ${res.pid})`)
    applyStatus(res.status)
  } catch (err) {
    showError(err.message)
  }
}

async function stopLive() {
  const res = await api('/api/stream/stop', { method: 'POST' })
  logLine('■ stopped')
  applyStatus(res.status)
}

// -------------------------------------------------------------- websocket

function connectStatus() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.addEventListener('open', () => {
    const conn = $('conn')
    conn.textContent = 'connected'
    conn.className = 'pill pill--ok'
  })

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'stream') applyStatus(msg.payload)
    if (msg.type === 'stderr') logLine(msg.payload.trimEnd())
    if (msg.type === 'error') logLine(`! ${msg.payload.message}`)
  })

  ws.addEventListener('close', () => {
    const conn = $('conn')
    conn.textContent = 'reconnecting…'
    conn.className = 'pill pill--idle'
    setTimeout(connectStatus, 1500)
  })

  ws.addEventListener('error', () => ws.close())
}

// ------------------------------------------------------------------- init

async function init() {
  $('ingest-url').textContent = `rtmp://${location.hostname}:1935/live/studio`

  $('copy-ingest').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('ingest-url').textContent)
    $('copy-ingest').textContent = 'Copied'
    setTimeout(() => ($('copy-ingest').textContent = 'Copy'), 1200)
  })

  $('dest-form').addEventListener('submit', addDestination)
  $('go-live').addEventListener('click', goLive)
  $('stop-live').addEventListener('click', stopLive)
  $('cam-start').addEventListener('click', () =>
    startCamera().catch((err) => {
      const note = $('capture-note')
      note.hidden = false
      note.textContent = `Camera unavailable: ${err.message}`
    }),
  )
  $('cam-stop').addEventListener('click', stopCamera)

  await loadPresets()
  await loadDestinations()
  connectStatus()

  if (navigator.mediaDevices?.enumerateDevices) {
    await listDevices().catch(() => {})
    navigator.mediaDevices.addEventListener('devicechange', () => listDevices().catch(() => {}))
  }
}

init().catch((err) => logLine(`Fatal: ${err.message}`))
