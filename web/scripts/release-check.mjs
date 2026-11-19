// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * release-check.mjs — loads one stored match in the release build before it ships.
 *
 * test.18 and test.19 shipped with every match stuck on "Decoding materials": the minifier broke
 * three's meshopt worker, the unminified dev build hid it, and no test ever loaded a match from
 * the packaged bundle. This check does, and tools\package.ps1 runs it after building the exe.
 *
 * Server, in order:
 *   1. the packaged exe itself, serving the data folder (`--data`, default the app's
 *      %LOCALAPPDATA%\infinite-theater-3d\data): the exe's own embedded page is what loads;
 *   2. when another server holds that folder (the app is open), `vite preview` of web\dist, the
 *      exact bundle the exe embeds, proxied to that server's API.
 * Match: `--match <id>`, or the first stored match whose map is already built.
 *
 * Pass: the scene reports `ready` (the `data-it3d-scene-load` attribute, set by Replay3DView)
 * within `--timeout-s`, with no page error and no viewer error (POST /api/client-log). Anything
 * else exits 1 with what it saw. Exit 2: nothing to test with (no stored match with a built map).
 *
 * Browser: Playwright's own Chromium (headless) on ONE persistent profile under %TEMP%, never a
 * fresh profile per run (see the global rule on launching Chrome from scripts).
 *
 *   node scripts/release-check.mjs --exe <installation-08.exe> [--data <dir>] [--match <id>]
 *     [--timeout-s 240]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { timeoutS: 240 }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k === '--exe') { out.exe = v; i++ }
    else if (k === '--data') { out.data = v; i++ }
    else if (k === '--match') { out.match = v; i++ }
    else if (k === '--timeout-s') { out.timeoutS = Number(v); i++ }
    else throw new Error(`unknown argument ${k}`)
  }
  if (!out.exe) throw new Error('--exe <installation-08.exe> is required')
  out.data ??= join(process.env.LOCALAPPDATA ?? '', 'infinite-theater-3d', 'data')
  return out
}

