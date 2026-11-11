// Turns scan + architecture into a zoomable graph: systems → modules → files/tables.
// Every edge is derived from real evidence (imports, HTTP calls matched to routes, table access, SDK usage, foreign keys),
// plus Claude's semantic connections where the scanner can't see them (events, queues…).
import { connectionKind, CONNECTION_LABEL, type IOContract } from '../../shared/contracts'
import type { Analysis, ArchModule, ArchSystem, Architecture } from './types'

export type Focus = { system?: string; module?: string }
export type LeafKind = 'file' | 'table' | 'pkg'
export type NodeKind = 'system' | 'module' | 'leaf'

export type MapNode = {
  key: string
  kind: NodeKind
  leafKind?: LeafKind
  ghost: boolean // neighbour outside the current focus
  system?: ArchSystem
  module?: ArchModule
  label: string
  sub?: string
  files: string[] // files rolled up under this node
  tables: string[]
}
export type MapEdge = Partial<IOContract> & {
  key: string
  source: string
  target: string
  kinds: Record<string, number>
  labels: string[]
  files: string[]
  claudeLabel?: string
}

const CODE_LAYERS = new Set(['ui', 'api', 'service', 'data'])
export const OTHER = '~'

export class Model {
  a: Analysis
  arch: Architecture
  owner: Record<string, string>
  sys = new Map<string, ArchSystem>()
  db?: ArchSystem
  tableDomain = new Map<string, string>()
  tableOwner = new Map<string, string>() // table -> capability that owns it
  pkgSystem = new Map<string, string>()

  constructor(a: Analysis, arch: Architecture, fileOwner: Record<string, string>) {
    this.a = a
    this.arch = arch
    this.owner = fileOwner
    for (const s of arch.systems) this.sys.set(s.id, s)
    this.db = arch.systems.find((s) => s.kind === 'database')
    for (const d of arch.dataDomains) for (const t of d.tables) this.tableDomain.set(t, d.id)
    for (const s of arch.systems) for (const t of s.tables ?? []) this.tableOwner.set(t, s.id)
    for (const s of arch.systems) for (const p of s.packages) if (s.kind === 'external' || s.kind === 'database') this.pkgSystem.set(p, s.id)
  }

  /** [system, module?] that owns a leaf */
  chain(leaf: string): [string, string?] | null {
    const [t, ...rest] = leaf.split(':')
    const name = rest.join(':')
    if (t === 'f') {
      // A creation's pre-event can arrive before the scanner knows the file.
      // Use only explicit mapped ownership rules, never neighbouring-file guesses.
      const o = this.owner[name] ?? this.arch.systems.flatMap(s => [
        ...s.paths.map(prefix => ({ prefix, key: s.id })),
        ...s.modules.flatMap(m => m.paths.map(prefix => ({ prefix, key: `${s.id}/${m.id}` }))),
      ]).sort((a, b) => b.prefix.length - a.prefix.length || b.key.length - a.key.length)
        .find(rule => name === rule.prefix || name.startsWith(rule.prefix + '/'))?.key
      if (!o) return null
      const [s, m] = o.split('/')
      return [s, m]
    }
    if (t === 't') {
      const own = this.tableOwner.get(name)
      if (own) return [own]
      if (!this.db) return null
      const d = this.tableDomain.get(name)
      return d && this.db.modules.some((m) => m.id === d) ? [this.db.id, d] : [this.db.id]
    }
    if (t === 'p') {
      const s = this.pkgSystem.get(name)
      return s ? [s] : null
    }
    return null
  }

  /** what a leaf collapses to when looking at `focus` */
  visible(leaf: string, focus: Focus): string | null {
    const c = this.chain(leaf)
    if (!c) return null
    const [s, m] = c
    if (!focus.system) return s
    if (s !== focus.system) return s
    // a capability's own tables are cards of their own inside it (not folded into "Other")
    if (!focus.module) return leaf.startsWith('t:') && !m && this.tableOwner.has(leaf.slice(2)) ? leaf : `${s}/${m ?? OTHER}`
    if ((m ?? OTHER) === focus.module) return leaf
    return `${s}/${m ?? OTHER}`
  }

  private visibleRef(ref: string, focus: Focus): string | null {
    // Claude connection endpoints: "system" or "system/module"
    const [s, m] = ref.split('/')
    if (!this.sys.has(s)) return null
    if (!focus.system || s !== focus.system) return s
    if (!focus.module) return m ? `${s}/${m}` : null
    if (m && m !== focus.module) return `${s}/${m}`
    return null
  }

