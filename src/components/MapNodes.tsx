import type { IOContract } from '@shared/contracts'
import { ActivityTag } from './ActivityTag'
import { type CardActivity } from '@/lib/activity'
import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AppWindow, Boxes, Cloud, Cpu, Database, FileCode2, Gem, Layers, Library, Package, Puzzle, Server, ShieldCheck, Sparkles, Table2, Terminal, Wrench } from 'lucide-react'
import { KIND_COLOR, LAYER_COLOR } from '@/lib/colors'
import { fmt } from '@/lib/graph'
import type { SystemKind } from '@/lib/types'
import { cn } from '@/lib/utils'

export const KIND_ICON: Record<SystemKind, typeof Server> = {
  core: Gem,
  supporting: Puzzle,
  generic: ShieldCheck,
  platform: Layers,
  frontend: AppWindow,
  backend: Server,
  worker: Cpu,
  database: Database,
  external: Cloud,
  library: Library,
  cli: Terminal,
  infra: Wrench,
  other: Boxes,
}

export type ArchNodeData = Partial<IOContract> & {
  activity?: CardActivity
  kind: 'system' | 'module' | 'leaf'
  leafKind?: 'file' | 'table' | 'pkg'
  label: string
  sub?: string
  color: string
  sysKind?: SystemKind
  sysName?: string
  tech?: string[]
  stats?: string
  ghost?: boolean
  dim?: boolean
  selected?: boolean
  badge?: 'new' | 'changed' | null
  fresh?: 'hot' | 'new' | null
  flowStep?: number // position in a flow being played on the map
  building?: boolean // new code Claude hasn't described yet
  flowLit?: boolean
  freshCount?: number
  heat?: 'claude' | 'codex' | 'fs' | null
  claudeHere?: boolean
  agentProvider?: 'claude' | 'codex'
  trail?: number
  file?: string
  folder?: string
  drillable?: boolean
}

const hidden = '!size-2 !border-0 !bg-transparent'
const SIDES = [
  ['l', Position.Left],
  ['r', Position.Right],
  ['t', Position.Top],
  ['b', Position.Bottom],
] as const
/**
 * A source + target handle on every side, so edges can leave from whichever side faces the other node.
 * Sources sit at 38% and targets at 62% along each side, so A→B and B→A run as two separate parallel arrows.
 */
const offset = (pos: Position, at: string) => (pos === Position.Left || pos === Position.Right ? { top: at } : { left: at })
const SLOT_PCT = ['14%', '28%', '42%', '50%', '58%', '72%', '86%']
function SideHandles() {
  return (
    <>
      {SIDES.map(([id, pos]) => (
        <Handle key={'s' + id} id={'s-' + id} type="source" position={pos} className={hidden} style={offset(pos, '38%')} />
      ))}
      {SIDES.map(([id, pos]) => (
        <Handle key={'t' + id} id={'t-' + id} type="target" position={pos} className={hidden} style={offset(pos, '62%')} />
      ))}
      {SIDES.flatMap(([id, pos]) =>
        SLOT_PCT.map((pct, k) => [
          <Handle key={`s${id}${k}`} id={`s-${id}-${k}`} type="source" position={pos} className={hidden} style={offset(pos, pct)} />,
          <Handle key={`t${id}${k}`} id={`t-${id}-${k}`} type="target" position={pos} className={hidden} style={offset(pos, pct)} />,
        ]),
      )}
    </>
  )
}

type Box = { x: number; y: number; w: number; h: number }
/**
 * Pick the facing sides for an edge between two boxes, from the real gap between them (not centre angles):
 * stacked boxes connect bottom→top, side-by-side boxes connect side→side. This keeps lines short and
 * avoids S-curves that leave one side and wrap around into the other.
 */
export function facingHandles(a: Box, b: Box) {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)) // > 0: no horizontal overlap
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)) // > 0: no vertical overlap
  const below = b.y + b.h / 2 > a.y + a.h / 2
  const right = b.x + b.w / 2 > a.x + a.w / 2
  const vertical = { sourceHandle: below ? 's-b' : 's-t', targetHandle: below ? 't-t' : 't-b' }
  const horizontal = { sourceHandle: right ? 's-r' : 's-l', targetHandle: right ? 't-l' : 't-r' }
  if (vGap > 0 && hGap <= 0) return vertical // stacked
  if (hGap > 0 && vGap <= 0) return horizontal // side by side
  if (vGap > 0 && hGap > 0) return vGap * 1.6 >= hGap ? vertical : horizontal // diagonal: favour the clearer axis (cards are wide)
  // overlapping boxes (e.g. a neighbour column next to a frame): fall back to centres
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? horizontal : vertical
}

