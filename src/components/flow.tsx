import { ActivityTag } from './ActivityTag'
import type { CardActivity } from '@/lib/activity'
import { memo } from 'react'
import dagre from '@dagrejs/dagre'
import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Database, KeyRound, Link2 } from 'lucide-react'
import { LAYER_COLOR } from '@/lib/colors'
import type { Column } from '@/lib/types'
import { cn } from '@/lib/utils'

export type FileNodeData = {
  label: string
  sub?: string
  color: string
  file?: string
  folder?: string
  dim?: boolean
  active?: boolean
  badge?: string
}

export const FileNode = memo(function FileNode({ data }: NodeProps<Node<FileNodeData>>) {
  return (
    <div
      data-file={data.file}
      data-folder={data.folder}
      className={cn(
        'w-[190px] rounded-md border bg-card px-2.5 py-1.5 shadow-sm transition-opacity',
        data.dim && 'opacity-20',
        data.active && 'ring-2 ring-white/70',
      )}
      style={{ borderLeft: `3px solid ${data.color}` }}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-mono text-xs font-medium" title={data.label}>
          {data.label}
        </div>
        {data.badge && <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">{data.badge}</span>}
      </div>
      {data.sub && <div className="truncate text-[10px] text-muted-foreground">{data.sub}</div>}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-slate-500" />
    </div>
  )
})

export type TableNodeData = {
  activity?: CardActivity
  name: string
  columns: Column[]
  kind: string
  dim?: boolean
  active?: boolean
  fileCount?: number
}

const hh = '!size-1.5 !border-0 !bg-transparent'
export const TableNode = memo(function TableNode({ data }: NodeProps<Node<TableNodeData & { hotCols?: string[]; heat?: boolean; fresh?: 'hot' | 'new' | null; newCols?: string[] }>>) {
  const c0 = LAYER_COLOR.table
  return (
    <div
      className={cn('relative w-[240px] overflow-visible rounded-xl border bg-[#0a0d08] transition-[opacity,box-shadow] duration-300', data.dim && 'opacity-20', data.heat && 'claude-here', data.fresh === 'hot' && 'fresh-hot')}
      style={{ borderColor: data.active ? c0 : 'rgba(182,255,59,0.18)', boxShadow: data.active ? `0 0 0 1px ${c0}, 0 0 30px -6px ${c0}` : `0 0 22px -14px ${c0}`, ['--glow' as string]: '#ffb020' }}
    >
      <ActivityTag activity={data.activity} />
      <Handle type="target" position={Position.Left} className={hh} />
      <Handle type="source" position={Position.Right} className={hh} />
      <div className="schema-table-handle relative flex cursor-grab items-center gap-2 border-b border-[#b6ff3b]/15 px-3 py-2 active:cursor-grabbing" title="Drag this table within its group" style={{ background: `linear-gradient(90deg, ${c0}1f, transparent)` }}>
        <Database className="size-3.5" style={{ color: c0, filter: `drop-shadow(0 0 4px ${c0})` }} />
        <span className="truncate font-mono text-[13px] font-semibold">{data.name}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{data.columns.length}</span>
        {data.fresh && <span className="absolute -top-2.5 right-2 rounded-full bg-[#b6ff3b] px-1.5 py-px font-mono text-[9px] font-bold text-black">NEW</span>}
      </div>
      <ul>
        {data.columns.slice(0, 18).map((c) => {
          const hot = data.hotCols?.includes(c.name)
          const added = data.newCols?.includes(c.name)
          return (
            <li key={c.name} className={cn('relative flex items-center gap-2 border-b border-white/[0.04] px-3 py-1 text-[11px] last:border-0', hot && 'bg-[#22e8ff]/10', added && 'bg-[#b6ff3b]/15 text-[#e4ffb8]')}>
              <Handle id={`${c.name}-tl`} type="target" position={Position.Left} className={hh} style={{ top: '50%' }} />
              <Handle id={`${c.name}-sl`} type="source" position={Position.Left} className={hh} style={{ top: '50%' }} />
              {c.pk ? <KeyRound className="size-3 shrink-0 text-[#ffb020]" /> : c.fk ? <Link2 className="size-3 shrink-0 text-[#22e8ff]" /> : <span className="size-3 shrink-0" />}
              <span className={cn('truncate font-mono', c.pk && 'font-semibold', hot && 'text-[#22e8ff]')}>{c.name}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                {c.type}
                {c.nullable ? '?' : ''}
              </span>
              <Handle id={`${c.name}-tr`} type="target" position={Position.Right} className={hh} style={{ top: '50%' }} />
              <Handle id={`${c.name}-sr`} type="source" position={Position.Right} className={hh} style={{ top: '50%' }} />
            </li>
          )
        })}
        {data.columns.length > 18 && <li className="px-3 py-1 font-mono text-[10px] text-muted-foreground">+{data.columns.length - 18} more</li>}
      </ul>
    </div>
  )
})

export const nodeTypes = { file: FileNode, table: TableNode }

export function layoutDagre<N extends Node>(
  nodes: N[],
  edges: Edge[],
  size: (n: N) => { w: number; h: number },
  opts: { dir?: 'LR' | 'TB'; ranksep?: number; nodesep?: number } = {},
): N[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: opts.dir ?? 'LR', ranksep: opts.ranksep ?? 90, nodesep: opts.nodesep ?? 18, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    const s = size(n)
    g.setNode(n.id, { width: s.w, height: s.h })
  }
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return nodes.map((n) => {
    const p = g.node(n.id)
    const s = size(n)
    return { ...n, position: { x: p.x - s.w / 2, y: p.y - s.h / 2 } }
  })
}

