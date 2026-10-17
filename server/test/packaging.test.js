import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createApp } from '../src/app.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

/**
 * The desktop app copies server/ and web/ into resources/ and runs the server
 * with a working directory that is not the repo root. Three separate bugs made
 * that layout fail:
 *
 *   1. server/ had no package.json, so the files were treated as CommonJS and
 *      the ESM imports threw on startup.
 *   2. ws was not shipped alongside server/, so `import 'ws'` could not resolve.
 *   3. WEB_DIR was ignored, so the UI 404'd even once the server was up.
 *
 * These assertions pin the packaging contract rather than the process wiring.
 */

test('server ships its own package.json declaring ESM', () => {
  const pkgPath = join(repoRoot, 'server', 'package.json')
  assert.ok(existsSync(pkgPath), 'server/package.json must exist for the packaged app')

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  assert.equal(pkg.type, 'module', 'server must be treated as ESM by Node 20')
})

test('server package.json does not claim a type that contradicts its source', () => {
  const src = readFileSync(join(repoRoot, 'server', 'src', 'index.js'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'server', 'package.json'), 'utf8'))
  const usesEsm = /^\s*import\s/m.test(src)

  assert.equal(usesEsm, pkg.type === 'module', 'import syntax and package type must agree')
})

test('the only bare server dependency is declared for packaging', () => {
  const src = readFileSync(join(repoRoot, 'server', 'src', 'app.js'), 'utf8')
  const bare = [...src.matchAll(/from '([^']+)'/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('.') && !s.startsWith('node:'))

  // If a new runtime dependency appears, the desktop build must copy it into
  // resources/node_modules or the packaged app will crash on startup.
  assert.deepEqual(bare, ['ws'])

  const desktopPkg = JSON.parse(readFileSync(join(repoRoot, 'desktop', 'package.json'), 'utf8'))
  assert.ok(desktopPkg.dependencies?.ws, 'desktop must depend on ws so it can be bundled')
  const resources = desktopPkg.build.extraResources.map((r) => r.to)
  assert.ok(resources.includes('node_modules/ws'), 'ws must be copied into the packaged app')
})

test('createApp serves the UI from an explicit webDir', async () => {
  // A temp dir with a marker file proves the served content came from the
  // webDir we passed, not from the process working directory.
  const tmp = mkdtempSync(join(tmpdir(), 'webdir-'))
  writeFileSync(join(tmp, 'index.html'), '<title>FROM-WEB-DIR</title>')

  const app = createApp({ port: 0, ingestPort: 0, webDir: tmp })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const { port } = app.server.address()

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.match(body, /FROM-WEB-DIR/)
  } finally {
    app.engine.stop()
    await new Promise((resolve) => app.server.close(resolve))
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('WEB_DIR is read from the environment at startup', () => {
  const src = readFileSync(join(repoRoot, 'server', 'src', 'index.js'), 'utf8')
  assert.match(src, /process\.env\.WEB_DIR/, 'index.js must forward WEB_DIR to createApp')
})
