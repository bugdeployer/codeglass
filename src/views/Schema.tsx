import { useEffect, useMemo, useRef, useState } from 'react'
import { Controls, MiniMap, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Copy, Database, Route, X, GripVertical, LocateFixed, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { layoutDagre, TableNode, type TableNodeData } from '@/components/flow'
import { labelBg, neonEdgeTypes } from '@/components/NeonEdge'
import { useArch } from '@/lib/arch'
import { useActivities } from '@/lib/activity-context'
import { IOFields } from '@/components/IOFields'
import { valueType, type SchemaLinkKind } from '@shared/contracts'
import { usePreferences } from '@/lib/preferences'
import { EdgeKey } from '@/components/EdgeKey'
import { NEON, JOIN_COLOR, JOIN_DASH } from '@/lib/colors'
import { useIndex } from '@/lib/graph'
import { useProject } from '@/lib/store'
import { freshness } from '@/lib/changes'
import { applySchemaPins, readSchemaPins, saveSchemaPins, schemaAbsoluteX, schemaLayoutKey, type SchemaPins } from '@/lib/schemaLayout'
import { useMorph } from '@/lib/morph'
import type { Analysis, Table } from '@/lib/types'
import { cn } from '@/lib/utils'

const NODE_W = 240
const tableH = (t: Table) => 38 + Math.min(t.columns.length, 18) * 25 + (t.columns.length > 18 ? 22 : 0)

type DomainData = { name: string; summary?: string; w: number; h: number; color: string }
function DomainNode({ data }: NodeProps<Node<DomainData>>) {
  return (
    <div className="pointer-events-none rounded-2xl border border-dashed" style={{ width: data.w, height: data.h, borderColor: `${data.color}40`, background: `${data.color}06` }}>
      <div className="schema-group-handle pointer-events-auto cursor-grab px-4 pt-3 active:cursor-grabbing" title="Drag this group to move all its tables">
        <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: data.color, textShadow: `0 0 12px ${data.color}` }}>
          <GripVertical className="size-3 shrink-0" />{data.name}
        </div>
        {data.summary && <div className="max-w-md truncate text-[11px] text-muted-foreground">{data.summary}</div>}
      </div>
    </div>
  )
}
const nodeTypes = { table: TableNode, domain: DomainNode }
const DOMAIN_COLORS = [NEON.lime, NEON.cyan, NEON.violet, NEON.amber, NEON.magenta, NEON.blue]

/** one join between two tables, with how it's known */
type Join = {
  id: string
  a: string
  ac?: string
  b: string
  bc?: string
  kind: SchemaLinkKind
  card: '1:1' | 'N:1' | 'M:N' | '?'
  label: string
  usedIn: string[]
  count: number
  via?: string
}

