// SPDX-License-Identifier: Apache-2.0
// End-to-end test + README screenshots.
// Launches the built app on a throwaway profile against a local demo API, drives it over the
// Chrome DevTools Protocol, checks the core flows and writes docs/screenshot*.png.
// Run with `npm run test:e2e` (builds first).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- demo API ---------- */

const user = {
  id: 42,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'admin',
  active: true,
  createdAt: '2026-03-14T09:26:53Z',
  teams: [
    { id: 7, name: 'Platform' },
    { id: 12, name: 'QA' }
  ],
  settings: { theme: 'github-dark', notifications: true }
}
let userHits = 0

function demoApi(req, res) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString()
    const json = (status, data) => {
      res.statusCode = status
      res.end(JSON.stringify(data))
    }
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-request-id', 'req_7f3a9c1e2b')
    const route = `${req.method} ${req.url}`

    if (route === 'GET /api/users/42') {
      if (req.headers.authorization !== 'Bearer demo-token')
        return json(401, { error: 'Unauthorized' })
      // a little rate limiting, so load runs show realistic errors
      if (++userHits % 8 === 0) {
        res.setHeader('retry-after', '1')
        return json(429, { error: 'Too Many Requests' })
      }
      res.setHeader('x-ratelimit-remaining', String(4999 - userHits))
      return json(200, user)
    }
    if (route === 'POST /api/users') {
      return json(201, { id: 43, ...JSON.parse(body || '{}'), createdAt: '2026-10-22T20:15:00Z' })
    }
    if (route === 'POST /api/login') return json(200, { token: 'demo-token', expiresIn: 3600 })
    if (route === 'GET /health') return json(200, { status: 'ok' })
    if (route === 'POST /graphql') {
      const { query } = JSON.parse(body || '{}')
      if (!query) return json(400, { errors: [{ message: 'Missing query' }] })
      return json(200, { data: { viewer: { login: 'ada', name: user.name } } })
    }
    json(404, { error: 'Not found' })
  })
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}

/* ---------- minimal CDP client ---------- */

async function pageTarget(port) {
  for (let i = 0; i < 150; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* app still starting */
    }
    await sleep(200)
  }
  throw new Error('App did not expose a page target')
}

function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let nextId = 0
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')))
    ws.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const id = ++nextId
            pending.set(id, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id, method, params }))
          }),
        close: () => ws.close()
      })
    )
  })
}

/* ---------- run ---------- */

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
  passed++
  console.log(`  ✓ ${message}`)
}

const api = createServer(demoApi)
const apiPort = await listen(api, 4010).catch(() => listen(api, 0))
const API = `http://localhost:${apiPort}`

const probe = createServer()
const cdpPort = await listen(probe, 0)
await new Promise((r) => probe.close(r))

