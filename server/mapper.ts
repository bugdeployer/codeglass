// Runs Claude Code or Codex headlessly to build and update architecture maps.
import { env, LEGACY_PROJECT_DIR, PROJECT_DIR } from './paths.ts'
import { spawn, execFile } from 'node:child_process'
import crypto from 'node:crypto'
import { getSettings } from './settings.ts'
import { findCodex, runCodex } from './codex.ts'
import { contractDescription } from '../shared/contracts.ts'
import { fullMappingPlan } from './mappingPlan.ts'
import type { Provider, VisualizerSettings } from '../shared/settings.ts'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyPatch, heuristic, ownership, PATCH_SCHEMA, PATCH_SYSTEM_PROMPT, patchPrompt, validate,
  type ArchPatch, type Architecture,
} from './arch.ts'
import type { Analysis } from './analyze.ts'

// ---------------- locate the CLI ----------------
let cliCache: { path: string; version: string } | null | undefined
function versionOf(bin: string): Promise<string | null> {
  return new Promise((res) => execFile(bin, ['--version'], { timeout: 15000, windowsHide: true }, (e, out) => res(e ? null : String(out).trim())))
}
export async function findClaude(override = ''): Promise<{ path: string; version: string } | null> {
  if (!override && cliCache) return cliCache
  if (override) {
    const version = await versionOf(override)
    return version && /claude code/i.test(version) ? { path: override, version } : null
  }
  const cands: string[] = []
  if (env('CLAUDE')) cands.push(env('CLAUDE')!)
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    // Claude desktop app bundles the CLI under %LOCALAPPDATA%\Claude-Data\<pkg>\claude-code\<version>\<hash>\claude.exe
    const base = path.join(process.env.LOCALAPPDATA, 'Claude-Data')
    try {
      const found: { p: string; t: number }[] = []
      for (const pkg of fs.readdirSync(base)) {
        const cc = path.join(base, pkg, 'claude-code')
        if (!fs.existsSync(cc)) continue
        for (const ver of fs.readdirSync(cc)) for (const h of fs.readdirSync(path.join(cc, ver))) {
          const exe = path.join(cc, ver, h, 'claude.exe')
          if (fs.existsSync(exe)) found.push({ p: exe, t: fs.statSync(exe).mtimeMs })
        }
      }
      found.sort((a, b) => b.t - a.t).forEach((f) => cands.push(f.p))
    } catch {}
    if (process.env.USERPROFILE) cands.push(path.join(process.env.USERPROFILE, '.local', 'bin', 'claude.exe'))
  }
  if (process.env.HOME) cands.push(path.join(process.env.HOME, '.local', 'bin', 'claude'), path.join(process.env.HOME, '.claude', 'local', 'claude'))
  cands.push(process.platform === 'win32' ? 'claude.exe' : 'claude')
  for (const c of cands) {
    const v = await versionOf(c)
    if (v && /claude code/i.test(v)) return (cliCache = { path: c, version: v })
  }
  return (cliCache = null)
}

// ---------------- state ----------------
export type MapperState = {
  status: 'idle' | 'running' | 'error'
  provider?: Provider
  mode?: 'full' | 'update'
  startedAt?: number
  progress: string[]
  lastError?: string
  lastRun?: { mode: 'full' | 'update'; at: number; tokens: number; costUsd?: number; provider?: Provider; durationMs: number }
  totals: { tokens: number; costUsd: number; runs: number; unpricedRuns?: number }
  pending: number // changed files waiting for an update
  autoUpdate: boolean
  live: boolean // keep the map in step with the code as Claude builds
  sessionIds: string[] // our own headless sessions (their hook events are ignored)
}