function buildJoins(a: Analysis, collapseJunctions: boolean): { joins: Join[]; hidden: Set<string> } {
  const s = a.schema
  const hidden = new Set(collapseJunctions ? s.junctions.map((j) => j.table) : [])
  const joins: Join[] = []
  const pairKey = (x: string, xc: string | undefined, y: string, yc: string | undefined) => [`${x}.${xc ?? ''}`, `${y}.${yc ?? ''}`].sort().join('|')
  const declared = new Set<string>()
  const codeUse = new Map<string, { files: string[]; count: number }>()
  for (const c of s.codeJoins ?? []) codeUse.set(pairKey(c.a.table, c.a.column, c.b.table, c.b.column), { files: c.files, count: c.count })
  const tablePairUse = (x: string, y: string) => (s.codeJoins ?? []).filter((c) => (c.a.table === x && c.b.table === y) || (c.a.table === y && c.b.table === x))

  s.relations.forEach((r, i) => {
    if (hidden.has(r.from.table) || hidden.has(r.to.table)) return
    const toCol = r.to.column ?? 'id'
    const k = pairKey(r.from.table, r.from.column, r.to.table, toCol)
    declared.add(k)
    declared.add([r.from.table, r.to.table].sort().join('|'))
    const use = codeUse.get(k) ?? tablePairUse(r.from.table, r.to.table).reduce((acc, c) => ({ files: [...acc.files, ...c.files], count: acc.count + c.count }), { files: [] as string[], count: 0 })
    joins.push({
      id: `fk${i}`,
      a: r.from.table,
      ac: r.from.column,
      b: r.to.table,
      bc: toCol,
      kind: 'fk',
      card: r.cardinality ?? 'N:1',
      label: `${r.from.table}.${r.from.column} = ${r.to.table}.${toCol}`,
      usedIn: [...new Set(use.files)],
      count: use.count,
    })
  })
  if (collapseJunctions)
    for (const j of s.junctions) {
      const use = tablePairUse(j.a, j.table).concat(tablePairUse(j.b, j.table))
      joins.push({ id: `m2m-${j.table}`, a: j.a, b: j.b, kind: 'many_to_many', card: 'M:N', label: `${j.a} ⇄ ${j.b} via ${j.table}`, via: j.table, usedIn: [...new Set(use.flatMap((u) => u.files))], count: use.reduce((n, u) => n + u.count, 0) })
    }
  ;(s.codeJoins ?? []).forEach((c, i) => {
    if (hidden.has(c.a.table) || hidden.has(c.b.table)) return
    if (declared.has(pairKey(c.a.table, c.a.column, c.b.table, c.b.column)) || declared.has([c.a.table, c.b.table].sort().join('|'))) return
    joins.push({
      id: `code${i}`,
      a: c.a.table,
      ac: c.a.column,
      b: c.b.table,
      bc: c.b.column,
      kind: 'code_join',
      card: '?',
      label: c.a.column ? `${c.a.table}.${c.a.column} = ${c.b.table}.${c.b.column}` : `${c.a.table} ⋈ ${c.b.table}`,
      usedIn: c.files,
      count: c.count,
    })
  })
  return { joins, hidden }
}

function shortestPath(joins: Join[], from: string, to: string, junctionOf: Map<string, { table: string; a: string; b: string }>): Join[] | null {
  if (from === to) return []
  const adj = new Map<string, { j: Join; next: string }[]>()
  const add = (x: string, j: Join, y: string) => adj.set(x, [...(adj.get(x) ?? []), { j, next: y }])
  for (const j of joins) {
    add(j.a, j, j.b)
    add(j.b, j, j.a)
  }
  void junctionOf
  const prev = new Map<string, { j: Join; from: string }>()
  const q = [from]
  const seen = new Set([from])
  while (q.length) {
    const cur = q.shift()!
    if (cur === to) break
    for (const { j, next } of adj.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, { j, from: cur })
      q.push(next)
    }
  }
  if (!prev.has(to)) return null
  const path: Join[] = []
  let cur = to
  while (cur !== from) {
    const p = prev.get(cur)!
    path.unshift(p.j)
    cur = p.from
  }
  return path
}

function sqlFor(path: Join[], from: string, a: Analysis): string {
  const lines = [`SELECT *`, `FROM ${from}`]
  let cur = from
  for (const j of path) {
    if (j.kind === 'many_to_many' && j.via) {
      const jt = a.schema.relations.filter((r) => r.from.table === j.via)
      const toCur = jt.find((r) => r.to.table === cur)
      const next = cur === j.a ? j.b : j.a
      const toNext = jt.find((r) => r.to.table === next)
      if (toCur) lines.push(`JOIN ${j.via} ON ${j.via}.${toCur.from.column} = ${cur}.${toCur.to.column ?? 'id'}`)
      if (toNext) lines.push(`JOIN ${next} ON ${next}.${toNext.to.column ?? 'id'} = ${j.via}.${toNext.from.column}`)
      cur = next
      continue
    }
    const next = j.a === cur ? j.b : j.a
    const [nc, cc] = j.a === cur ? [j.bc, j.ac] : [j.ac, j.bc]
    lines.push(nc && cc ? `JOIN ${next} ON ${next}.${nc} = ${cur}.${cc}` : `JOIN ${next} ON /* see code */ TRUE`)
    cur = next
  }
  return lines.join('\n')
}

/**
 * Lay out one domain: joined groups get a dagre layout, standalone tables a compact grid,
 * then the blocks are shelf-packed so the result stays roughly screen-shaped.
 */