const profile = mkdtempSync(join(tmpdir(), 'hexman-e2e-'))
const app = spawn(
  electronPath,
  [root, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`],
  { stdio: 'ignore' }
)
const exited = new Promise((r) => app.once('exit', r))

let cdp
try {
  cdp = await connect(await pageTarget(cdpPort))

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }
  const waitFor = async (expression, label, timeoutMs = 10_000) => {
    for (const end = Date.now() + timeoutMs; Date.now() < end;) {
      try {
        if (await evaluate(`!!(${expression})`)) return
      } catch {
        /* page reloading */
      }
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }

  // element expressions
  const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`
  const byText = (selector, text) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)})`
  const tile = (name) => byText('.tile-name', name) + `?.closest('.tile')`
  const numField = (label) =>
    `${byText('.num-field span', label)}.parentElement.querySelector('input')`

  const click = (el) => evaluate(`${el}.click()`)
  const textOf = (el) => evaluate(`${el}?.textContent ?? ''`)
  const typeInto = async (el, text, { replace = false } = {}) => {
    await evaluate(
      `(() => { const e = ${el}; e.focus(); ${replace ? 'e.select()' : 'e.setSelectionRange(e.value.length, e.value.length)'} })()`
    )
    await cdp.send('Input.insertText', { text })
  }
  const choose = (el, value) =>
    evaluate(`(() => {
      const e = ${el}
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(value)})
      e.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
  const paste = (el, text) =>
    evaluate(`(() => {
      const e = ${el}
      e.focus()
      const data = new DataTransfer()
      data.setData('text/plain', ${JSON.stringify(text)})
      e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })()`)
  const requestTiles = () =>
    evaluate(`[...document.querySelectorAll('nav[aria-label="Requests"] .tile')].map(t => ({
      name: t.querySelector('.tile-name').textContent,
      method: t.querySelector('.method').textContent,
      saved: t.classList.contains('tile-saved'),
      dirty: !!t.querySelector('.dot'),
      folder: t.closest('.folder')?.querySelector('.folder-name')?.textContent ?? null,
      draft: !t.closest('.folder') && !t.closest('.root-zone')
    }))`)
  const findTile = async (name) => (await requestTiles()).find((t) => t.name === name)
  const statusChip = `${q('.response-bar .chip')}?.textContent ?? ''`
  // Mark the current status chip (never remove React-owned nodes) and wait for a fresh one.
  const sendAndWait = async (button, expected, label) => {
    await evaluate(`${q('.response-bar .chip')}?.setAttribute('data-e2e-stale', '')`)
    await click(button)
    await waitFor(
      `(() => {
        const chip = ${q('.response-bar .chip')}
        return chip && !chip.hasAttribute('data-e2e-stale') && chip.textContent.startsWith(${JSON.stringify(expected)})
      })()`,
      label
    )
  }
  const viewport = (height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1360,
      height,
      deviceScaleFactor: 2,
      mobile: false
    })
  const shot = async (file, { height = 840, blur = true } = {}) => {
    if (blur) await evaluate(`document.activeElement?.blur()`)
    if (height !== 840) await viewport(height)
    await sleep(350)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    if (height !== 840) await viewport(840)
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, file), Buffer.from(data, 'base64'))
    console.log(`  📸 docs/${file}`)
  }

  await viewport(840)

  console.log('Hexman e2e')
  await waitFor(`document.querySelectorAll('.tile').length > 0`, 'first render')
  const first = await requestTiles()
  assert(
    first.length === 1 && first[0].name === 'Request 1' && first[0].draft,
    'fresh profile starts with one unsaved "Request 1"'
  )
  assert(
    (await textOf(q('.brand-tagline'))) === 'From testers to testers',
    'header shows the "From testers to testers" tagline'
  )

  /* --- seed a workspace --- */
  const seedRequests = [
    [
      'Get user',
      'rest',
      'GET',
      '/api/users/42',
      'Accept: application/json\nAuthorization: Bearer {{token}}',
      '',
      'f-users'
    ],
    [
      'Create user',
      'rest',
      'POST',
      '/api/users',
      'Content-Type: application/json\nAuthorization: Bearer {{token}}',
      '{\n  "name": "Grace Hopper",\n  "role": "tester"\n}',
      'f-users'
    ],
    [
      'Update role',
      'rest',
      'PATCH',
      '/api/users/42',
      'Content-Type: application/json',
      '{ "role": "admin" }',
      'f-users'
    ],
    [
      'Login',
      'rest',
      'POST',
      '/api/login',
      'Content-Type: application/json',
      '{\n  "user": "ada",\n  "password": "{{password}}"\n}',
      'f-auth'
    ],
    [
      'Revoke session',
      'rest',
      'DELETE',
      '/api/sessions/current',
      'Authorization: Bearer {{token}}',
      '',
      'f-auth'
    ],
    [
      'Viewer',
      'graphql',
      'POST',
      '/graphql',
      '',
      'query Viewer {\n  viewer { login name }\n}',
      null
    ]
  ].map(([name, kind, method, path, headers, body, folderId], i) => ({
    id: `seed-${i}`,
    name,
    kind,
    method,
    url: `{{baseUrl}}${path}`,
    headers,
    body,
    variables: '',
    folderId
  }))
  const seed = {
    'hexman.requests.v1': seedRequests,
    'hexman.folders.v1': [
      { id: 'f-users', name: 'Users', collapsed: false },
      { id: 'f-auth', name: 'Auth', collapsed: false }
    ],
    'hexman.environments.v1': [
      {
        id: 'env-local',
        name: 'Local',
        vars: `# demo API\nbaseUrl=${API}\ntoken=demo-token\npassword=hunter2`
      },
      { id: 'env-staging', name: 'Staging', vars: 'baseUrl=https://staging.example.com\ntoken=' }
    ],
    'hexman.activeEnvironment.v1': 'env-local'
  }
  await evaluate(
    `Object.entries(${JSON.stringify(seed)}).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))); setTimeout(() => location.reload())`
  )
  await waitFor(
    `document.querySelectorAll('nav[aria-label="Requests"] .tile').length === ${seedRequests.length}`,
    'restored workspace'
  )
  let tiles = await requestTiles()
  assert(
    tiles.every((t) => t.saved) &&
      tiles.filter((t) => t.folder === 'Users').length === 3 &&
      tiles.filter((t) => t.folder === 'Auth').length === 2 &&
      tiles.find((t) => t.name === 'Viewer').folder === null,
    'saved requests come back framed, inside their folders'
  )

  /* --- environments --- */
  await click(tile('Get user'))
  assert(
    (await textOf(q('.url-preview'))) === `→ ${API}/api/users/42`,
    'URL preview resolves {{baseUrl}} from the active environment'
  )
  await sendAndWait(q('.url-row .btn-send'), '200', 'Get user response')
  assert(true, 'request sends with {{token}} substituted (API answers 200, not 401)')

  await choose(q('.env-picker select'), '')
  await click(q('.url-row .btn-send'))
  await waitFor(
    `${q('.error-text')}?.textContent.includes('Undefined variable {{baseUrl}}')`,
    'error'
  )
  assert(true, 'without an environment, undefined variables fail with a clear error')
  await choose(q('.env-picker select'), 'env-local')

  /* --- drafts, saving, folders --- */
  for (let i = 0; i < 3; i++) await click(q('.new-row .btn-primary'))
  tiles = await requestTiles()
  assert(
    tiles
      .slice(-3)
      .map((t) => `${t.name}:${t.draft}`)
      .join() === 'Request 1:true,Request 2:true,Request 3:true',
    'new requests get numbered names and land at the bottom, unsaved'
  )

  await typeInto(q('.name-input'), 'Health check', { replace: true })
  await typeInto(q('.url-input'), '{{baseUrl}}/health')
  await click(q('.btn-save'))
  let health = await findTile('Health check')
  assert(health.saved && !health.draft, 'saving moves a request up and gives it a frame')

  await click(byText('.mini-btn', '+ Folder'))
  await waitFor(`document.activeElement?.classList.contains('folder-input')`, 'folder name input')
  await cdp.send('Input.insertText', { text: 'Monitoring' })
  await evaluate(`document.activeElement.blur()`)
  await choose(
    q('select[aria-label="Folder"]'),
    await evaluate(`(() => {
    const opt = [...document.querySelectorAll('select[aria-label="Folder"] option')].find(o => o.textContent === 'Monitoring')
    return opt.value
  })()`)
  )
  health = await findTile('Health check')
  assert(health.folder === 'Monitoring', 'folders can be created, named and filled')

  /* --- cURL paste, header suggestions, cURL & JSON views --- */
  await click(tile('Request 1'))
  await paste(
    q('.url-input'),
    `curl -X POST '{{baseUrl}}/api/users' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"name":"Linus","role":"qa"}'`
  )
  assert(
    (await evaluate(`${q('.method-select')}.value`)) === 'POST' &&
      (await evaluate(`${q('textarea[aria-label="Body"]')}.value`)) ===
        '{"name":"Linus","role":"qa"}',
    'pasting a cURL command into the URL field imports the whole request'
  )

  await click(q('.suggest .icon-btn'))
  await waitFor(q('.suggest-menu'), 'header menu')
  await shot('screenshot-headers.png', { blur: false })
  const fromRequests = await evaluate(`(() => {
    const group = ${byText('.suggest-title', 'From your requests')}?.parentElement
    return [...(group?.querySelectorAll('.suggest-item') ?? [])].map(b => b.textContent)
  })()`)
  assert(
    fromRequests.includes('AuthorizationBearer {{token}}'),
    'the + menu offers headers already used in saved requests'
  )
  await click(
    `[...document.querySelectorAll('.suggest-item')].find(b => b.textContent === 'AuthorizationBearer {{token}}')`
  )
  assert(
    (await evaluate(`${q('textarea[aria-label="Headers"]')}.value`)).endsWith(
      'Authorization: Bearer {{token}}'
    ),
    'picking a suggestion adds the header'
  )

  await click(byText('.segmented button', 'cURL'))
  const curl = await evaluate(`${q('.code-editor')}.value`)
  assert(
    curl.startsWith(`curl -X POST '{{baseUrl}}/api/users' \\`) && curl.includes('--data-raw'),
    'cURL view shows the request as a command'
  )
  await typeInto(
    q('.code-editor'),
    `curl -X PUT '{{baseUrl}}/api/users/42' -H 'X-Test: 1' --data-raw '{"role":"qa"}'`,
    { replace: true }
  )
  assert(
    (await findTile('Request 1')).method === 'PUT',
    'editing the cURL text updates the request'
  )

  await click(byText('.segmented button', 'JSON'))
  const doc = JSON.parse(await evaluate(`${q('.code-editor')}.value`))
  assert(
    doc.name === 'Request 1' && doc.method === 'PUT' && doc.headers['X-Test'] === '1',
    'JSON view shows the same request as a document'
  )
  await typeInto(q('.code-editor'), '{ "method": ', { replace: true })
  assert(
    (await evaluate(`!!${q('.code-error')} && ${q('.code-footer .btn-send')}.disabled`)) === true,
    'invalid JSON is reported and cannot be sent'
  )
  await typeInto(
    q('.code-editor'),
    JSON.stringify(
      { name: 'Request 1', method: 'DELETE', url: '{{baseUrl}}/api/users/42' },
      null,
      2
    ),
    { replace: true }
  )
  assert((await findTile('Request 1')).method === 'DELETE', 'editing the JSON updates the request')
  await click(byText('.segmented button', 'Form'))

  /* --- saved vs. modified --- */
  await click(tile('Create user'))
  await typeInto(q('textarea[aria-label="Headers"]'), '\nX-Trace: on')
  assert((await findTile('Create user')).dirty, 'editing a saved request marks it modified')
  const stored = JSON.parse(await evaluate(`localStorage.getItem('hexman.requests.v1')`))
  assert(
    !stored.find((r) => r.name === 'Create user').headers.includes('X-Trace'),
    'unsaved edits are not written to disk'
  )

  await click(tile('Request 2'))
  await typeInto(q('.url-input'), 'ftp://example.com/file')
  await click(q('.url-row .btn-send'))
  await waitFor(`${q('.error-text')}?.textContent.includes('Unsupported protocol')`, 'error')
  assert(true, 'non-HTTP URLs are rejected with a readable error')

  await click(tile('Viewer'))
  await sendAndWait(q('.url-row .btn-send'), '200', 'GraphQL response')
  assert(
    (await textOf(q('.code-block'))).includes('"login": "ada"'),
    'GraphQL request returns pretty-printed data'
  )

  /* --- suite --- */
  await click(byText('.mini-btn', '+ Suite'))
  await waitFor(q('.suite'), 'suite editor')
  await typeInto(q('input[aria-label="Suite name"]'), 'Smoke: users API', { replace: true })
  for (const id of ['seed-0', 'seed-1', 'seed-5', 'seed-3']) await choose(q('.add-step'), id)
  await typeInto(numField('Threads'), '4', { replace: true })
  await typeInto(numField('Loops'), '10', { replace: true })
  await typeInto(q('.step:nth-child(1) .assert-wide input'), 'Ada')
  await typeInto(q('.step:nth-child(2) .assert input'), '201', { replace: true })
  await typeInto(q('.step:nth-child(1) .assert:nth-of-type(2) input'), '1000')
  assert(
    (await textOf(q('.tg-total'))) === '= 160 samples',
    'thread group plans threads × loops × steps'
  )

  await click(q('.btn-run'))
  await waitFor(`!${q('.btn-stop')} && ${q('.summary .total')}`, 'suite run', 30_000)
  const total = await evaluate(`[...${q('.summary .total')}.children].map(td => td.textContent)`)
  const reasons = await evaluate(
    `[...document.querySelectorAll('.failure-why')].map(e => e.textContent)`
  )
  assert(total[1] === '160', 'suite runs every sample (4 threads × 10 loops × 4 steps)')
  assert(
    reasons.length > 0 &&
      reasons.every((r) => r === 'Status 429, expected 2xx · Body does not contain "Ada"'),
    'every failed assertion is reported per sample (rate-limited calls)'
  )
  assert(
    (await textOf(q('.report-head .chip'))) === 'Failed',
    'a suite with failed samples is marked Failed'
  )
  await shot('screenshot-suite.png', { height: 1200 })

  /* --- screenshots of the request views --- */
  await click(tile('Create user'))
  await click(byText('.segmented button', 'cURL'))
  await sendAndWait(q('.code-footer .btn-send'), '201', 'Create user response')
  await shot('screenshot-curl.png')

  await click(byText('.segmented button', 'Form'))
  await click(tile('Get user'))
  for (let attempt = 0; attempt < 3; attempt++) {
    await sendAndWait(q('.url-row .btn-send'), '', 'Get user response')
    if ((await evaluate(statusChip)).startsWith('200')) break
  }
  await shot('screenshot.png')

  console.log(`\n${passed} checks passed`)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  process.exitCode = 1
  try {
    const failure = join(tmpdir(), 'hexman-e2e-failure.png')
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(failure, Buffer.from(data, 'base64'))
    console.error(`  screenshot of the failure: ${failure}`)
  } catch {
    /* app not reachable */
  }
} finally {
  cdp?.close()
  app.kill()
  await exited
  api.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
