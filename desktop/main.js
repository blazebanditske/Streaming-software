/**
 * Desktop shell.
 *
 * Wraps the studio in a native window and supervises the local server as a
 * child process, so a non-technical user double-clicks one icon and gets a
 * working app — no terminal, no `npm start`.
 *
 * The server is spawned with ELECTRON_RUN_AS_NODE so we do not need a separate
 * Node install on the user's machine.
 */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const PORT = Number(process.env.PORT || 8080)
const INGEST_PORT = Number(process.env.INGEST_PORT || 1935)

let serverProcess = null
let mainWindow = null
let quitting = false

/**
 * Locate the server entrypoint in both dev and packaged layouts.
 * electron-builder copies server/ into resources/ via extraResources.
 */
function resolveServerEntry() {
  const candidates = [
    join(process.resourcesPath || '', 'server', 'src', 'index.js'),
    join(__dirname, '..', 'server', 'src', 'index.js'),
  ]
  return candidates.find((p) => p && existsSync(p))
}

function resolveWebDir() {
  const candidates = [
    join(process.resourcesPath || '', 'web'),
    join(__dirname, '..', 'web'),
  ]
  return candidates.find((p) => p && existsSync(p))
}

function startServer() {
  const entry = resolveServerEntry()
  if (!entry) throw new Error('Could not locate the server entrypoint.')

  serverProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      INGEST_PORT: String(INGEST_PORT),
      WEB_DIR: resolveWebDir() || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Keep the tail of the server's output so a crash can be explained instead
  // of reporting a bare exit code.
  const recentOutput = []
  const capture = (chunk) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      if (line.trim()) recentOutput.push(line)
    }
    while (recentOutput.length > 20) recentOutput.shift()
  }

  serverProcess.stdout.on('data', (d) => {
    capture(d)
    process.stdout.write(`[server] ${d}`)
  })
  serverProcess.stderr.on('data', (d) => {
    capture(d)
    process.stderr.write(`[server] ${d}`)
  })
  serverProcess.on('error', (err) => {
    dialog.showErrorBox('Studio stopped', `Could not start the local server.\n\n${err.message}`)
  })
  serverProcess.on('exit', (code) => {
    serverProcess = null
    // A shutdown we asked for is not a failure.
    if (quitting || code === 0 || code === null) return
    if (mainWindow) {
      dialog.showErrorBox(
        'Studio stopped',
        `The local server exited with code ${code}.\n\n${recentOutput.join('\n')}`,
      )
    }
  })
}

function stopServer() {
  if (!serverProcess) return
  serverProcess.kill('SIGTERM')
  serverProcess = null
}

/** Wait until the server answers /api/health, then resolve. */
async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    title: 'Streaming Software',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // External links open in the real browser, never inside the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const ok = await waitForServer()
  if (!ok) {
    dialog.showErrorBox(
      'Could not start',
      `The local server did not come up on port ${PORT}. Is another copy already running?`,
    )
    app.quit()
    return
  }

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'TikTok eligibility guide',
          click: () => shell.openExternal('https://www.tiktok.com/live/creator'),
        },
        {
          label: 'Project repository',
          click: () => shell.openExternal('https://github.com/blazebanditske/streaming-software'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  startServer()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  quitting = true
  stopServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  stopServer()
})

process.on('exit', () => {
  quitting = true
  stopServer()
})