function packTables(names: string[], joins: Join[], byName: Map<string, Table>): Node<TableNodeData>[] {
  const set = new Set(names)
  const parent = new Map(names.map((n) => [n, n]))
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!))
  const inner = joins.filter((j) => set.has(j.a) && set.has(j.b))
  for (const j of inner) parent.set(find(j.a), find(j.b))
  const comps = new Map<string, string[]>()
  for (const n of names) comps.set(find(n), [...(comps.get(find(n)) ?? []), n])
  const mk = (t: string): Node<TableNodeData> => ({ id: t, type: 'table', position: { x: 0, y: 0 }, data: { name: t, columns: byName.get(t)!.columns, kind: byName.get(t)!.kind } })
  const size = (n: Node<TableNodeData>) => ({ w: NODE_W, h: tableH(byName.get(n.id)!) })

  type Block = { nodes: Node<TableNodeData>[]; w: number; h: number }
  const blocks: Block[] = []
  const singles: string[] = []
  for (const c of comps.values()) {
    if (c.length === 1) {
      singles.push(c[0])
      continue
    }
    const cs = new Set(c)
    const laid = layoutDagre(c.map(mk), inner.filter((j) => cs.has(j.a)).map((j) => ({ id: j.id, source: j.a, target: j.b })), size, { dir: 'LR', ranksep: 110, nodesep: 36 })
    const minX = Math.min(...laid.map((n) => n.position.x))
    const minY = Math.min(...laid.map((n) => n.position.y))
    const nodes = laid.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } }))
    blocks.push({ nodes, w: Math.max(...nodes.map((n) => n.position.x + NODE_W)), h: Math.max(...nodes.map((n) => n.position.y + tableH(byName.get(n.id)!))) })
  }
  if (singles.length) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(singles.length * 1.4)))
    const nodes: Node<TableNodeData>[] = []
    let y = 0
    for (let r = 0; r * cols < singles.length; r++) {
      const row = singles.slice(r * cols, r * cols + cols)
      row.forEach((t, i) => nodes.push({ ...mk(t), position: { x: i * (NODE_W + 36), y } }))
      y += Math.max(...row.map((t) => tableH(byName.get(t)!))) + 36
    }
    blocks.push({ nodes, w: Math.min(singles.length, cols) * (NODE_W + 36) - 36, h: y - 36 })
  }
  // shelf-pack blocks, biggest first
  blocks.sort((a, b) => b.h - a.h)
  const total = blocks.reduce((s, b) => s + b.w * b.h, 0)
  const maxW = Math.max(Math.sqrt(total * 1.8), ...blocks.map((b) => b.w))
  const out: Node<TableNodeData>[] = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const b of blocks) {
    if (x > 0 && x + b.w > maxW) {
      x = 0
      y += rowH + 70
      rowH = 0
    }
    for (const n of b.nodes) out.push({ ...n, position: { x: n.position.x + x, y: n.position.y + y } })
    x += b.w + 90
    rowH = Math.max(rowH, b.h)
  }
  return out
}

function CrowMarkers() {
  const defs: [string, string][] = [
    ['lime', NEON.lime],
    ['pink', JOIN_COLOR.many_to_many],
    ['amber', JOIN_COLOR.code_join],
  ]
  return (
    <svg width="0" height="0" className="absolute">
      <defs>
        {defs.map(([n, c]) => (
          <g key={n}>
            <marker id={`one-${n}`} viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M9 2 V14 M12 2 V14" stroke={c} strokeWidth="1.6" fill="none" />
            </marker>
            <marker id={`many-${n}`} viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M5 8 L15 2 M5 8 L15 8 M5 8 L15 14 M4 2 V14" stroke={c} strokeWidth="1.6" fill="none" />
            </marker>
          </g>
        ))}
      </defs>
    </svg>
  )
}

