import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { Registry } from './projects.ts'
import { hooksInstalled, installHooks, uninstallHooks } from './hooks.ts'
import { listDir } from './fsbrowse.ts'
import { getSettings, saveSettings, defaults } from './settings.ts'
import { contractDescription } from '../shared/contracts.ts'
import { schemaContract } from './contracts.ts'
import { ingestActivity } from './activity.ts'
import { FULL_SCHEMA, PATCH_SCHEMA } from './arch.ts'
import { mcpRequest } from './mcp.ts'
import { findCodex } from './codex.ts'
import { findClaude } from './mapper.ts'
import { WEB_DIR, packageVersion } from './paths.ts'
import { openBrowser, parseArgs } from './cli.ts'

const cli = parseArgs(process.argv.slice(2))
const PORT = cli.port
// local only by default: the API can read project files and install hooks, so it must not be reachable from the network
const HOST = cli.host
const registry = new Registry()
registry.hookPort = PORT
const app = new Hono()

// Only this machine's own pages may call the API. Blocks other websites (cross-site requests carry an Origin) and
// DNS-rebinding (the Host header would be the attacker's name). Hook relays and MCP clients send neither a foreign
// Origin nor a foreign Host, so they pass.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use('*', async (c, next) => {
  if (HOST !== '127.0.0.1') return next() // the user opted into network access with --host
  const origin = c.req.header('origin')
  const host = c.req.header('host') ?? ''
  if (!LOCAL.test(host) || (origin && !LOCAL.test(origin.replace(/^https?:\/\//, '')))) return c.json({ error: 'Codeglass only accepts requests from this machine' }, 403)
  return next()
})
app.get('/api/contracts', (c) => c.json({ ...contractDescription, outputSchemas: { full: FULL_SCHEMA, patch: PATCH_SCHEMA } }))
app.get('/api/projects/:id/schema-contract', (c) => { const p = registry.get(c.req.param('id')); return p?.analysis ? c.json(schemaContract(p.analysis)) : c.json({ error: 'Project not scanned' }, 404) })
app.post('/mcp', async (c) => {
  const request = await c.req.json().catch(() => null)
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400)
  if (request.id === undefined) return c.body(null, 202)
  return c.json(mcpRequest(registry, request))
})

app.get('/api/settings', async (c) => {
  const settings = getSettings()
  const [claude, codex] = await Promise.all([findClaude(settings.claude.cliPath), findCodex(settings.codex.cliPath)])
  return c.json({ settings, defaults, providers: { claude, codex } })
})
app.put('/api/settings', async (c) => {
  if ([...registry.projects.values()].some((p) => p.mapper.state.status === 'running')) return c.json({ error: 'Wait for mapping to finish or cancel it before changing settings.' }, 409)
  try { return c.json({ settings: saveSettings(await c.req.json()) }) }
  catch (error) { return c.json({ error: (error as Error).message }, 400) }
})

app.get('/api/projects', (c) => c.json(registry.list().map((p) => ({ ...p, hooks: hooksInstalled(p.path, getSettings().provider) }))))

app.post('/api/projects', async (c) => {
  const { path: p } = await c.req.json<{ path: string }>()
  try {
    return c.json(await registry.add(p))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

// In-app folder browser
app.get('/api/fs/list', async (c) => c.json(await listDir(c.req.query('path') || undefined)))

// Native "select folder" dialog (browsers can't expose absolute paths, so the server opens it)
app.post('/api/pick-folder', async (c) => {
  const run = (cmd: string, args: string[]) =>
    new Promise<string>((resolve) =>
      execFile(cmd, args, { timeout: 300_000, windowsHide: false }, (_e, stdout) => resolve(String(stdout ?? '').trim())),
    )
  let picked = ''
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$top = New-Object System.Windows.Forms.Form',
      '$top.TopMost = $true',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$f.Description = 'Select a project folder to visualize'",
      '$f.ShowNewFolderButton = $false',
      "if ($f.ShowDialog($top) -eq 'OK') { [Console]::Out.Write($f.SelectedPath) }",
    ].join('; ')
    picked = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
  } else if (process.platform === 'darwin') {
    picked = (await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select a project folder")'])).replace(/\/$/, '')
  } else {
    picked = await run('zenity', ['--file-selection', '--directory', '--title=Select a project folder'])
  }
  return c.json({ path: picked || null })
})

app.delete('/api/projects/:id', async (c) => {
  // leave nothing behind that still points at Codeglass; the saved map in .codeglass stays for a later re-add
  const leaving = registry.get(c.req.param('id'))
  if (leaving) for (const provider of ['claude', 'codex'] as const) uninstallHooks(leaving.meta.path, provider)
  await registry.remove(c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/api/projects/:id/analysis', (c) => {
  const p = registry.get(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  if (!p.analysis) return c.json({ pending: true }, 202)
  return c.json({
    version: p.version,
    analysis: p.analysis,
    history: p.history.slice(-300),
    hooks: hooksInstalled(p.meta.path, getSettings().provider),
  })
})

// cheap freshness check: clients poll this and reload only what changed
app.get('/api/projects/:id/status', (c) => {
  const p = registry.get(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  return c.json({ version: p.version, archVersion: p.archVersion, mapper: p.mapper.state.status })
})

app.get('/api/projects/:id/architecture', async (c) => {
  const p = registry.get(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  const view = p.architecture()
  if (!view) return c.json({ pending: true }, 202)
  return c.json({ ...view, mapper: p.mapper.state, archVersion: p.archVersion, cli: getSettings().provider === 'codex' ? await findCodex(getSettings().codex.cliPath) : await findClaude(getSettings().claude.cliPath) })
})

app.post('/api/projects/:id/map', async (c) => {
  const p = registry.get(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  const { mode, autoUpdate, cancel, live } = await c.req.json<{ mode?: 'full' | 'update'; autoUpdate?: boolean; cancel?: boolean; live?: boolean }>()
  if (typeof live === 'boolean') p.setLive(live)
  if (cancel) p.mapper.cancel()
  if (typeof autoUpdate === 'boolean') p.mapper.setAutoUpdate(autoUpdate)
  if (mode) void p.runMapper(mode)
  return c.json({ ok: true, state: p.mapper.state })
})

app.post('/api/projects/:id/hooks', async (c) => {
  const p = registry.get(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  const { enable, provider = getSettings().provider } = await c.req.json<{ enable: boolean; provider?: 'claude' | 'codex' }>()
  if (!['claude', 'codex'].includes(provider) || typeof enable !== 'boolean') return c.json({ error: 'Invalid hook settings' }, 400)
  try {
    if (enable) installHooks(p.meta.path, PORT, provider)
    else uninstallHooks(p.meta.path, provider)
  } catch (error) { return c.json({ error: (error as Error).message }, 400) }
  return c.json({ hooks: hooksInstalled(p.meta.path, getSettings().provider) })
})

// Passive lifecycle relay for both providers. No hooks block or modify the coding agent.
app.post('/api/hook', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ ok: false }, 400)
  const provider = c.req.query('provider') === 'codex' ? 'codex' : 'claude'
  return c.json(ingestActivity(registry, body, provider))
})

app.get('/api/stream', (c) =>
  streamSSE(c, async (stream) => {
    let alive = true
    const unsub = registry.subscribe((m) => {
      if (alive) stream.writeSSE({ data: JSON.stringify(m) }).catch(() => {})
    })
    stream.onAbort(() => {
      alive = false
      unsub()
    })
    await stream.writeSSE({ data: JSON.stringify({ type: 'projects' }) })
    while (alive) {
      await stream.sleep(15000)
      await stream.writeSSE({ event: 'ping', data: '1' }).catch(() => (alive = false))
    }
  }),
)

if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  const rel = path.relative(process.cwd(), WEB_DIR).split(path.sep).join('/') || '.'
  app.use('/*', serveStatic({ root: rel }))
  app.get('*', serveStatic({ path: rel + '/index.html' }))
} else {
  app.get('/', (c) => c.text('The Codeglass server is running, but the web UI has not been built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173.'))
}

await registry.load()
for (const arg of cli.projects) {
  try {
    await registry.add(arg)
    console.log('  + project', path.resolve(arg))
  } catch (e) {
    console.error('  ! ', (e as Error).message)
  }
}

const url = `http://localhost:${PORT}`
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Codeglass ${packageVersion()} running at ${url}`)
  console.log('Press Ctrl+C to stop.')
  if (cli.open) openBrowser(url)
})
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Codeglass may already be running at ${url}; otherwise choose another port with --port.`)
  else console.error(e.message)
  process.exit(1)
})
const shutdown = () => {
  for (const p of registry.projects.values()) void p.stop()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