  /** all evidence links at leaf level */
  leafLinks(): { a: string; b: string; kind: string; label?: string; file?: string }[] {
    const out: { a: string; b: string; kind: string; label?: string; file?: string }[] = []
    const code = new Set(this.a.files.filter((f) => CODE_LAYERS.has(f.layer) || this.owner[f.path]).map((f) => f.path))
    for (const e of this.a.edges) if (code.has(e.from) && code.has(e.to)) out.push({ a: `f:${e.from}`, b: `f:${e.to}`, kind: 'import', file: e.from })
    for (const c of this.a.calls) if (c.to) out.push({ a: `f:${c.from}`, b: `f:${c.to}`, kind: 'http', label: c.method ? `${c.method} ${c.url}` : c.url, file: c.from })
    for (const d of this.a.dbAccess) out.push({ a: `f:${d.file}`, b: `t:${d.table}`, kind: 'data', label: d.table, file: d.file })
    for (const x of this.a.externals) if (this.pkgSystem.has(x.name)) for (const f of x.files) out.push({ a: `f:${f}`, b: `p:${x.name}`, kind: this.sys.get(this.pkgSystem.get(x.name)!)?.kind === 'database' ? 'data' : 'sdk', label: x.name, file: f })
    for (const r of this.a.schema.relations) out.push({ a: `t:${r.from.table}`, b: `t:${r.to.table}`, kind: 'fk', label: `${r.from.table}.${r.from.column} = ${r.to.table}.${r.to.column ?? 'id'}` })
    return out
  }