/** the parts of a scan that change what the map should say (edits inside a function don't count) */
export type Structure = { files: string[]; routes: string[]; tables: string[]; packages: string[] }
export function structure(a: Analysis): Structure {
  return {
    files: a.files.filter((f) => ['ui', 'api', 'service', 'data'].includes(f.layer)).map((f) => f.path).sort(),
    routes: a.routes.map((r) => `${r.method} ${r.path}`).sort(),
    tables: a.schema.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(',')})`).sort(),
    packages: a.externals.filter((e) => e.category !== 'package').map((e) => e.name).sort(),
  }
}
export function structureDiff(prev: Structure | null, next: Structure): string | null {
  if (!prev) return null
  const lines: string[] = []
  for (const k of ['files', 'routes', 'tables', 'packages'] as const) {
    const p = new Set(prev[k])
    const n = new Set(next[k])
    const add = next[k].filter((x) => !p.has(x))
    const del = prev[k].filter((x) => !n.has(x))
    if (add.length) lines.push(`+ ${k}: ${add.slice(0, 30).join('; ')}`)
    if (del.length) lines.push(`- ${k}: ${del.slice(0, 30).join('; ')}`)
  }
  return lines.length ? lines.join('\n') : null
}

/** a cheap outline of a file: imports, declarations, routes — enough to place it without reading it all */
const OUTLINE_LINE = /^\s*(import|from|export|class|def|async def|function|const \w+ = (async )?\(|interface|type |@\w+\.(get|post|put|patch|delete|route)|router\.|app\.(get|post|put|patch|delete|use)|model |CREATE TABLE|path\()/i
function outline(src: string, max = 1400): string {
  const keep = src.split(/\r?\n/).filter((l, i) => i < 12 || OUTLINE_LINE.test(l))
  const s = keep.join('\n')
  return s.length > max ? s.slice(0, max) + '\n…' : s
}

export class Mapper {
  root: string
  arch: Architecture | null = null // claude-made map (persisted)
  state: MapperState = { status: 'idle', progress: [], totals: { tokens: 0, costUsd: 0, runs: 0 }, pending: 0, autoUpdate: true, live: false, sessionIds: [] }
  baseline: Structure | null = null // structure the current map was made from
  private changed = new Map<string, string>()
  private onChange: () => void
  private settingsSource: () => VisualizerSettings
  private cancelled = false
  private child?: ReturnType<typeof spawn>

  constructor(root: string, onChange: () => void, settingsSource = getSettings) {
    this.settingsSource = settingsSource
    this.root = root
    this.onChange = onChange
    this.load()
  }

  private get dir() {
    return path.join(this.root, PROJECT_DIR)
  }
  private load() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dir, 'architecture.json'), 'utf8'))
      this.arch = j.architecture ?? null
      if (j.totals) this.state.totals = j.totals
      if (typeof j.autoUpdate === 'boolean') this.state.autoUpdate = j.autoUpdate
      if (typeof j.live === 'boolean') this.state.live = j.live
      this.baseline = j.baseline ?? null
    } catch {}
  }
  private save() {
    fs.mkdirSync(this.dir, { recursive: true })
    const gi = path.join(this.dir, '.gitignore')
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n')
    fs.writeFileSync(path.join(this.dir, 'architecture.json'), JSON.stringify({ architecture: this.arch, totals: this.state.totals, autoUpdate: this.state.autoUpdate, live: this.state.live, baseline: this.baseline }, null, 2))
  }

  setLive(v: boolean) {
    this.state.live = v
    if (this.arch) this.save()
    this.onChange()
  }

  /** what changed structurally since the map was made (null = nothing worth a Claude run) */
  drift(a: Analysis) {
    return structureDiff(this.baseline, structure(a))
  }

  setAutoUpdate(v: boolean) {
    this.state.autoUpdate = v
    if (this.arch) this.save()
    this.onChange()
  }

  noteChange(p: string, kind: string) {
    if (p.startsWith(PROJECT_DIR + '/') || p.startsWith(LEGACY_PROJECT_DIR + '/')) return
    this.changed.set(p, kind)
    this.state.pending = this.changed.size
  }

  /** the map to show: Claude's (validated against the latest scan) or the heuristic fallback */
  view(a: Analysis, contentOf: (p: string) => string | undefined) {
    const arch = this.arch ? validate(this.arch, a, contentOf) : heuristic(a)
    // database system modules = data domains, so the DB can be drilled into like any system
    const db = arch.systems.find((s) => s.kind === 'database')
    if (db && !db.modules.length && arch.dataDomains.length) db.modules = arch.dataDomains.map((d) => ({ id: d.id, name: d.name, summary: d.summary, paths: [], keyFiles: [] }))
    return { architecture: arch, fileOwner: ownership(arch, a) }
  }

  ownsSession(id?: string) {
    return !!id && this.state.sessionIds.includes(id)
  }

  cancel() {
    this.cancelled = true
    this.child?.kill()
  }

  async run(mode: 'full' | 'update', a: Analysis, contentOf: (p: string) => string | undefined, auto = false) {
    if (this.state.status === 'running') return
    if (mode === 'update' && !this.arch) mode = 'full'
    const settings = this.settingsSource()
    const provider = settings.provider
    const name = provider === 'codex' ? 'Codex' : 'Claude'
    const cli = provider === 'codex' ? await findCodex(settings.codex.cliPath) : await findClaude(settings.claude.cliPath)
    if (!cli) {
      this.state = { ...this.state, status: 'error', lastError: `${name} CLI not found. Set its executable path in Settings.` }
      return this.onChange()
    }
    if (String(this.state.status) === 'running') return
    this.cancelled = false
    const changed = [...this.changed.entries()].map(([p, kind]) => ({ path: p, kind }))
    const drift = mode === 'update' ? this.drift(a) : null
    // an update only runs when the structure really changed (files added and removed again are just noise)
    if (mode === 'update' && !drift && (auto || !changed.length)) {
      this.changed.clear()
      this.state.pending = 0
      return this.onChange()
    }
    this.changed.clear()
    this.state.pending = 0

    const sessionId = crypto.randomUUID()
    this.state = { ...this.state, status: 'running', provider, mode, startedAt: Date.now(), progress: [mode === 'full' ? 'Reading the project skeleton…' : `Updating map for ${changed.length} changed file(s)…`], lastError: undefined, sessionIds: [...this.state.sessionIds.slice(-20), sessionId] }
    this.onChange()

    const plan = mode === 'full' ? fullMappingPlan(settings[provider].detail, a, contentOf) : null
    const systemPrompt = plan?.systemPrompt ?? PATCH_SYSTEM_PROMPT
    const schema = plan?.schema ?? PATCH_SCHEMA
    const prompt =
      mode === 'full'
        ? plan!.prompt
        : [
            JSON.stringify({ vocabulary: contractDescription }),
            patchPrompt(this.arch!, changed, a),
            drift ? `\nSTRUCTURAL CHANGES SINCE THE MAP WAS MADE:\n${drift}` : '',
            '\nOUTLINES OF CHANGED FILES (you have no tools; place them from these):',
            ...changed
              .filter((c) => c.kind !== 'unlink')
              .slice(0, 10)
              .map((c) => {
                const src = contentOf(c.path)
                return src ? `--- ${c.path}\n${outline(src)}` : ''
              })
              .filter(Boolean),
          ].join('\n')
    const args = [
      '-p',
      '--model', mode === 'full' ? settings.claude.fullModel : settings.claude.updateModel,
      '--output-format', 'stream-json', '--verbose',
      // full map explores; live/updates are one cheap pass with no tools
      '--tools', '', '--effort', mode === 'full' && settings.claude.detail === 'detailed' ? 'medium' : 'low',
      '--setting-sources', 'user',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--session-id', sessionId,
      '--max-budget-usd', mode === 'full' ? String(settings.claude.fullBudget) : String(settings.claude.updateBudget),
      '--append-system-prompt', systemPrompt,
      '--json-schema', JSON.stringify(schema),
    ]

    const t0 = Date.now()
    try {
      const result = provider === 'codex' ? await runCodex({
        cli, root: this.root, model: mode === 'full' ? settings.codex.fullModel : settings.codex.updateModel,
        prompt: `${systemPrompt}\n\n${prompt}`,
        allowTools: false,
        schema,
        timeout: mode === 'full' ? settings.fullTimeout : settings.updateTimeout, maxTools: settings.maxToolCalls,
        onProgress: (message) => { this.state.progress = [...this.state.progress.slice(-30), message]; this.onChange() },
        onChild: (child) => { this.child = child }, isCancelled: () => this.cancelled,
      }) : await new Promise<any>((resolve, reject) => {
        const child = spawn(cli.path, args, { cwd: this.root, windowsHide: true, env: { ...process.env, CODEGLASS_MAPPER: '1', CC_VIZ_MAPPER: '1' } })
        this.child = child
        let buf = ''
        let final: any = null
        let errText = ''
        let tools = 0
        let stopReason = ''
        const stop = (why: string) => {
          if (stopReason) return
          stopReason = why
          child.kill()
        }
        const limit = setTimeout(() => stop(`took longer than ${Math.round((mode === 'full' ? settings.fullTimeout * 1000 : settings.updateTimeout * 1000) / 1000)}s`), mode === 'full' ? settings.fullTimeout * 1000 : settings.updateTimeout * 1000)
        child.stdout.on('data', (d) => {
          buf += d
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (!line) continue
            try {
              const j = JSON.parse(line)
              if (j.type === 'assistant') {
                for (const c of j.message?.content ?? []) {
                  if (c.type !== 'tool_use') continue
                  if (c.name !== 'StructuredOutput' && ++tools > settings.maxToolCalls) stop(`read more than ${settings.maxToolCalls} files/searches`)
                  const inp = c.input ?? {}
                  const target = inp.file_path ? path.relative(this.root, inp.file_path).split(path.sep).join('/') : inp.pattern ?? inp.path ?? ''
                  this.state.progress = [...this.state.progress.slice(-30), `${c.name} ${target}`.trim()]
                  this.onChange()
                }
              } else if (j.type === 'result') final = j
            } catch {}
          }
        })
        child.stderr.on('data', (d) => (errText += d))
        child.on('error', reject)
        child.on('close', (code) => {
          clearTimeout(limit)
          this.child = undefined
          if (this.cancelled) reject(new Error('Mapping cancelled'))
          else if (final) resolve(final)
          else if (stopReason) reject(new Error(`Stopped: Claude ${stopReason}. Nothing was changed — try again, or raise the limit (CODEGLASS_FULL_TIMEOUT / CODEGLASS_MAX_TOOL_CALLS).`))
          else reject(new Error(errText.trim().slice(0, 400) || `claude exited with code ${code}`))
        })
        child.stdin.on('error', () => {})
        child.stdin.write(prompt)
        child.stdin.end()
      })

      const u = result.usage ?? {}
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      const costUsd: number | undefined = result.total_cost_usd
      this.state.totals = { tokens: this.state.totals.tokens + tokens, costUsd: this.state.totals.costUsd + (costUsd ?? 0), runs: this.state.totals.runs + 1, unpricedRuns: (this.state.totals.unpricedRuns ?? 0) + (costUsd === undefined ? 1 : 0) }
      this.state.lastRun = { mode, provider, at: Date.now(), tokens, costUsd, durationMs: Date.now() - t0 }
      const out = result.structured_output
      if (result.is_error || !out) throw new Error(result.subtype === 'error_max_budget_usd' ? 'Stopped at the token budget before finishing — try again or raise CODEGLASS_FULL_BUDGET.' : `${name} returned no map (${result.subtype ?? 'unknown'})`)

      if (mode === 'full' && (!Array.isArray(out.systems) || !Array.isArray(out.flows) || !Array.isArray(out.connections))) throw new Error(`${name} returned an invalid map`)
      if (mode === 'update' && !['upsertSystems', 'removeSystems', 'upsertConnections', 'removeConnections', 'upsertFlows', 'removeFlows'].every((key) => Array.isArray(out[key]))) throw new Error(`${name} returned an invalid update`)
      const now = Date.now()
      if (mode === 'full') {
        const stamp = <T extends object>(x: T) => ({ ...x, createdAt: now, updatedAt: now })
        this.arch = {
          contractVersion: 1,
          source: provider,
          generatedAt: now,
          summary: out.summary ?? '',
          systems: (out.systems ?? []).map((s: any) => stamp({ ...s, modules: (s.modules ?? []).map(stamp) })),
          connections: out.connections ?? [],
          flows: (out.flows ?? []).map(stamp),
          dataDomains: out.dataDomains ?? [],
        }
      } else {
        this.arch = { ...applyPatch(this.arch!, out as ArchPatch, now), source: provider }
      }
      this.baseline = structure(a)
      this.save()
      this.state = { ...this.state, status: 'idle', progress: [...this.state.progress, 'Done.'] }
    } catch (e) {
      // put the changes back so the next update retries them
      for (const c of changed) if (!this.changed.has(c.path)) this.changed.set(c.path, c.kind)
      this.state = { ...this.state, status: 'error', lastError: (e as Error).message, pending: this.changed.size }
    }
    this.onChange()
  }
}