export function Schema() {
  const { settings } = usePreferences()
  const activities = useActivities()
  const { analysis, heat, changes } = useProject()
  const { arch } = useArch()
  const idx = useIndex()
  const [sel, setSel] = useState<string | null>(null)
  const [collapse, setCollapse] = useState(true)
  const storageKey = schemaLayoutKey(analysis?.root ?? '', collapse)
  const [manual, setManual] = useState<{ key: string; pins: SchemaPins }>(() => ({ key: storageKey, pins: readSchemaPins(storageKey) }))
  const pins = useMemo(() => manual.key === storageKey ? manual.pins : readSchemaPins(storageKey), [manual, storageKey])
  const flow = useRef<ReactFlowInstance | null>(null)
  const [pathFrom, setPathFrom] = useState('')
  const [pathTo, setPathTo] = useState('')
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(i)
  }, [])

  const data = useMemo(() => (analysis ? buildJoins(analysis, collapse) : null), [analysis, collapse])

  const path = useMemo(() => {
    if (!analysis || !data || !pathFrom || !pathTo) return null
    return shortestPath(data.joins, pathFrom, pathTo, new Map())
  }, [analysis, data, pathFrom, pathTo])
  const pathTables = useMemo(() => {
    if (!path || !pathFrom) return null
    const s = new Set([pathFrom])
    let cur = pathFrom
    for (const j of path) {
      cur = j.a === cur ? j.b : j.a
      s.add(cur)
      if (j.via) s.add(j.via)
    }
    return s
  }, [path, pathFrom])

  // layout: one dagre cluster per data domain, clusters flowed into rows
  const layout = useMemo(() => {
    if (!analysis || !data) return null
    const tables = analysis.schema.tables.filter((t) => !data.hidden.has(t.name))
    const byName = new Map(tables.map((t) => [t.name, t]))
    const domains = (arch?.dataDomains ?? []).map((d) => ({ ...d, tables: d.tables.filter((t) => byName.has(t)) })).filter((d) => d.tables.length)
    const placed = new Set(domains.flatMap((d) => d.tables))
    const rest = tables.filter((t) => !placed.has(t.name)).map((t) => t.name)
    if (rest.length) domains.push({ id: '_other', name: domains.length ? 'Other tables' : 'All tables', summary: '', tables: rest })

    const nodes: Node[] = []
    let x = 0
    let y = 0
    let rowH = 0
    const MAX_W = 2600
    domains.forEach((d, di) => {
      const laid = packTables(d.tables, data.joins, byName)
      const minX = Math.min(...laid.map((n) => n.position.x))
      const minY = Math.min(...laid.map((n) => n.position.y))
      const maxX = Math.max(...laid.map((n) => n.position.x + NODE_W))
      const maxY = Math.max(...laid.map((n) => n.position.y + tableH(byName.get(n.id)!)))
      const w = maxX - minX + 80
      const h = maxY - minY + 100
      if (x > 0 && x + w > MAX_W) {
        x = 0
        y += rowH + 60
        rowH = 0
      }
      const color = DOMAIN_COLORS[di % DOMAIN_COLORS.length]
      const parentId = `domain:${d.id}`
      nodes.push({ id: parentId, type: 'domain', position: { x, y }, style: { width: w, height: h }, data: { name: d.name, summary: d.summary, w, h, color }, draggable: true, dragHandle: '.schema-group-handle', selectable: false, zIndex: -1 })
      for (const n of laid) nodes.push({ ...n, parentId, extent: [[24, 64], [w - 24, h - 24]], initialWidth: NODE_W, initialHeight: tableH(byName.get(n.id)!), draggable: true, dragHandle: '.schema-table-handle', position: { x: 40 + n.position.x - minX, y: 70 + n.position.y - minY } })
      x += w + 60
      rowH = Math.max(rowH, h)
    })
    return { nodes, byName }
  }, [analysis, data, arch])

  const positioned = useMemo(() => layout ? applySchemaPins(layout.nodes, pins) : [], [layout, pins])
  const { nodes, edges } = useMemo(() => {
    if (!layout || !data || !analysis) return { nodes: [] as Node[], edges: [] as Edge[] }
    const pos = new Map(positioned.map((n) => [n.id, schemaAbsoluteX(n, positioned)]))
    const near = new Set<string>()
    if (sel) {
      near.add(sel)
      for (const j of data.joins) {
        if (j.a === sel) near.add(j.b)
        if (j.b === sel) near.add(j.a)
      }
    }
    const pathIds = new Set(path?.map((j) => j.id) ?? [])
    const focusSet = pathTables ?? (sel ? near : null)
    const now = Date.now()
    const hotTables = new Set(Object.entries(heat).filter(([p, h]) => now - h.ts < 45_000 && analysis.schema.tables.some((t) => t.source === p)).flatMap(([p]) => analysis.schema.tables.filter((t) => t.source === p).map((t) => t.name)))
    const hotCols = new Map<string, string[]>()
    for (const j of path ?? (sel ? data.joins.filter((j) => j.a === sel || j.b === sel) : [])) {
      if (j.ac) hotCols.set(j.a, [...(hotCols.get(j.a) ?? []), j.ac])
      if (j.bc) hotCols.set(j.b, [...(hotCols.get(j.b) ?? []), j.bc])
    }
    // live: tables / columns that appeared this session
    const freshTable = new Map<string, number>()
    const newCols = new Map<string, string[]>()
    for (const c of changes) {
      if (!c.table) continue
      if (c.kind === 'table-added') freshTable.set(c.table, c.ts)
      if (c.kind === 'column-added' && c.column) {
        newCols.set(c.table, [...(newCols.get(c.table) ?? []), c.column])
        freshTable.set(c.table, Math.max(freshTable.get(c.table) ?? 0, c.ts))
      }
    }
    const ns = positioned.map((n) =>
      n.type === 'table'
        ? { ...n, data: { ...n.data, activity: activities.get(analysis.schema.tables.find(t => t.name === n.id)?.source ?? ''), active: sel === n.id || !!pathTables?.has(n.id), dim: !!focusSet && !focusSet.has(n.id), hotCols: hotCols.get(n.id), heat: hotTables.has(n.id), fresh: freshness(freshTable.get(n.id), now), newCols: newCols.get(n.id) } }
        : n,
    )
    const es: Edge[] = data.joins
      .filter((j) => pos.has(j.a) && pos.has(j.b))
      .map((j) => {
        const leftToRight = (pos.get(j.a) ?? 0) <= (pos.get(j.b) ?? 0)
        const color = JOIN_COLOR[j.kind]
        const name = j.kind === 'fk' ? 'lime' : j.kind === 'many_to_many' ? 'pink' : 'amber'
        const cols = (t: string) => layout.byName.get(t)?.columns.slice(0, 18).map((c) => c.name) ?? []
        const sh = j.ac && cols(j.a).includes(j.ac) ? `${j.ac}-${leftToRight ? 'sr' : 'sl'}` : undefined
        const th = j.bc && cols(j.b).includes(j.bc) ? `${j.bc}-${leftToRight ? 'tl' : 'tr'}` : undefined
        const hot = pathIds.size ? pathIds.has(j.id) : sel ? j.a === sel || j.b === sel : true
        const startM = j.card === '1:1' ? `one-${name}` : j.card === 'N:1' || j.card === 'M:N' ? `many-${name}` : undefined
        const endM = j.card === 'M:N' ? `many-${name}` : j.card === '?' ? undefined : `one-${name}`
        const showLabel = hot && (!!sel || !!pathIds.size || hoverEdge === j.id || data.joins.length < 25)
        return {
          id: j.id,
          source: j.a,
          target: j.b,
          sourceHandle: sh,
          targetHandle: th,
          type: 'neon',
          data: { color, shape: 'step' as const },
          markerStart: startM,
          markerEnd: endM,
          label: showLabel ? `${j.label}${j.count ? `  ·  used ×${j.count}` : ''}` : undefined,
          labelStyle: { fill: color, fontSize: 10 },
          labelBgStyle: labelBg(color),
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke: color,
            strokeWidth: hot && (sel || pathIds.size) ? 2.2 : 1.4,
            strokeDasharray: JOIN_DASH[j.kind],
            opacity: hot ? 0.95 : 0.07,
            filter: hot ? `drop-shadow(0 0 3px ${color})` : undefined,
          },
        } satisfies Edge
      })
    return { nodes: ns, edges: es }
  }, [layout, positioned, data, sel, path, pathTables, heat, analysis, hoverEdge, changes, tick, activities])
  const [liveNodes, applySizes] = useMorph(nodes, `schema:${storageKey}`)

  if (!analysis || !idx || !data) return null
  const { tables } = analysis.schema

  if (tables.length === 0)
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <Database className="mx-auto mb-3 size-8 text-[#b6ff3b]" style={{ filter: 'drop-shadow(0 0 10px #b6ff3b)' }} />
          <h3 className="text-lg font-semibold">No database schema yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The diagram appears as soon as the project defines tables. Codeglass reads Prisma, SQL <code>CREATE TABLE</code> and migrations, Drizzle, Django and SQLAlchemy models.
          </p>
        </div>
      </div>
    )

  const selTable = tables.find((t) => t.name === sel)
  const selJoins = sel ? data.joins.filter((j) => j.a === sel || j.b === sel) : []
  const sql = path && pathFrom ? sqlFor(path, pathFrom, analysis) : null
  const names = tables.map((t) => t.name).sort()

  return (
    <div className="flex h-full min-h-0">
      <CrowMarkers />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="schema-toolbar map-toolbar flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs">
          <div className="schema-controls flex w-full flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap">
          <span className="flex items-center gap-1.5 text-sm font-semibold"><Database className="size-4 text-[#22e8ff]" />{analysis.name}</span>
          <Button size="xs" variant="outline" className="h-8 shrink-0" onClick={() => flow.current?.fitView({ padding: 0.12, maxZoom: 1.1, duration: 400 })}><LocateFixed />Recenter</Button>
          <Button size="xs" variant="outline" className="h-8 shrink-0" onClick={() => {
            saveSchemaPins(storageKey, {})
            setManual({ key: storageKey, pins: {} })
            setTimeout(() => flow.current?.fitView({ padding: 0.12, maxZoom: 1.1, duration: 400 }), 800)
          }}><LayoutGrid />Auto-arrange</Button>
          <span className="shrink-0 font-mono text-muted-foreground">
            <b className="text-foreground">{tables.length}</b> tables · <b className="text-foreground">{data.joins.length}</b> joins
          </span>
          <div className="join-picker flex h-8 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3">
            <Route className="size-3.5 text-[#22e8ff]" />
            <span className="text-muted-foreground">Join path</span>
            <select aria-label="Join path from table" value={pathFrom} onChange={(e) => setPathFrom(e.target.value)} className="rounded bg-transparent font-mono outline-none">
              <option value="">from…</option>
              {names.map((n) => (
                <option key={n} value={n} className="bg-[#0b0b12]">
                  {n}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">→</span>
            <select aria-label="Join path to table" value={pathTo} onChange={(e) => setPathTo(e.target.value)} className="rounded bg-transparent font-mono outline-none">
              <option value="">to…</option>
              {names.map((n) => (
                <option key={n} value={n} className="bg-[#0b0b12]">
                  {n}
                </option>
              ))}
            </select>
            {(pathFrom || pathTo) && (
              <button onClick={() => (setPathFrom(''), setPathTo(''))} className="text-muted-foreground hover:text-foreground" aria-label="Clear path">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {analysis.schema.junctions.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} className="accent-[#9d7bff]" />
              collapse {analysis.schema.junctions.length} join table{analysis.schema.junctions.length > 1 ? 's' : ''} into M:N
            </label>
          )}
          </div>
        </div>
        {pathFrom && pathTo && (
          <div className="flex items-start gap-3 border-b border-white/5 bg-[#22e8ff]/[0.03] px-4 py-2">
            {path ? (
              <>
                <pre className="flex-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-[#bff7ff]">{sql}</pre>
                <Button size="xs" variant="ghost" onClick={() => sql && navigator.clipboard.writeText(sql)}>
                  <Copy /> Copy
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">No join path between these tables.</span>
            )}
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={liveNodes}
            onInit={(instance) => { flow.current = instance }}
            onNodesChange={applySizes}
            onNodeDragStop={(_, node) => {
              const next = { ...pins, [node.id]: { ...node.position, parentId: node.parentId } }
              saveSchemaPins(storageKey, next)
              setManual({ key: storageKey, pins: next })
            }}
            nodesDraggable
            deleteKeyCode={null}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={neonEdgeTypes}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
            minZoom={0.05}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            onNodeClick={(_, n) => n.type === 'table' && setSel((s) => (s === n.id ? null : n.id))}
            onPaneClick={() => setSel(null)}
            onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
            onEdgeMouseLeave={() => setHoverEdge(null)}
          >
            <Controls showInteractive={false} position="bottom-left" />
            {tables.length > 12 && <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'domain' ? 'transparent' : NEON.lime)} maskColor="rgba(5,5,8,0.75)" />}
          </ReactFlow>
          {settings?.showLegends !== false && <div className="schema-legend graph-legend pointer-events-none absolute right-4 bottom-3 left-16 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-white/10 bg-[#090c12]/95 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            <EdgeKey color={JOIN_COLOR.fk} label="Foreign key" />
            <EdgeKey color={JOIN_COLOR.many_to_many} dash={JOIN_DASH.many_to_many} label="Many-to-many" />
            <EdgeKey color={JOIN_COLOR.code_join} dash={JOIN_DASH.code_join} label="Joined in code" />
            <span className="text-[11px] text-slate-400">Crow’s foot = many · Double bar = one</span>
          </div>}
        </div>
      </div>

      {selTable && (
        <aside className="w-[380px] shrink-0 border-l border-white/5 bg-black/40 backdrop-blur-xl">
          <div className="flex items-start justify-between border-b border-white/5 p-4">
            <div>
              <div className="font-mono text-base font-semibold" style={{ color: NEON.lime, textShadow: `0 0 14px ${NEON.lime}66` }}>
                {selTable.name}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {selTable.kind} · {selTable.source}
              </div>
            </div>
            <Button size="icon-sm" variant="ghost" onClick={() => setSel(null)} aria-label="Close">
              <X />
            </Button>
          </div>
          <ScrollArea className="h-[calc(100%-73px)]">
            <div className="space-y-5 p-4">
              <section>
                <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Joins</h4>
                <ul className="space-y-1.5">
                  {selJoins.map((j) => {
                    const other = j.a === sel ? j.b : j.a
                    const c = JOIN_COLOR[j.kind]
                    return (
                      <li key={j.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                        <div className="flex items-center gap-2 text-[12px]">
                          <button className="font-medium hover:underline" onClick={() => setSel(other)}>
                            {other}
                          </button>
                          <span className="rounded px-1 font-mono text-[9px]" style={{ color: c, border: `1px solid ${c}55` }}>
                            {j.card === '?' ? 'in code' : j.card}
                          </span>
                          {j.count > 0 && <span className="ml-auto font-mono text-[10px] text-muted-foreground">used ×{j.count}</span>}
                        </div>
                        <div className="mt-2"><IOFields input={j.ac ? [{ name: `${j.a}.${j.ac}`, type: valueType(tables.find(t => t.name === j.a)?.columns.find(c => c.name === j.ac)?.type ?? ''), description: 'Source join column' }] : []} output={j.bc ? [{ name: `${j.b}.${j.bc}`, type: valueType(tables.find(t => t.name === j.b)?.columns.find(c => c.name === j.bc)?.type ?? ''), description: 'Target join column' }] : []} /></div>
                        <div className="mt-0.5 font-mono text-[10px]" style={{ color: c }}>
                          {j.label}
                        </div>
                      </li>
                    )
                  })}
                  {selJoins.length === 0 && <li className="text-xs text-muted-foreground">No joins.</li>}
                </ul>
              </section>
              <section>
                <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Code that reads / writes it</h4>
                <ul className="space-y-0.5">
                  {(idx.filesByTable.get(selTable.name) ?? []).map((f) => (
                    <li key={f} className="truncate font-mono text-[11px] text-slate-300" title={f}>
                      {f}
                    </li>
                  ))}
                  {!(idx.filesByTable.get(selTable.name) ?? []).length && <li className="text-xs text-muted-foreground">No references found.</li>}
                </ul>
              </section>
              <section>
                <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Columns</h4>
                <ul className="space-y-0.5">
                  {selTable.columns.map((c) => (
                    <li key={c.name} className={cn('flex gap-2 font-mono text-[11px]', c.pk && 'text-[#ffb020]')}>
                      {c.name}
                      <span className="ml-auto text-muted-foreground">
                        {c.type}
                        {c.unique ? ' · unique' : ''}
                        {c.fk ? ` → ${c.fk.table}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </ScrollArea>
        </aside>
      )}
    </div>
  )
}