const log = (msg) => console.log(`[release-check] ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

async function health(base) {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Kills a process and its children (the exe may have started helpers). */
function killTree(child) {
  if (!child || child.exitCode !== null) return
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}

async function startExe(exe, data) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(exe, ['serve', '--addr', `127.0.0.1:${port}`, '--data', data], { windowsHide: true, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) return null
    const h = await health(base)
    if (h) return { base, child, how: `packaged exe (version ${h.version}) on ${data}` }
    await sleep(500)
  }
  killTree(child)
  return null
}

async function startPreview(apiTarget) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const vite = join(webDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: webDir,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, IT3D_API_TARGET: apiTarget },
  })
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) return null
    if (await health(base)) return { base, child, how: `web\\dist preview proxied to ${apiTarget}` }
    await sleep(500)
  }
  killTree(child)
  return null
}

/** The texture qualities a map is built at, lighter first (the page's quality picker values). */
const QUALITIES = ['standard', 'high']
const qualityQuery = (q) => (q === 'high' ? '?quality=high' : '')

/** The first quality `id`'s map is built at (`ready`), or null. */
async function builtQuality(base, id) {
  for (const q of QUALITIES) {
    try {
      const st = await (await fetch(`${base}/api/matches/${encodeURIComponent(id)}/mesh/state${qualityQuery(q)}`)).json()
      if (st?.state === 'ready') return q
    } catch {
      // A state that cannot be read counts as not built.
    }
  }
  return null
}

/**
 * pickMatch: the match to load and the texture quality its map is built at. The page loads the
 * map at its stored quality preference (default Standard) and, when the map is not built at it,
 * waits on the quality picker forever: so the quality the map IS built at is chosen here and set
 * as the page's preference (`loadMatch`). A map built only at High (the app's usual pick) is fine.
 */
async function pickMatch(base, wanted) {
  if (wanted) {
    const quality = await builtQuality(base, wanted)
    return quality ? { id: wanted, quality } : { id: wanted, quality: null }
  }
  const matches = await (await fetch(`${base}/api/matches`)).json()
  for (const m of (Array.isArray(matches) ? matches : []).slice(0, 30)) {
    const quality = await builtQuality(base, m.matchId)
    if (quality) return { id: m.matchId, quality }
  }
  return null
}

/** Playwright's newest installed Chromium, or null to let Playwright find its own. */
function bundledChromium() {
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  if (!existsSync(root)) return null
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const d of dirs) {
    const exe = join(root, d, 'chrome-win64', 'chrome.exe')
    if (existsSync(exe)) return exe
  }
  return null
}

async function loadMatch(base, matchId, quality, timeoutS) {
  const profile = join(tmpdir(), 'it3d-release-check-chrome-profile')
  mkdirSync(profile, { recursive: true })
  const executablePath = bundledChromium() ?? undefined
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath,
    viewport: { width: 1600, height: 900 },
    args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  })
  const viewerErrors = []
  const pageErrors = []
  const consoleErrors = []
  try {
    await context.clearCookies()
    const page = context.pages()[0] ?? (await context.newPage())
    // The page's texture-quality preference (useTextureQuality's key): the quality the map is
    // built at, so the pre-game loads it instead of offering a build.
    await context.addInitScript((q) => { try { localStorage.setItem('replay-texture-quality', q) } catch { /* no storage */ } }, quality)
    await page.route('**/api/client-log', async (route) => {
      viewerErrors.push(route.request().postData() ?? '')
      await route.continue()
    })
    page.on('pageerror', (err) => pageErrors.push(String(err?.stack ?? err)))
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('requestfailed', (req) => consoleErrors.push(`request failed: ${req.url()} (${req.failure()?.errorText ?? '?'})`))
    const url = `${base}/#/matches/${encodeURIComponent(matchId)}`
    log(`loading ${url}`)
    const started = Date.now()
    await page.goto(url)
    let last = ''
    let signal = ''
    while (Date.now() - started < timeoutS * 1000) {
      signal = (await page.evaluate(() => document.documentElement.dataset.it3dSceneLoad ?? '')) || ''
      if (signal !== last) {
        log(`${((Date.now() - started) / 1000).toFixed(1)} s  ${signal || '(scene not mounted yet)'}`)
        last = signal
      }
      if (signal === 'ready' || signal.startsWith('error')) break
      await sleep(1000)
    }
    // A moment after ready for late errors (the first frames, the countdown).
    if (signal === 'ready') await sleep(3000)
    // On a failure, what the page was showing: its text and a screenshot.
    let shown = ''
    let shot = ''
    if (signal !== 'ready') {
      shown = ((await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      shot = join(tmpdir(), 'it3d-release-check-failure.png')
      await page.screenshot({ path: shot }).catch(() => { shot = '' })
    }
    return { signal, seconds: (Date.now() - started) / 1000, viewerErrors, pageErrors, consoleErrors, shown, shot }
  } finally {
    await context.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let server = await startExe(args.exe, args.data)
  if (!server) {
    const addrFile = join(args.data, 'server.addr')
    const addr = existsSync(addrFile) ? readFileSync(addrFile, 'utf8').trim() : ''
    if (!addr || !(await health(`http://${addr}`))) {
      log(`FAIL: the packaged exe did not start on ${args.data}, and no running server holds that folder`)
      return 1
    }
    log(`the data folder is in use by the server on ${addr}; testing the same bundle through vite preview`)
    server = await startPreview(`http://${addr}`)
    if (!server) {
      log('FAIL: vite preview did not start')
      return 1
    }
  }
  log(`server: ${server.how}`)
  try {
    const picked = await pickMatch(server.base, args.match)
    if (!picked) {
      log('SKIP: no stored match with a built map to load (open one match in the app once, then package again)')
      return 2
    }
    if (!picked.quality) {
      log(`FAIL: match ${picked.id} has no map built at any quality (${QUALITIES.join(', ')})`)
      return 1
    }
    const matchId = picked.id
    log(`match ${matchId}, map built at ${picked.quality}`)
    const r = await loadMatch(server.base, matchId, picked.quality, args.timeoutS)
    const problems = []
    if (r.signal !== 'ready') problems.push(`scene ended as "${r.signal || 'never mounted'}" after ${r.seconds.toFixed(0)} s`)
    for (const e of r.viewerErrors) problems.push(`viewer error: ${e}`)
    for (const e of r.pageErrors) problems.push(`page error: ${e}`)
    if (problems.length) {
      log(`FAIL loading match ${matchId}:`)
      for (const p of problems) log(`  ${p}`)
      if (r.shown) log(`  the page showed: ${r.shown}`)
      for (const e of r.consoleErrors.slice(0, 10)) log(`  console: ${e}`)
      if (r.shot) log(`  screenshot: ${r.shot}`)
      return 1
    }
    log(`PASS: match ${matchId} ready in ${r.seconds.toFixed(1)} s, no errors`)
    return 0
  } finally {
    killTree(server.child)
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`FAIL: ${err?.stack ?? err}`)
    process.exit(1)
  },
)