export const ArchNode = memo(function ArchNode({ data }: NodeProps<Node<ArchNodeData>>) {
  const Icon = data.kind === 'leaf' ? (data.leafKind === 'table' ? Table2 : data.leafKind === 'pkg' ? Package : FileCode2) : KIND_ICON[data.sysKind ?? 'other']
  const glow = data.flowLit ? '#ff2bd6' : data.claudeHere ? '#ffb020' : data.heat && data.heat !== 'fs' ? '#ffb020' : data.heat === 'fs' ? '#22e8ff' : data.color
  const big = data.kind !== 'leaf'
  return (
    <div
      data-file={data.file}
      data-folder={data.folder}
      style={{ ['--glow' as string]: glow, borderColor: data.selected || data.heat || data.claudeHere ? glow : undefined }}
      className={cn(
        'group relative rounded-xl border bg-[#0b0b12] transition-[opacity,box-shadow] duration-300',
        big ? (data.kind === 'system' ? 'w-[270px] h-[188px] p-3.5' : 'w-[240px] h-[172px] p-3') : 'w-[210px] px-2.5 py-2',
        data.ghost && 'border-dashed opacity-60',
        data.dim && 'opacity-15',
        data.selected ? 'neon-border' : data.heat ? 'glow-soft' : 'border-white/10 hover:border-white/25',
        data.claudeHere && 'claude-here',
        data.fresh === 'hot' && 'fresh-hot',
        data.flowLit && 'neon-border',
        data.building && 'building-card border-dashed',
      )}
    >
      <SideHandles />
      {/* neon top edge */}
      {!data.ghost && <div className="pointer-events-none absolute inset-x-3 -top-px h-px" style={{ background: `linear-gradient(90deg, transparent, ${data.color}, transparent)` }} />}

      <div className="flex items-center gap-2">
        <div className="grid shrink-0 place-items-center rounded-md" style={{ color: data.color, background: `${data.color}14`, width: big ? 26 : 20, height: big ? 26 : 20, boxShadow: `0 0 14px -4px ${data.color}` }}>
          <Icon className={big ? 'size-3.5' : 'size-3'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate font-semibold tracking-tight', big ? 'text-[13px]' : 'font-mono text-[11px]')} title={data.label}>
            {data.ghost && <span className="text-muted-foreground">→ </span>}
            {data.label}
          </div>
          {data.kind === 'system' && data.sysKind && (
            <div className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: data.color }}>
              {data.sysKind}
            </div>
          )}
          {data.kind === 'module' && data.sysName && <div className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{data.sysName}</div>}
          {data.kind === 'leaf' && data.sub && <div className="truncate font-mono text-[9px] text-muted-foreground">{data.sub}</div>}
        </div>
        {data.trail != null && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-400/15 font-mono text-[10px] font-semibold text-amber-300" title="Agent visited (1 = most recent)">
            {data.trail}
          </span>
        )}
      </div>

      {big && data.sub && !data.ghost && <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-300/85">{data.sub}</p>}

      {big && !data.ghost && (data.stats || data.tech?.length) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {data.stats && <span className="font-mono text-[10px] text-muted-foreground">{data.stats}</span>}
          {data.tech?.slice(0, 3).map((t) => (
            <span key={t} className="rounded border border-white/10 px-1 font-mono text-[9px] text-slate-300">
              {t}
            </span>
          ))}
        </div>
      )}

      {big && !data.ghost && <div className="absolute right-3 bottom-3 left-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-2">
        {([['In', data.input], ['Out', data.output]] as const).map(([label, fields]) => <div key={label} className="min-w-0" title={fields?.map((f) => `${f.name}: ${f.type} — ${f.description}`).join('\n') || 'Inputs and outputs are not documented in this map'}>
          <div className="font-mono text-[8px] uppercase tracking-wider text-slate-500">{label}</div>
          <div className="truncate font-mono text-[10px] text-slate-300">{fields?.length ? fields.map((f) => `${f.name}: ${f.type}`).join(', ') : 'Not documented'}</div>
        </div>)}
      </div>}
      <ActivityTag activity={data.activity} />
      {data.flowStep != null && (
        <span className={cn('absolute -top-2.5 left-2 rounded-full px-1.5 py-px font-mono text-[9px] font-bold transition-colors', data.flowLit ? 'bg-[#ff2bd6] text-black shadow-[0_0_12px_#ff2bd6]' : 'bg-white/10 text-muted-foreground')}>
          STEP {data.flowStep}
        </span>
      )}
      {data.building && (
        <span className="absolute -top-2.5 left-2 flex items-center gap-1 rounded-full bg-[#ffb020] px-1.5 py-px font-mono text-[9px] font-bold text-black shadow-[0_0_12px_#ffb020]">
          <span className="size-1.5 animate-ping rounded-full bg-black/70" /> BUILDING
        </span>
      )}
      {!data.activity && (data.badge || data.claudeHere || data.fresh) && (
        <div className="absolute -top-2.5 right-2 flex gap-1">
          {data.claudeHere && (
            <span className="flex items-center gap-1 rounded-full bg-amber-400 px-1.5 py-px font-mono text-[9px] font-bold text-black">
              <Sparkles className="size-2.5" /> {data.agentProvider === 'codex' ? 'CODEX' : 'CLAUDE'}
            </span>
          )}
          {data.fresh && !data.badge && (
            <span className="rounded-full bg-[#b6ff3b] px-1.5 py-px font-mono text-[9px] font-bold text-black">{data.freshCount && data.freshCount > 1 ? `+${data.freshCount} NEW` : 'NEW'}</span>
          )}
          {data.badge && (
            <span className={cn('rounded-full px-1.5 py-px font-mono text-[9px] font-bold text-black', data.badge === 'new' ? 'bg-[#b6ff3b]' : 'bg-[#22e8ff]')}>
              {data.badge === 'new' ? 'NEW' : 'CHANGED'}
            </span>
          )}
        </div>
      )}
      {data.drillable && !data.ghost && <div className="pointer-events-none absolute right-2.5 bottom-1.5 font-mono text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">Double-click to open</div>}
    </div>
  )
})