  /** nodes + aggregated edges for a focus level */
  graph(focus: Focus): { nodes: MapNode[]; edges: MapEdge[] } {
    const edges = new Map<string, MapEdge>()
    const touch = (src: string, dst: string, kind: string, label?: string, file?: string) => {
      if (src === dst) return
      const k = `${src}→${dst}:${connectionKind(kind)}`
      const e = edges.get(k) ?? { key: k, source: src, target: dst, kinds: {}, labels: [], files: [] }
      e.kinds[kind] = (e.kinds[kind] ?? 0) + 1
      if (label && !e.labels.includes(label) && e.labels.length < 12) e.labels.push(label)
      if (file && !e.files.includes(file) && e.files.length < 40) e.files.push(file)
      edges.set(k, e)
    }
    for (const l of this.leafLinks()) {
      const a = this.visible(l.a, focus)
      const b = this.visible(l.b, focus)
      if (a && b) touch(a, b, l.kind, l.label, l.file)
    }
    for (const c of this.arch.connections) {
      const a = this.visibleRef(c.from, focus)
      const b = this.visibleRef(c.to, focus)
      if (!a || !b || a === b) continue
      touch(a, b, connectionKind(c.kind), undefined, c.evidence[0])
      const e = edges.get(`${a}→${b}:${connectionKind(c.kind)}`)!
      if (!e.claudeLabel) e.claudeLabel = c.label
      e.input = [...new Map([...(e.input ?? []), ...(c.input ?? [])].map(f => [f.name, f])).values()]
      e.output = [...new Map([...(e.output ?? []), ...(c.output ?? [])].map(f => [f.name, f])).values()]
    }

    // nodes inside the focus
    const nodes = new Map<string, MapNode>()
    const fileMap = new Map<string, string[]>()
    const tableMap = new Map<string, string[]>()
    const addLeafTo = (leaf: string) => {
      const v = this.visible(leaf, focus)
      if (!v) return
      const [t, ...rest] = leaf.split(':')
      const name = rest.join(':')
      if (t === 'f') fileMap.set(v, [...(fileMap.get(v) ?? []), name])
      if (t === 't') tableMap.set(v, [...(tableMap.get(v) ?? []), name])
    }
    for (const f of this.a.files) addLeafTo(`f:${f.path}`)
    for (const t of this.a.schema.tables) addLeafTo(`t:${t.name}`)

    const inFocus = (key: string) => {
      if (!focus.system) return !key.includes('/') && !key.includes(':')
      if (!focus.module) return key.startsWith(focus.system + '/') || (key.startsWith('t:') && this.tableOwner.get(key.slice(2)) === focus.system)
      return key.includes(':') && this.visible(key, focus) === key
    }
    const make = (key: string, ghost: boolean): MapNode => {
      if (key.includes(':')) {
        const [t, ...rest] = key.split(':')
        const name = rest.join(':')
        const leafKind: LeafKind = t === 'f' ? 'file' : t === 't' ? 'table' : 'pkg'
        return { key, kind: 'leaf', leafKind, ghost, label: leafKind === 'file' ? name.split('/').pop()! : name, sub: leafKind === 'file' ? name.slice(0, name.lastIndexOf('/')) : undefined, files: leafKind === 'file' ? [name] : [], tables: leafKind === 'table' ? [name] : [] }
      }
      const [s, m] = key.split('/')
      const system = this.sys.get(s)
      if (m) {
        const module = system?.modules.find((x) => x.id === m)
        return { key, kind: 'module', ghost, system, module, label: module?.name ?? 'Other files', sub: module?.summary, files: fileMap.get(key) ?? [], tables: tableMap.get(key) ?? [] }
      }
      return { key, kind: 'system', ghost, system, label: system?.name ?? s, sub: system?.summary, files: fileMap.get(key) ?? [], tables: tableMap.get(key) ?? [] }
    }

    // members of the focus (even unconnected)
    if (!focus.system) for (const s of this.arch.systems) nodes.set(s.id, make(s.id, false))
    else if (!focus.module) {
      const s = this.sys.get(focus.system)
      for (const m of s?.modules ?? []) nodes.set(`${focus.system}/${m.id}`, make(`${focus.system}/${m.id}`, false))
      if (fileMap.has(`${focus.system}/${OTHER}`) || tableMap.has(`${focus.system}/${OTHER}`)) nodes.set(`${focus.system}/${OTHER}`, make(`${focus.system}/${OTHER}`, false))
      for (const t of s?.tables ?? []) if (this.a.schema.tables.some((x) => x.name === t)) nodes.set(`t:${t}`, make(`t:${t}`, false))
    } else {
      for (const f of this.a.files) {
        const key = `f:${f.path}`
        if (this.visible(key, focus) === key && (CODE_LAYERS.has(f.layer) || f.layer === 'data' || this.a.schema.tables.some((t) => t.source === f.path))) nodes.set(key, make(key, false))
      }
      for (const t of this.a.schema.tables) {
        const key = `t:${t.name}`
        if (this.visible(key, focus) === key) nodes.set(key, make(key, false))
      }
    }
    // neighbours that appear in edges
    for (const e of edges.values()) for (const k of [e.source, e.target]) if (!nodes.has(k)) nodes.set(k, make(k, !inFocus(k)))
    // drop edges between two ghosts
    const list = [...edges.values()].filter((e) => !(nodes.get(e.source)?.ghost && nodes.get(e.target)?.ghost))
    return { nodes: [...nodes.values()], edges: list }
  }

  /** where a file sits at a given focus (for activity overlays) */
  keyForFile(path: string, focus: Focus) {
    return this.visible(`f:${path}`, focus)
  }
}

export function dominantKind(kinds: Record<string, number>): string {
  const order = ['http', 'read', 'write', 'data', 'sdk', 'event', 'queue', 'render', 'fk', 'other', 'import']
  return order.find((k) => kinds[k]) ?? 'import'
}

export function edgeSummary(e: MapEdge): string {
  const type = dominantKind(e.kinds)
  if (e.claudeLabel) return `${CONNECTION_LABEL[connectionKind(type)]} · ${e.claudeLabel}`
  const k = dominantKind(e.kinds)
  const n = e.kinds[k]
  if (k === 'http') return `${CONNECTION_LABEL.http} · ` + e.labels.slice(0, 2).join(', ') + (e.labels.length > 2 ? ` +${e.labels.length - 2}` : '')
  if (k === 'data' || k === 'read' || k === 'write') return `${CONNECTION_LABEL[connectionKind(k)]} · ${e.labels.slice(0, 2).join(', ')}${e.labels.length > 2 ? ` +${e.labels.length - 2}` : ''}`
  if (k === 'sdk') return `${CONNECTION_LABEL.sdk} · ${e.labels.slice(0, 2).join(', ')}`
  if (k === 'fk') return `${CONNECTION_LABEL.fk} · ${e.labels[0] ?? 'relationship'}`
  return `${CONNECTION_LABEL[connectionKind(k)]} ×${n}`
}
