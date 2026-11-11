import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getSettings } from './settings.ts'
import { DATA_DIR } from './paths.ts'
import { migrateProjectFolder } from './hooks.ts'
import chokidar, { type FSWatcher } from 'chokidar'
import { Analyzer, HARD_IGNORE, toRel, type Analysis } from './analyze.ts'
import { Mapper, structure, type MapperState } from './mapper.ts'

export type ProjectMeta = { id: string; path: string; name: string; addedAt: number }
export type ActivityEvent = {
  id: number
  ts: number
  source: 'fs' | 'claude' | 'codex'
  kind: string // add|change|unlink | tool name | prompt | stop | session
  path?: string
  phase?: 'pre' | 'post'
  detail?: string
  action?: import('../shared/contracts.ts').ActivityAction
  failed?: boolean
  callId?: string
  sessionId?: string
}
export type StreamMessage =
  | { type: 'projects' }
  | { type: 'analysis'; projectId: string; version: number }
  | { type: 'activity'; projectId: string; ev: ActivityEvent }
  | { type: 'mapper'; projectId: string; state: MapperState; archVersion: number }

const FILE = path.join(DATA_DIR, 'projects.json')

const norm = (p: string) => path.resolve(p).split(path.sep).join('/').replace(/\/+$/, '').toLowerCase()

export class Project {
  analyzer: Analyzer
  mapper: Mapper
  archVersion = 0
  analysis: Analysis | null = null
  version = 0
  history: ActivityEvent[] = []
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private running = false
  private dirty = false
  private seq = 0

  meta: ProjectMeta
  private emit: (m: StreamMessage) => void
  constructor(meta: ProjectMeta, emit: (m: StreamMessage) => void) {
    this.meta = meta
    this.emit = emit
    this.analyzer = new Analyzer(meta.path)
    this.mapper = new Mapper(meta.path, () => {
      if (this.mapper?.state.status !== 'running') this.archVersion++
      this.emit({ type: 'mapper', projectId: this.meta.id, state: this.mapper.state, archVersion: this.archVersion })
    })
  }

  /** architecture view for the client (Claude map or heuristic), resolved against the latest scan */
  architecture() {
    if (!this.analysis) return null
    return this.mapper.view(this.analysis, (p) => this.analyzer.contentOf(p))
  }

  async runMapper(mode: 'full' | 'update', auto = false) {
    if (!this.analysis) await this.refresh()
    if (this.analysis) await this.mapper.run(mode, this.analysis, (p) => this.analyzer.contentOf(p), auto)
    if (this.mapper.state.live) this.maybeLive('scan') // structure may have moved on while Claude was thinking
  }

  // ---------- live mode: fold structural changes into the map as they happen ----------
  private liveTimer?: NodeJS.Timeout
  static QUIET_MS = 15_000 // wait for a pause in edits so one run covers a whole burst
  setLive(on: boolean) {
    if (on && this.mapper.arch && !this.mapper.baseline && this.analysis) this.mapper.baseline = structure(this.analysis) // treat the current map as in sync
    this.mapper.setLive(on)
    clearTimeout(this.liveTimer)
    if (!on) return
    if (!this.mapper.arch) void this.runMapper('full')
    else this.maybeLive('stop')
  }
  maybeLive(reason: 'scan' | 'stop') {
    if (!this.mapper.state.live || !this.analysis || !this.mapper.arch) return
    if (!this.mapper.drift(this.analysis)) {
      clearTimeout(this.liveTimer) // structure is back to what the map describes: nothing to do
      return
    }
    clearTimeout(this.liveTimer)
    this.liveTimer = setTimeout(() => {
      if (this.mapper.state.status === 'running') return this.maybeLive('scan')
      void this.runMapper('update', true)
    }, reason === 'stop' ? 1500 : getSettings().liveDelay * 1000)
  }