/** lays the graph out both left→right and top→bottom and keeps whichever fits a wide screen better */
export function layoutAuto<N extends Node>(nodes: N[], edges: Edge[], size: (n: N) => { w: number; h: number }, opts: { ranksep?: number; nodesep?: number } = {}): N[] {
  if (nodes.length < 2) return layoutDagre(nodes, edges, size, opts)
  const score = (ns: N[]) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const n of ns) {
      const s = size(n)
      x1 = Math.min(x1, n.position.x)
      y1 = Math.min(y1, n.position.y)
      x2 = Math.max(x2, n.position.x + s.w)
      y2 = Math.max(y2, n.position.y + s.h)
    }
    const ratio = (x2 - x1) / Math.max(y2 - y1, 1)
    return Math.abs(Math.log(ratio / 1.7))
  }
  const lr = layoutDagre(nodes, edges, size, { ...opts, dir: 'LR' })
  const tb = layoutDagre(nodes, edges, size, { ...opts, dir: 'TB', ranksep: (opts.ranksep ?? 90) * 0.7 })
  return score(lr) <= score(tb) ? lr : tb
}

/** like layoutAuto, but also says which direction won (for choosing edge handles) */
export function layoutAutoDir<N extends Node>(nodes: N[], edges: Edge[], size: (n: N) => { w: number; h: number }, opts: { ranksep?: number; nodesep?: number } = {}): { nodes: N[]; dir: 'LR' | 'TB' } {
  const out = layoutAuto(nodes, edges, size, opts)
  const lr = layoutDagre(nodes, edges, size, { ...opts, dir: 'LR' })
  const same = out.every((n, i) => n.position.x === lr[i].position.x && n.position.y === lr[i].position.y)
  return { nodes: out, dir: same ? 'LR' : 'TB' }
}

/**
 * Layout for a set of nodes where many may be unconnected:
 * each connected group gets its own dagre layout, loners go in a compact grid,
 * and the blocks are shelf-packed into a roughly screen-shaped area.
 */
export function packLayout<N extends Node>(
  nodes: N[],
  edges: { source: string; target: string }[],
  size: (n: N) => { w: number; h: number },
  opts: { gap?: number; ranksep?: number; nodesep?: number; aspect?: number } = {},
): N[] {
  const gap = opts.gap ?? 40
  const ids = new Set(nodes.map((n) => n.id))
  const inner = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  const parent = new Map(nodes.map((n) => [n.id, n.id]))
  const find = (x: string): string => {
    const p = parent.get(x)!
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  for (const e of inner) parent.set(find(e.source), find(e.target))
  const comps = new Map<string, N[]>()
  for (const n of nodes) comps.set(find(n.id), [...(comps.get(find(n.id)) ?? []), n])

  type Block = { nodes: N[]; w: number; h: number }
  const blocks: Block[] = []
  const singles: N[] = []
  const norm = (ns: N[]): Block => {
    const minX = Math.min(...ns.map((n) => n.position.x))
    const minY = Math.min(...ns.map((n) => n.position.y))
    const out = ns.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } }))
    return { nodes: out, w: Math.max(...out.map((n) => n.position.x + size(n).w)), h: Math.max(...out.map((n) => n.position.y + size(n).h)) }
  }
  for (const c of comps.values()) {
    if (c.length === 1) {
      singles.push(c[0])
      continue
    }
    const cs = new Set(c.map((n) => n.id))
    const es = inner.filter((e) => cs.has(e.source)).map((e, i) => ({ id: `p${i}`, source: e.source, target: e.target }))
    blocks.push(norm(layoutAuto(c, es, size, { ranksep: opts.ranksep ?? 90, nodesep: opts.nodesep ?? 30 })))
  }
  if (singles.length) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(singles.length * 1.4)))
    const placed: N[] = []
    let y = 0
    for (let r = 0; r * cols < singles.length; r++) {
      const row = singles.slice(r * cols, r * cols + cols)
      let x = 0
      for (const n of row) {
        placed.push({ ...n, position: { x, y } })
        x += size(n).w + gap
      }
      y += Math.max(...row.map((n) => size(n).h)) + gap
    }
    blocks.push(norm(placed))
  }
  blocks.sort((a, b) => b.nodes.length - a.nodes.length || b.h - a.h)
  const area = blocks.reduce((s, b) => s + b.w * b.h, 0)
  const maxW = Math.max(Math.sqrt(area * (opts.aspect ?? 1.7)), ...blocks.map((b) => b.w))
  const out: N[] = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const b of blocks) {
    if (x > 0 && x + b.w > maxW) {
      x = 0
      y += rowH + gap * 1.6
      rowH = 0
    }
    for (const n of b.nodes) out.push({ ...n, position: { x: n.position.x + x, y: n.position.y + y } })
    x += b.w + gap * 2
    rowH = Math.max(rowH, b.h)
  }
  return out
}