export type BoundaryData = { label: string; sub?: string; color: string; w: number; h: number; kind?: string }
/** the frame around everything inside the system / module you opened */
export const BoundaryNode = memo(function BoundaryNode({ data }: NodeProps<Node<BoundaryData>>) {
  return (
    <div className="relative rounded-3xl border border-dashed" style={{ width: data.w, height: data.h, borderColor: `${data.color}55`, background: `radial-gradient(120% 80% at 50% 0%, ${data.color}0d, transparent 70%)`, boxShadow: `inset 0 0 60px -30px ${data.color}` }}>
      <SideHandles />
      <div className="absolute -top-3 left-6 flex items-center gap-2 rounded-full border bg-[#07070b] px-3 py-0.5" style={{ borderColor: `${data.color}66` }}>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: data.color, textShadow: `0 0 10px ${data.color}` }}>
          {data.label}
        </span>
        {data.kind && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{data.kind}</span>}
      </div>
    </div>
  )
})

export const archNodeTypes = { arch: ArchNode, boundary: BoundaryNode }

export function leafColor(leafKind: 'file' | 'table' | 'pkg', layer?: string) {
  if (leafKind === 'table') return LAYER_COLOR.table
  if (leafKind === 'pkg') return LAYER_COLOR.external
  return LAYER_COLOR[(layer as keyof typeof LAYER_COLOR) ?? 'other'] ?? LAYER_COLOR.other
}

export function kindColor(k?: SystemKind) {
  return KIND_COLOR[k ?? 'other']
}

export const nodeSize = (d: ArchNodeData) => (d.kind === 'system' ? { w: 270, h: 188 } : d.kind === 'module' ? { w: 240, h: 172 } : { w: 210, h: 46 })

export function statLine(files: string[], loc: number, extra?: string) {
  const parts = []
  if (files.length) parts.push(`${files.length} file${files.length === 1 ? '' : 's'}`)
  if (loc) parts.push(`${fmt(loc)} lines`)
  if (extra) parts.push(extra)
  return parts.join(' · ')
}