  async start() {
    await this.refresh()
    this.watcher = chokidar.watch(this.meta.path, {
      ignoreInitial: true,
      ignored: (p) => {
        const rel = toRel(this.meta.path, p)
        return !!rel && rel.split('/').some((s) => HARD_IGNORE.has(s))
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    })
    const on = (kind: string) => (abs: string) => {
      const rel = toRel(this.meta.path, abs)
      if (!rel) return
      this.push({ source: 'fs', kind, path: rel })
      this.mapper.noteChange(rel, kind)
      this.schedule()
    }
    this.watcher
      .on('add', on('add'))
      .on('change', on('change'))
      .on('unlink', on('unlink'))
      .on('addDir', () => this.schedule())
      .on('unlinkDir', () => this.schedule())
  }

  push(ev: Omit<ActivityEvent, 'id' | 'ts'> & { ts?: number }) {
    const full: ActivityEvent = { ...ev, id: ++this.seq, ts: ev.ts ?? Date.now() }
    this.history.push(full)
    if (this.history.length > 500) this.history.shift()
    this.emit({ type: 'activity', projectId: this.meta.id, ev: full })
    // Claude finished a turn: update the map right away (live mode)
    if (full.source !== 'fs' && full.kind === 'stop') this.maybeLive('stop')
  }

  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.refresh(), 450)
  }

  async refresh() {
    if (this.running) {
      this.dirty = true
      return
    }
    this.running = true
    try {
      this.analysis = await this.analyzer.run()
      this.version++
      this.emit({ type: 'analysis', projectId: this.meta.id, version: this.version })
      this.maybeLive('scan')
    } catch (e) {
      console.error('analysis failed', this.meta.path, e)
    } finally {
      this.running = false
      if (this.dirty) {
        this.dirty = false
        this.schedule()
      }
    }
  }

  async stop() {
    clearTimeout(this.timer)
    clearTimeout(this.liveTimer)
    this.mapper.cancel()
    await this.watcher?.close()
  }
}

export class Registry {
  projects = new Map<string, Project>()
  /** port the hook relays call back on (set by the server before projects load) */
  hookPort = 4777
  private subs = new Set<(m: StreamMessage) => void>()

  subscribe(fn: (m: StreamMessage) => void) {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }
  private emit = (m: StreamMessage) => this.subs.forEach((s) => s(m))

  list() {
    return [...this.projects.values()].map((p) => ({
      ...p.meta,
      version: p.version,
      files: p.analysis?.stats.files,
      loc: p.analysis?.stats.loc,
    }))
  }

  async load() {
    try {
      const saved: ProjectMeta[] = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      for (const m of saved) if (fs.existsSync(m.path)) await this.add(m.path, false)
    } catch {}
  }

  private persist() {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify([...this.projects.values()].map((p) => p.meta), null, 2))
  }

  async add(p: string, persist = true): Promise<ProjectMeta> {
    const abs = path.resolve(p.trim().replace(/^["']|["']$/g, ''))
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a directory: ${abs}`)
    const id = crypto.createHash('sha1').update(norm(abs)).digest('hex').slice(0, 10)
    const existing = this.projects.get(id)
    if (existing) return existing.meta
    migrateProjectFolder(abs, this.hookPort)
    const meta: ProjectMeta = { id, path: abs, name: path.basename(abs), addedAt: Date.now() }
    const proj = new Project(meta, this.emit)
    this.projects.set(id, proj)
    this.emit({ type: 'projects' })
    if (persist) this.persist()
    proj.start().then(() => this.emit({ type: 'projects' }))
    return meta
  }

  async remove(id: string) {
    const p = this.projects.get(id)
    if (!p) return
    await p.stop()
    this.projects.delete(id)
    this.persist()
    this.emit({ type: 'projects' })
  }

  get(id: string) {
    return this.projects.get(id)
  }

  /** find the project that owns a path (deepest match wins) */
  owner(absPath: string): Project | undefined {
    const n = norm(absPath)
    let best: Project | undefined
    for (const p of this.projects.values()) {
      const r = norm(p.meta.path)
      if ((n === r || n.startsWith(r + '/')) && (!best || r.length > norm(best.meta.path).length)) best = p
    }
    return best
  }
}
