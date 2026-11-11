// Structural changes between two scans (or two architecture maps): what appeared, what went away.
// These drive the "it just showed up" moments across every view.
import type { Analysis, Architecture } from './types'

export type ChangeKind =
  | 'table-added' | 'table-removed' | 'column-added' | 'column-removed' | 'join-added'
  | 'route-added' | 'route-removed'
  | 'file-added' | 'file-removed'
  | 'package-added'
  | 'system-added' | 'module-added' | 'flow-added' | 'flow-updated' | 'connection-added'

export type Change = {
  id: string
  ts: number
  kind: ChangeKind
  label: string
  detail?: string
  table?: string
  column?: string
  file?: string
  key?: string // system / module / flow id
  by: 'claude' | 'codex' | 'you'
}

export const CHANGE_VIEW: Record<ChangeKind, 'schema' | 'map' | 'flows'> = {
  'table-added': 'schema', 'table-removed': 'schema', 'column-added': 'schema', 'column-removed': 'schema', 'join-added': 'schema',
  'route-added': 'map', 'route-removed': 'map', 'file-added': 'map', 'file-removed': 'map', 'package-added': 'map',
  'system-added': 'map', 'module-added': 'map', 'connection-added': 'map', 'flow-added': 'map', 'flow-updated': 'map',
}

let seq = 0
const mk = (c: Omit<Change, 'id' | 'ts'>, ts: number): Change => ({ ...c, id: `c${++seq}-${ts}`, ts })

export function diffAnalysis(prev: Analysis, next: Analysis, byClaude: (file?: string) => Change['by']): Change[] {
  const ts = Date.now()
  const out: Change[] = []
  const who = (f?: string) => byClaude(f)

  // tables + columns
  const pt = new Map(prev.schema.tables.map((t) => [t.name, t]))
  const nt = new Map(next.schema.tables.map((t) => [t.name, t]))
  for (const [name, t] of nt) {
    const p = pt.get(name)
    if (!p) {
      out.push(mk({ kind: 'table-added', label: `Table ${name}`, detail: `${t.columns.length} columns`, table: name, file: t.source, by: who(t.source) }, ts))
      continue
    }
    const pc = new Set(p.columns.map((c) => c.name))
    for (const c of t.columns) if (!pc.has(c.name)) out.push(mk({ kind: 'column-added', label: `${name}.${c.name}`, detail: c.type, table: name, column: c.name, file: t.source, by: who(t.source) }, ts))
    const nc = new Set(t.columns.map((c) => c.name))
    for (const c of p.columns) if (!nc.has(c.name)) out.push(mk({ kind: 'column-removed', label: `${name}.${c.name}`, table: name, column: c.name, file: t.source, by: who(t.source) }, ts))
  }
  for (const [name, t] of pt) if (!nt.has(name)) out.push(mk({ kind: 'table-removed', label: `Table ${name}`, table: name, file: t.source, by: who(t.source) }, ts))

  // joins (declared)
  const rk = (r: Analysis['schema']['relations'][number]) => `${r.from.table}.${r.from.column}>${r.to.table}`
  const pr = new Set(prev.schema.relations.map(rk))
  for (const r of next.schema.relations) if (!pr.has(rk(r))) out.push(mk({ kind: 'join-added', label: `${r.from.table}.${r.from.column} → ${r.to.table}`, table: r.from.table, by: who(nt.get(r.from.table)?.source) }, ts))

  // routes
  const rkey = (r: Analysis['routes'][number]) => `${r.method} ${r.path}`
  const prs = new Set(prev.routes.map(rkey))
  const nrs = new Set(next.routes.map(rkey))
  for (const r of next.routes) if (!prs.has(rkey(r))) out.push(mk({ kind: 'route-added', label: `${r.method === 'ANY' ? '' : r.method + ' '}${r.path}`, file: r.file, by: who(r.file) }, ts))
  for (const r of prev.routes) if (!nrs.has(rkey(r))) out.push(mk({ kind: 'route-removed', label: `${r.method === 'ANY' ? '' : r.method + ' '}${r.path}`, file: r.file, by: who(r.file) }, ts))

  // code files
  const code = (a: Analysis) => new Set(a.files.filter((f) => ['ui', 'api', 'service', 'data'].includes(f.layer)).map((f) => f.path))
  const pf = code(prev)
  const nf = code(next)
  for (const f of nf) if (!pf.has(f)) out.push(mk({ kind: 'file-added', label: f.split('/').pop()!, detail: f, file: f, by: who(f) }, ts))
  for (const f of pf) if (!nf.has(f)) out.push(mk({ kind: 'file-removed', label: f.split('/').pop()!, detail: f, file: f, by: who(f) }, ts))

  // packages
  const pp = new Set(prev.externals.map((e) => e.name))
  for (const e of next.externals) if (!pp.has(e.name) && e.category !== 'package') out.push(mk({ kind: 'package-added', label: e.name, detail: e.category, file: e.files[0], by: who(e.files[0]) }, ts))
  return out
}

export function diffArch(prev: Architecture, next: Architecture): Change[] {
  if (prev.source === 'heuristic' || next.source === 'heuristic') return []
  const ts = Date.now()
  const out: Change[] = []
  const ps = new Map(prev.systems.map((s) => [s.id, s]))
  for (const s of next.systems) {
    const p = ps.get(s.id)
    if (!p) {
      out.push(mk({ kind: 'system-added', label: s.name, detail: s.summary, key: s.id, by: next.source }, ts))
      continue
    }
    const pm = new Set(p.modules.map((m) => m.id))
    for (const m of s.modules) if (!pm.has(m.id)) out.push(mk({ kind: 'module-added', label: `${m.name}`, detail: `in ${s.name} — ${m.summary}`, key: `${s.id}/${m.id}`, by: next.source }, ts))
  }
  const pf = new Map(prev.flows.map((f) => [f.id, f]))
  const stepsKey = (f: Architecture['flows'][number]) => f.steps.map((s) => `${s.system}/${s.module ?? ''}:${s.action}`).join('|')
  for (const f of next.flows) {
    const p = pf.get(f.id)
    if (!p) out.push(mk({ kind: 'flow-added', label: f.name, detail: f.trigger, key: f.id, by: next.source }, ts))
    else if (stepsKey(p) !== stepsKey(f)) out.push(mk({ kind: 'flow-updated', label: f.name, detail: `${f.steps.length} steps now`, key: f.id, by: next.source }, ts))
  }
  const ck = (c: Architecture['connections'][number]) => `${c.from}>${c.to}>${c.kind}`
  const pc = new Set(prev.connections.map(ck))
  for (const c of next.connections) if (!pc.has(ck(c))) out.push(mk({ kind: 'connection-added', label: c.label, detail: `${c.from} → ${c.to}`, key: c.from, by: next.source }, ts))
  return out
}

/** how "fresh" something is: 'hot' right after it appeared, 'new' for the rest of the session */
export const HOT_MS = 25_000
export function freshness(ts: number | undefined, now = Date.now()): 'hot' | 'new' | null {
  if (!ts) return null
  return now - ts < HOT_MS ? 'hot' : 'new'
}
