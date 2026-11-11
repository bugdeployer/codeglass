import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controls, MarkerType, MiniMap, ReactFlow, useReactFlow, useNodesInitialized, ReactFlowProvider, type Edge, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Boxes, ChevronRight, LayoutGrid, LocateFixed, Network, Workflow } from 'lucide-react'
import { labelBg, neonEdgeTypes } from '@/components/NeonEdge'
import { Button } from '@/components/ui/button'
import { FileDetail } from '@/components/FileDetail'
import { MapperBar } from '@/components/MapperBar'
import { archNodeTypes, kindColor, leafColor, nodeSize, statLine, type ArchNodeData, type BoundaryData } from '@/components/MapNodes'
import { packLayout } from '@/components/flow'
import { layoutMinCross } from '@/lib/gridLayout'
import { ArchCard } from '@/components/ArchCard'
import { DomainFlows } from '@/components/DomainFlows'
import { WriteDetail } from '@/components/WriteDetail'
import type { FlowStep } from '@/lib/types'
import { useArch } from '@/lib/arch'
import { isProvisional } from '@/lib/provisional'
import { freshness } from '@/lib/changes'
import { useActivities } from '@/lib/activity-context'
import { usePreferences } from '@/lib/preferences'
import { EdgeKey } from '@/components/EdgeKey'
import { EDGE_COLOR, EDGE_LABEL } from '@/lib/colors'
import { useIndex } from '@/lib/graph'
import { dominantKind, edgeSummary, Model, OTHER, type Focus, type MapEdge, type MapNode } from '@/lib/model'
import { useMorph } from '@/lib/morph'
import { finalizeEdge, pickSides, placeLabels, SLOTS, type Box, type Pt, type Routed, type Side } from '@/lib/route'
import { useProject } from '@/lib/store'

const HEAT_MS = 45_000
const LANES = ['ui', 'api', 'logic', 'job', 'data', 'other']
const LANE_NAME: Record<string, string> = { ui: 'screens', api: 'endpoints', logic: 'logic', job: 'background job', data: 'data', other: 'part' }
const BOUNDARY = '__boundary'
const GHOST_GAP = 240 // space between the frame and the neighbour columns

type Laid = {
  nodes: Node[]
  dir: 'LR' | 'TB'
  graph: { nodes: MapNode[]; edges: MapEdge[] }
  inside: boolean
}

/** merge edges that touch the same neighbour into one edge from/to the frame */
function bundle(edges: MapEdge[], ghosts: Set<string>, keep: (e: MapEdge) => boolean): MapEdge[] {
  const out = new Map<string, MapEdge>()
  for (const e of edges) {
    const sg = ghosts.has(e.source)
    const tg = ghosts.has(e.target)
    if (!(sg || tg) || keep(e)) {
      out.set(e.key, e)
      continue
    }
    const s = sg ? e.source : BOUNDARY
    const t = tg ? e.target : BOUNDARY
    const k = `${s}→${t}:${dominantKind(e.kinds)}`
    const m = out.get(k) ?? { key: k, source: s, target: t, kinds: {}, labels: [], files: [] }
    for (const [kk, v] of Object.entries(e.kinds)) m.kinds[kk] = (m.kinds[kk] ?? 0) + v
    for (const l of [e.claudeLabel, ...e.labels]) if (l && !m.labels.includes(l) && m.labels.length < 12) m.labels.push(l)
    for (const f of e.files) if (!m.files.includes(f) && m.files.length < 40) m.files.push(f)
    out.set(k, m)
  }
  return [...out.values()]
}

/** is `o` (a card) lying inside `frame`? (cards inside the opened system's frame) */
function inBox(o: Box, frame: Box) {
  return o.x >= frame.x && o.y >= frame.y && o.x + o.w <= frame.x + frame.w && o.y + o.h <= frame.y + frame.h
}

function Inner() {
  const { settings } = usePreferences()
  const { analysis, heat, events, agentNow, changes } = useProject()
  const { arch, fileOwner, sessionStart } = useArch()
  const played = useRef(new Set<string>())
  const [trace, setTrace] = useState<{ keys: string[]; step: number; name: string; updated: boolean } | null>(null)
  const traceTimer = useRef<number | undefined>(undefined)
  const idx = useIndex()
  const [focus, setFocus] = useState<Focus>({})
  const [selected, setSelected] = useState<string | null>(null)
  // inside a capability: its flows (default) or its parts
  const [insideMode, setInsideMode] = useState<'flows' | 'parts'>('flows')
  const [autoPlayFlow, setAutoPlayFlow] = useState<string | null>(null)
  const [stepSel, setStepSel] = useState<FlowStep | null>(null) // a flow step whose writes are open in the side panel
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const rf = useReactFlow()

  // re-evaluate "just appeared" glows as they age
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(i)
  }, [])

  const model = useMemo(() => (analysis && arch ? new Model(analysis, arch, fileOwner) : null), [analysis, arch, fileOwner])

  useEffect(() => {
    if (!model || !focus.system) return
    if (!model.sys.has(focus.system)) setFocus({})
  }, [model, focus.system])

  // capability level: draw the meaningful dependencies (Claude's labelled links), not every import / call / query between them
  const [allLinks, setAllLinks] = useState(false)
  const semanticOnly = !focus.system && arch?.source !== 'heuristic' && !allLinks
  const graph = useMemo(() => {
    if (!model) return null
    const g = model.graph(focus)
    if (!semanticOnly) return g
    // keep Claude's labelled links, plus every link of a capability that is being built right now (no labels exist yet)
    const building = new Set(model.arch.systems.filter(isProvisional).map((s) => s.id))
    const edges = g.edges.filter((e) => e.claudeLabel || building.has(e.source) || building.has(e.target))
    return edges.length ? { ...g, edges } : g
  }, [model, focus, semanticOnly])

  // ---------- layout (structure only) ----------
  const laid = useMemo<Laid | null>(() => {
    if (!graph || !analysis) return null
    const locOf = (files: string[]) => files.reduce((s, f) => s + (idx?.byPath.get(f)?.loc ?? 0), 0)
    const toNode = (n: MapNode): Node<ArchNodeData> => {
      const s = n.system
      const color = n.kind === 'leaf' ? leafColor(n.leafKind!, n.leafKind === 'file' ? idx?.byPath.get(n.files[0])?.layer : undefined) : kindColor(s?.kind)
      return {
        id: n.key,
        type: 'arch',
        position: { x: 0, y: 0 },
        data: {
          kind: n.kind,
          leafKind: n.leafKind,
          label: n.label,
          sub: n.sub,
          color,
          input: n.kind === 'system' ? s?.input : n.module?.input,
          output: n.kind === 'system' ? s?.output : n.module?.output,
          sysKind: s?.kind,
          sysName: n.kind === 'module' ? (n.module?.layer ? LANE_NAME[n.module.layer] : s?.name) : undefined,
          tech: n.kind === 'system' ? s?.tech : undefined,
          stats: n.kind !== 'leaf' ? statLine(n.files, locOf(n.files), n.kind === 'system' && s?.modules.length ? `${s.modules.length} modules` : n.tables.length ? `${n.tables.length} tables` : undefined) : undefined,
          ghost: n.ghost,
          building: false,
          file: n.leafKind === 'file' ? n.files[0] : undefined,
          drillable: n.kind !== 'leaf',
        },
      }
    }
    const size = (n: Node) => nodeSize(n.data as ArchNodeData)

    // top level: plain layered layout of the systems
    if (!focus.system) {
      const nodes = graph.nodes.map(toNode)
      // grid placement that keeps links from crossing or running behind cards
      return { nodes: layoutMinCross(nodes, graph.edges, size), dir: 'TB', graph, inside: false }
    }

    // inside a system / module: members in a frame, neighbours in side columns
    const members = graph.nodes.filter((n) => !n.ghost).map(toNode)
    const ghosts = graph.nodes.filter((n) => n.ghost)
    const memberEdges = graph.edges.filter((e) => !graph.nodes.find((n) => n.key === e.source)?.ghost && !graph.nodes.find((n) => n.key === e.target)?.ghost)
    // ordered grid: things that call others first, foundations (most depended-on) last — reads top-left → bottom-right
    const score = new Map(members.map((n) => [n.id, 0]))
    for (const e of memberEdges) {
      const w = Object.values(e.kinds).reduce((a, b) => a + b, 0)
      score.set(e.source, (score.get(e.source) ?? 0) + w)
      score.set(e.target, (score.get(e.target) ?? 0) - w)
    }
    const ordered = [...members].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || String((a.data as ArchNodeData).label).localeCompare(String((b.data as ArchNodeData).label)))
    const cell = ordered.length ? size(ordered[0]) : { w: 240, h: 112 }
    const gapX = focus.module ? 60 : 150
    const gapY = focus.module ? 40 : 110
    const cols = Math.max(1, Math.min(ordered.length, Math.round(Math.sqrt(ordered.length * 1.6))))
    // a capability's parts read left → right: screens → endpoints → logic → jobs → data (its tables in the data lane)
    const laneOf = (n: Node): string | null => {
      const mn = graph.nodes.find((x) => x.key === n.id)
      if (mn?.leafKind === 'table') return 'data'
      return mn?.module?.layer ?? null
    }
    const lanesUsed = !focus.module && ordered.some((n) => laneOf(n))
    let packed: Node[]
    if (lanesUsed) {
      const lanes = LANES.filter((l) => ordered.some((n) => (laneOf(n) ?? 'other') === l))
      packed = []
      lanes.forEach((l, li) => {
        let y = 0
        for (const n of ordered.filter((x) => (laneOf(x) ?? 'other') === l)) {
          packed.push({ ...n, position: { x: li * (cell.w + gapX + 60), y } })
          y += size(n).h + 56
        }
      })
    } else
      packed = memberEdges.length || ordered.length > 3
        ? ordered.map((n, i) => ({ ...n, position: { x: (i % cols) * (cell.w + gapX), y: Math.floor(i / cols) * (cell.h + gapY) } }))
        : packLayout(members, memberEdges, size, { gap: 44 })
    const minX = Math.min(...packed.map((n) => n.position.x), 0)
    const minY = Math.min(...packed.map((n) => n.position.y), 0)
    const maxX = Math.max(...packed.map((n) => n.position.x + size(n).w), 300)
    const maxY = Math.max(...packed.map((n) => n.position.y + size(n).h), 120)
    const pad = 48
    const box = { x: minX - pad, y: minY - pad - 10, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 10 }

    const sys = model!.sys.get(focus.system)
    const mod = focus.module ? sys?.modules.find((m) => m.id === focus.module) : undefined
    const frame: Node<BoundaryData> = {
      id: BOUNDARY,
      type: 'boundary',
      position: { x: box.x, y: box.y },
      data: { label: focus.module ? (mod?.name ?? (focus.module === OTHER ? 'Other files' : focus.module)) : (sys?.name ?? focus.system), kind: focus.module ? `in ${sys?.name}` : sys?.kind, color: kindColor(sys?.kind), w: box.w, h: box.h },
      selectable: false,
      draggable: false,
      zIndex: -1,
    }

    // neighbours that mostly call in go left, the rest go right
    const inbound = (k: string) => graph.edges.filter((e) => e.source === k).length >= graph.edges.filter((e) => e.target === k).length && graph.edges.some((e) => e.source === k)
    const left = ghosts.filter((g) => inbound(g.key)).map(toNode)
    const right = ghosts.filter((g) => !inbound(g.key)).map(toNode)
    const column = (list: Node<ArchNodeData>[], x: number) => {
      const total = list.reduce((s, n) => s + size(n).h, 0) + Math.max(0, list.length - 1) * 28
      let y = box.y + box.h / 2 - total / 2
      return list.map((n) => {
        const p = { ...n, position: { x, y } }
        y += size(n).h + 28
        return p
      })
    }
    const ghostW = 270
    const nodes = [frame, ...packed, ...column(left, box.x - GHOST_GAP - ghostW), ...column(right, box.x + box.w + GHOST_GAP)] as Node[]
    return { nodes, dir: 'LR', graph, inside: true }
  }, [graph, analysis, idx, focus, model])

  // ---------- live overlays ----------
  const overlay = useMemo(() => {
    const heatBy = new Map<string, 'claude' | 'codex' | 'fs'>()
    const trail = new Map<string, number>()
    const fresh = new Map<string, { ts: number; n: number }>()
    if (!model) return { heatBy, trail, here: null as string | null, fresh }
    void tick
    const now = Date.now()
    for (const [p, h] of Object.entries(heat)) {
      if (now - h.ts > HEAT_MS) continue
      const k = model.keyForFile(p, focus)
      if (k && (h.by !== 'fs' || !heatBy.has(k))) heatBy.set(k, h.by)
    }
    for (let i = events.length - 1; i >= 0 && trail.size < 5; i--) {
      const e = events[i]
      if (e.source === 'fs' || !e.path) continue
      const k = model.keyForFile(e.path, focus)
      if (k && !trail.has(k)) trail.set(k, trail.size + 1)
    }
    // things that appeared this session (new files, tables, routes, modules…)
    for (const c of changes) {
      let k: string | null = null
      if (c.kind === 'table-added' || c.kind === 'column-added' || c.kind === 'join-added') k = c.table ? model.visible(`t:${c.table}`, focus) : null
      else if (c.kind === 'file-added' || c.kind === 'route-added' || c.kind === 'package-added') k = c.file ? model.keyForFile(c.file, focus) : null
      else if (c.kind === 'module-added' || c.kind === 'system-added') {
        const [s, m] = (c.key ?? '').split('/')
        k = !focus.system ? s : focus.system === s && !focus.module && m ? `${s}/${m}` : null
      }
      if (!k) continue
      const f = fresh.get(k) ?? { ts: 0, n: 0 }
      fresh.set(k, { ts: Math.max(f.ts, c.ts), n: f.n + 1 })
    }
    const here = agentNow?.path ? model.keyForFile(agentNow.path, focus) : null
    return { heatBy, trail, here, fresh }
  }, [model, heat, events, agentNow, focus, changes, tick])

  const neighbours = useMemo(() => {
    const s = new Set<string>()
    if (!selected || !laid) return s
    s.add(selected)
    for (const e of laid.graph.edges) {
      if (e.source === selected) s.add(e.target)
      if (e.target === selected) s.add(e.source)
    }
    return s
  }, [selected, laid])

  const badgeOf = useCallback(
    (n: MapNode | undefined): 'new' | 'changed' | null => {
      if (!n || !sessionStart || arch?.source === 'heuristic') return null
      const it = n.kind === 'module' ? n.module : n.kind === 'system' ? n.system : null
      if (!it) return null
      if ((it.createdAt ?? 0) > sessionStart) return 'new'
      if ((it.updatedAt ?? 0) > sessionStart) return 'changed'
      return null
    },
    [sessionStart, arch],
  )

  // ---------- hand arrangement: dragged positions, remembered per project + level ----------
  const viewKey = `${focus.system ?? ''}/${focus.module ?? ''}`
  const pinKey = analysis ? `ccviz:pos:${analysis.root}:${viewKey}` : ''
  const [pins, setPins] = useState<Record<string, { x: number; y: number }>>({})
  const dragPos = useRef<Record<string, { x: number; y: number }>>({})
  useEffect(() => {
    try {
      setPins(pinKey ? JSON.parse(localStorage.getItem(pinKey) ?? '{}') : {})
    } catch {
      setPins({})
    }
  }, [pinKey])
  const savePins = (p: Record<string, { x: number; y: number }>) => {
    try {
      if (Object.keys(p).length) localStorage.setItem(pinKey, JSON.stringify(p))
      else localStorage.removeItem(pinKey)
    } catch {}
  }

  // Sticky layout: once a card is on screen it stays where it is while the map changes underneath (LIVE updates,
  // Claude re-maps). New cards take their layout spot, nudged to the nearest free space. Auto-arrange resets it.
  const sticky = useRef(new Map<string, Map<string, { x: number; y: number }>>())
  const newcomers = useRef<string[]>([]) // cards that just appeared (live), to check they are in view
  const [offscreen, setOffscreen] = useState<string[]>([])
  const [stickyVer, setStickyVer] = useState(0)
  const placed = useMemo(() => {
    if (!laid) return []
    void stickyVer
    const prev = sticky.current.get(viewKey) ?? new Map<string, { x: number; y: number }>()
    const sz = (n: Node) => nodeSize(n.data as ArchNodeData)
    const settled: Node[] = []
    const fresh: Node[] = []
    for (const n of laid.nodes) {
      if (n.type === 'boundary') continue
      const p = pins[n.id] ?? prev.get(n.id)
      if (p) settled.push({ ...n, position: p })
      else fresh.push(n)
    }
    // a brand-new card goes to its layout spot, or the nearest spot that doesn't cover a card already there
    const hits = (x: number, y: number, n: Node) => {
      const a = sz(n)
      return settled.some((o) => {
        const b = sz(o)
        return x < o.position.x + b.w + 40 && x + a.w + 40 > o.position.x && y < o.position.y + b.h + 30 && y + a.h + 30 > o.position.y
      })
    }
    if (prev.size && fresh.length) newcomers.current = fresh.map((n) => n.id)
    for (const n of fresh) {
      let pos = n.position
      if (prev.size && hits(pos.x, pos.y, n)) {
        const { w, h } = sz(n)
        const steps: [number, number][] = []
        for (let r = 1; r <= 8; r++) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) steps.push([dx * r, dy * r])
        const free = steps.map(([dx, dy]) => ({ x: n.position.x + dx * (w + 60), y: n.position.y + dy * (h + 50) })).find((p) => !hits(p.x, p.y, n))
        if (free) pos = free
      }
      settled.push({ ...n, position: pos })
    }
    const out = new Map(settled.map((n) => [n.id, n.position]))
    sticky.current.set(viewKey, out)
    const boundary = laid.nodes.find((n) => n.type === 'boundary')
    const nodes = boundary ? [boundary, ...settled] : settled
    if (!laid.inside) return nodes
    const ghostSet = new Set(laid.graph.nodes.filter((n) => n.ghost).map((n) => n.key))
    const members = nodes.filter((n) => n.type === 'arch' && !ghostSet.has(n.id))
    if (!members.length) return nodes
    const x1 = Math.min(...members.map((n) => n.position.x)) - 48
    const y1 = Math.min(...members.map((n) => n.position.y)) - 58
    const x2 = Math.max(...members.map((n) => n.position.x + sz(n).w)) + 48
    const y2 = Math.max(...members.map((n) => n.position.y + sz(n).h)) + 48
    return nodes.map((n) => (n.type === 'boundary' ? { ...n, position: { x: x1, y: y1 }, data: { ...n.data, w: x2 - x1, h: y2 - y1 } } : n))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, pins, stickyVer])

  // a flow Claude just added / extended plays across the cards, step by step
  useEffect(() => {
    if (!arch || !laid) return
    const now = Date.now()
    const c = [...changes].reverse().find((x) => (x.kind === 'flow-added' || x.kind === 'flow-updated') && now - x.ts < 8000 && !played.current.has(x.id))
    if (!c) return
    played.current.add(c.id)
    const f = arch.flows.find((x) => x.id === c.key)
    if (!f) return
    const ids = new Set(laid.nodes.map((x) => x.id))
    const keys: string[] = []
    for (const st of f.steps) {
      const k = !focus.system ? st.system : st.system === focus.system ? (st.module ? `${st.system}/${st.module}` : null) : st.system
      if (k && ids.has(k) && keys[keys.length - 1] !== k) keys.push(k)
    }
    if (!keys.length) return
    clearInterval(traceTimer.current)
    setTrace({ keys, step: 0, name: f.name, updated: c.kind === 'flow-updated' })
    let i = 0
    traceTimer.current = window.setInterval(() => {
      i++
      if (i > keys.length + 3) {
        clearInterval(traceTimer.current)
        setTrace(null)
      } else setTrace((t) => t && { ...t, step: Math.min(i, keys.length - 1) })
    }, 700)
  }, [changes, arch, laid, focus.system])
  useEffect(() => () => clearInterval(traceTimer.current), [])

  const activities = useActivities()
  const decorated = useMemo(() => {
    if (!laid) return []
    const byKey = new Map(laid.graph.nodes.map((n) => [n.key, n]))
    return placed.map((n) => {
      if (n.type !== 'arch') return n
      const f = overlay.fresh.get(n.id)
      return {
        ...n,
        data: {
          ...n.data,
          activity: [...activities.entries()].filter(([file]) => model?.keyForFile(file, focus) === n.id).map(([, activity]) => activity).sort((a, b) => Number(b.active) - Number(a.active) || b.ts - a.ts)[0],
          selected: selected === n.id,
          dim: !!selected && !neighbours.has(n.id),
          heat: overlay.heatBy.get(n.id) ?? null,
          claudeHere: overlay.here === n.id,
          agentProvider: agentNow?.source === 'codex' ? 'codex' : 'claude',
          trail: overlay.trail.get(n.id),
          badge: badgeOf(byKey.get(n.id)),
          fresh: freshness(f?.ts),
          freshCount: f?.n,
          flowStep: trace && trace.keys.includes(n.id) ? trace.keys.indexOf(n.id) + 1 : undefined,
          flowLit: !!trace && trace.keys.includes(n.id) && trace.keys.indexOf(n.id) <= trace.step,
        },
      }
    })
  }, [laid, placed, selected, neighbours, activities, model, focus, overlay, badgeOf, trace, agentNow?.source])

  const [nodes, applyDrag] = useMorph(decorated, viewKey)

  // routing must test against the cards as actually drawn: read React Flow's measured sizes once every card is measured
  const measuredAll = useNodesInitialized()

  // while dragging only the dragged card moves (cheap); the layout is committed once, on drop
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const pos = changes.filter((c) => c.type === 'position' && c.id !== BOUNDARY)
      applyDrag(changes.filter((c) => c.type === 'dimensions' || (c.type === 'position' && c.id !== BOUNDARY)))
      if (!pos.length) return
      for (const c of pos) if (c.type === 'position' && c.position) dragPos.current[c.id] = c.position
      if (pos.some((c) => c.type === 'position' && c.dragging === false)) {
        const moved = dragPos.current
        dragPos.current = {}
        if (Object.keys(moved).length)
          setPins((p) => {
            const next = { ...p, ...moved }
            savePins(next)
            return next
          })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyDrag, pinKey],
  )

  // the edges to draw (inside a frame: neighbour edges are bundled to the frame unless they touch the selection)
  const list = useMemo<MapEdge[]>(() => {
    if (!laid) return []
    const ghostSet = new Set(laid.graph.nodes.filter((n) => n.ghost).map((n) => n.key))
    return laid.inside ? bundle(laid.graph.edges, ghostSet, (e) => !!selected && (e.source === selected || e.target === selected)) : laid.graph.edges
  }, [laid, selected])

  // obstacle-aware routing: no line may pass behind a card. Recomputed when cards are placed / resized, not on hover.
  const routing = useMemo(() => {
    const out = new Map<string, Routed>()
    if (!laid) return out
    const box = new Map<string, Box>()
    for (const n of placed) {
      if (n.type === 'boundary') box.set(n.id, { x: n.position.x, y: n.position.y, w: (n.data as BoundaryData).w, h: (n.data as BoundaryData).h })
      else {
        const im = rf.getInternalNode(n.id)?.measured
        const m = im?.width && im?.height ? { w: im.width, h: im.height } : nodeSize(n.data as ArchNodeData)
        box.set(n.id, { x: n.position.x, y: n.position.y, w: m.w, h: m.h })
      }
    }
    const cards = [...box.entries()].filter(([id]) => id !== BOUNDARY)
    // edges to the frame end on its border, so the cards inside it are not in the way; the frame itself is never an obstacle
    const othersFor = (e: MapEdge, a: Box, b: Box) => {
      const o = cards.filter(([id]) => id !== e.source && id !== e.target).map(([, bx]) => bx)
      return e.source === BOUNDARY || e.target === BOUNDARY ? o.filter((x) => !inBox(x, e.source === BOUNDARY ? a : b)) : o
    }
    // 1) sides
    const sides = new Map<string, { ss: Side; ts: Side }>()
    for (const e of list) {
      const a = box.get(e.source)
      const b = box.get(e.target)
      if (a && b) sides.set(e.key, pickSides(a, b, othersFor(e, a, b)))
    }
    // 2) spread the lines that share a card side over its slots, ordered by where each line is heading
    const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]
    const users = new Map<string, { key: string; end: 's' | 't'; along: number; tie: string }[]>()
    for (const e of list) {
      const sd = sides.get(e.key)
      if (!sd) continue
      const a = box.get(e.source)!
      const b = box.get(e.target)!
      // order by the direction the line leaves in (slope from this card's centre), so neighbours on a side never swap
      // over; a two-way pair ties, and is broken the same way on both cards so its two lines stay parallel
      const pair = [e.source, e.target].sort().join('|') + (e.source < e.target ? 0 : 1)
      const push = (node: string, own: Box, side: Side, end: 's' | 't', other: Box) => {
        const k = `${node}|${side}`
        const c = center(other)
        const m = center(own)
        const along = side === 'l' || side === 'r' ? (c[1] - m[1]) / Math.max(Math.abs(c[0] - m[0]), 1) : (c[0] - m[0]) / Math.max(Math.abs(c[1] - m[1]), 1)
        users.set(k, [...(users.get(k) ?? []), { key: e.key, end, along, tie: pair }])
      }
      push(e.source, a, sd.ss, 's', b)
      push(e.target, b, sd.ts, 't', a)
    }
    const slotOf = new Map<string, number>() // `${edgeKey}|s` → slot index
    for (const list2 of users.values()) {
      list2.sort((x, y) => x.along - y.along || (x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0))
      const n = list2.length
      list2.forEach((u, i) => {
        const idx = n === 1 ? 3 : Math.round((i * (SLOTS.length - 1)) / Math.max(1, n - 1))
        slotOf.set(`${u.key}|${u.end}`, n === 1 ? 3 : Math.min(SLOTS.length - 1, Math.max(0, n === 2 ? (i ? 4 : 2) : idx)))
      })
    }
    // 3) final geometry per edge
    for (const e of list) {
      const sd = sides.get(e.key)
      if (!sd) continue
      const a = box.get(e.source)!
      const b = box.get(e.target)!
      out.set(e.key, finalizeEdge(a, b, othersFor(e, a, b), sd.ss, sd.ts, slotOf.get(`${e.key}|s`) ?? 3, slotOf.get(`${e.key}|t`) ?? 3))
    }
    // 4) labels: slide along their line to free space
    const labels = placeLabels(
      list.filter((e) => out.get(e.key)?.points).map((e) => ({ key: e.key, points: out.get(e.key)!.points!, text: edgeSummary(e) })),
      cards.map(([, bx]) => bx),
    )
    // a label with no free spot on its line waits for hover instead of covering another one
    for (const [k, p] of labels) out.set(k, { ...out.get(k)!, labelAt: p ?? undefined, labelHidden: !p } as Routed & { labelAt?: Pt; labelHidden?: boolean })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, placed, list, measuredAll])

  const edges = useMemo<Edge[]>(() => {
    if (!laid) return []
    const weight = (e: MapEdge) => Object.values(e.kinds).reduce((a, b) => a + b, 0)
    const imports = list.filter((e) => dominantKind(e.kinds) === 'import').sort((a, b) => weight(b) - weight(a))
    const keepImports = new Set(imports.slice(0, Math.max(6, Math.round(laid.graph.nodes.length * 1.1))).map((e) => e.key))
    const busy = list.length > 30
    const traceEdge = new Set<string>()
    if (trace) for (let i = 0; i < Math.min(trace.step, trace.keys.length - 1); i++) traceEdge.add(`${trace.keys[i]}→${trace.keys[i + 1]}`)
    return list.map((e) => {
      const k = dominantKind(e.kinds)
      const onTrace = traceEdge.has(e.key)
      const color = onTrace ? '#ff2bd6' : (EDGE_COLOR[k] ?? EDGE_COLOR.other)
      const total = Object.values(e.kinds).reduce((a, b) => a + b, 0)
      const touchesSel = !!selected && (e.source === selected || e.target === selected)
      const hot = !selected || touchesSel
      // weak code dependencies stay in the background until you select something
      const weakImport = k === 'import' && !keepImports.has(e.key) && !touchesSel
      const showLabel = (hot && !weakImport && (touchesSel || k !== 'import' || !busy)) || hoverEdge === e.key
      return {
        id: e.key,
        source: e.source,
        target: e.target,
        ...(routing.get(e.key) ? { sourceHandle: routing.get(e.key)!.sourceHandle, targetHandle: routing.get(e.key)!.targetHandle } : {}),
        hidden: weakImport && !!selected,
        type: 'neon',
        data: { color, flowing: onTrace || (k !== 'import' && k !== 'fk' && hot), weight: onTrace ? 12 : total, route: routing.get(e.key)?.route, plan: routing.get(e.key)?.plan, labelAt: (routing.get(e.key) as (Routed & { labelAt?: Pt }) | undefined)?.labelAt },
        label: showLabel && (!(routing.get(e.key) as { labelHidden?: boolean } | undefined)?.labelHidden || hoverEdge === e.key) ? edgeSummary(e) : undefined,
        labelStyle: { fill: color, fontSize: 10, fontWeight: 500 },
        labelBgStyle: labelBg(color),
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
        style: {
          stroke: color,
          strokeWidth: Math.min(1.2 + Math.log2(total + 1) * 0.7, 4),
          opacity: !hot ? 0.05 : weakImport ? 0.07 : k === 'import' ? 0.5 : 0.95,
          filter: hot && k !== 'import' ? `drop-shadow(0 0 4px ${color})` : undefined,
        },
      }
    })
  }, [laid, list, routing, selected, hoverEdge, trace])

  // new cards that landed outside the visible area: offer to show them (the view itself never moves on its own)
  const canvasRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ids = newcomers.current
    if (!ids.length) return
    newcomers.current = []
    const t = setTimeout(() => {
      const el = canvasRef.current
      if (!el) return
      const { x, y, zoom } = rf.getViewport()
      const W = el.clientWidth
      const H = el.clientHeight
      const out = ids.filter((id) => {
        const n = rf.getNode(id)
        if (!n) return false
        const w = (n.measured?.width ?? 240) * zoom
        const h = (n.measured?.height ?? 120) * zoom
        const sx = n.position.x * zoom + x
        const sy = n.position.y * zoom + y
        return sx + w < 0 || sy + h < 0 || sx > W || sy > H
      })
      if (out.length) setOffscreen((o) => [...new Set([...o, ...out])])
    }, 400)
    return () => clearTimeout(t)
  }, [placed, rf])
  useEffect(() => setOffscreen([]), [viewKey])

  // fit the view when the level changes or the first cards arrive — never just because something was added (LIVE)
  const hasNodes = (laid?.graph.nodes.length ?? 0) > 0
  useEffect(() => {
    if (!hasNodes) return
    const t = setTimeout(() => rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: document.hidden ? 0 : 500 }), 80)
    return () => clearTimeout(t)
  }, [viewKey, hasNodes, rf])

  const drill = useCallback(
    (key: string) => {
      const n = laid?.graph.nodes.find((x) => x.key === key)
      if (!n) return
      if (n.kind === 'leaf') return setSelected(key)
      const [s, m] = key.split('/')
      setSelected(null)
      if (n.ghost) return setFocus(m ? { system: s, module: m } : { system: s })
      if (n.kind === 'system') setFocus({ system: s })
      else setFocus({ system: s, module: m })
    },
    [laid],
  )

  const up = () => {
    setSelected(focus.module ? `${focus.system}/${focus.module}` : (focus.system ?? null))
    setFocus(focus.module ? { system: focus.system } : {})
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else if (focus.system) up()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  // a flow that just appeared in the capability you're looking at plays itself
  useEffect(() => {
    if (!arch || !focus.system) return
    const now = Date.now()
    const c = [...changes].reverse().find((x) => (x.kind === 'flow-added' || x.kind === 'flow-updated') && now - x.ts < 8000)
    const f = c && arch.flows.find((x) => x.id === c.key)
    if (f && f.domain === focus.system) setAutoPlayFlow(`${f.id}:${c!.id}`)
  }, [changes, arch, focus.system])
  useEffect(() => {
    setInsideMode('flows')
    setStepSel(null)
  }, [focus.system])

  if (!analysis || !arch || !model || !laid) return null
  const sys = focus.system ? model.sys.get(focus.system) : undefined
  const mod = focus.module ? sys?.modules.find((m) => m.id === focus.module) : undefined
  const selNode = selected ? laid.graph.nodes.find((n) => n.key === selected) : undefined
  const kindsPresent = [...new Set(laid.graph.edges.map((e) => dominantKind(e.kinds)))]
  const domainFlows = sys ? arch.flows.filter((f) => f.domain === sys.id) : []
  const passingFlows = sys ? arch.flows.filter((f) => f.domain !== sys.id && f.steps.some((s) => s.system === sys.id)) : []
  const showFlows = !!sys && !focus.module && sys.kind !== 'external' && insideMode === 'flows'
  const freshFlows = new Set([
    ...changes.filter((c) => c.kind === 'flow-added' || c.kind === 'flow-updated').map((c) => c.key ?? ''),
    ...(sessionStart && arch.source !== 'heuristic' ? arch.flows.filter((f) => (f.createdAt ?? 0) > sessionStart).map((f) => f.id) : []),
  ])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="map-toolbar flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            {focus.system && (
              <Button size="icon-sm" variant="ghost" onClick={up} aria-label="Up one level">
                <ArrowLeft />
              </Button>
            )}
            <button className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold hover:bg-white/5" onClick={() => (setFocus({}), setSelected(null))}>
              <Network className="size-4 shrink-0 text-[#22e8ff]" /><span className="max-w-[240px] truncate" title={analysis.name}>{analysis.name}</span>
            </button>
            {sys && (
              <>
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <button className="rounded px-1.5 py-0.5 hover:bg-white/5" style={{ color: kindColor(sys.kind) }} onClick={() => (setFocus({ system: sys.id }), setSelected(null))}>
                  {sys.name}
                </button>
              </>
            )}
            {focus.module && (
              <>
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <span className="rounded px-1.5 py-0.5">{mod?.name ?? (focus.module === OTHER ? 'Other files' : focus.module)}</span>
              </>
            )}
          </div>
          {sys && !focus.module && sys.kind !== 'external' && (
            <div className="segmented flex rounded-lg border border-white/10 p-0.5">
              <Button size="xs" variant={insideMode === 'flows' ? 'secondary' : 'ghost'} onClick={() => setInsideMode('flows')}>
                <Workflow /> Flows {domainFlows.length ? <span className="text-muted-foreground">{domainFlows.length}</span> : null}
              </Button>
              <Button size="xs" variant={insideMode === 'parts' ? 'secondary' : 'ghost'} onClick={() => setInsideMode('parts')}>
                <Boxes /> Parts
              </Button>
            </div>
          )}
          {!focus.system && (
            <Button size="xs" variant={allLinks ? 'secondary' : 'outline'} disabled={arch.source === 'heuristic'} aria-pressed={allLinks || arch.source === 'heuristic'} onClick={() => setAllLinks((v) => !v)} title="Also draw every import, HTTP call and table access between capabilities">
              {allLinks ? 'Showing all links' : 'All links'}
            </Button>
          )}
          {!showFlows && (
            <Button size="xs" variant="outline" onClick={() => rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: 500 })} title="Fit every card on screen. Nothing moves." className="border-white/15 text-slate-200 hover:bg-white/[0.06]">
              <LocateFixed /> Recenter
            </Button>
          )}
          {!showFlows && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setPins({})
              savePins({})
              sticky.current.delete(viewKey)
              setStickyVer((v) => v + 1)
              setTimeout(() => rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: 600 }), 820)
            }}
            title={Object.keys(pins).length ? 'Forget the positions you dragged on this level and lay the cards out again' : 'Lay the cards out with as few crossing lines as possible'}
            className="border-[#22e8ff]/30 text-[#bff7ff] hover:bg-[#22e8ff]/10"
          >
            <LayoutGrid /> Auto-arrange
          </Button>
          )}
          <div className="mapping-row min-w-0">
            <MapperBar />
          </div>
        </div>

        {!focus.system && arch.summary && <p className="border-b border-white/5 px-5 py-2 text-[13px] text-slate-300">{arch.summary}</p>}
        {focus.system && (mod?.summary || sys?.summary) && <p className="border-b border-white/5 px-5 py-2 text-[13px] text-slate-300">{mod?.summary ?? sys?.summary}</p>}

        {showFlows && sys ? (
          <div className="min-h-0 flex-1">
            <DomainFlows
              domain={sys}
              flows={domainFlows}
              passing={passingFlows}
              systems={model.sys}
              autoPlayId={autoPlayFlow?.split(':')[0] ?? null}
              freshIds={freshFlows}
              selected={stepSel}
              onPick={(s) => setStepSel(s)}
              onOpenDomain={(id) => {
                setSelected(null)
                setFocus({ system: id })
              }}
            />
          </div>
        ) : (
        <div ref={canvasRef} className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={archNodeTypes}
            colorMode="dark"
            minZoom={0.05}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            nodesDraggable
            onNodesChange={onNodesChange}
            edgeTypes={neonEdgeTypes}
            zoomOnDoubleClick={false}
            onNodeClick={(_, n) => n.type === 'arch' && setSelected(n.id)}
            onNodeDoubleClick={(_, n) => n.type === 'arch' && drill(n.id)}
            onPaneClick={() => setSelected(null)}
            onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
            onEdgeMouseLeave={() => setHoverEdge(null)}
            onEdgeClick={(_, e) => e.source !== BOUNDARY && setSelected(e.source)}
          >
            <Controls showInteractive={false} position="bottom-left" />
            {nodes.length > 25 && <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'boundary' ? 'transparent' : (n.data as ArchNodeData).color)} maskColor="rgba(5,5,8,0.75)" />}
          </ReactFlow>
          {offscreen.length > 0 && (
            <button
              onClick={() => {
                rf.fitView({ padding: 0.12, maxZoom: 1.1, duration: 600 })
                setOffscreen([])
              }}
              className="toast-in absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#b6ff3b]/60 bg-black/85 px-4 py-1.5 font-mono text-[12px] text-[#e4ffb8] shadow-[0_0_30px_-6px_#b6ff3b] hover:bg-[#b6ff3b]/10"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b6ff3b] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[#b6ff3b]" />
              </span>
              +{offscreen.length} new card{offscreen.length > 1 ? 's' : ''} out of view — show
            </button>
          )}
          {trace && (
            <div className="toast-in pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[#ff2bd6]/60 bg-black/80 px-4 py-1.5 font-mono text-[12px] text-[#ff9bea] shadow-[0_0_30px_-6px_#ff2bd6]">
              ▶ {trace.updated ? 'Flow grew' : 'New flow'}: <b className="text-white">{trace.name}</b>
            </div>
          )}
          {laid.graph.nodes.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Nothing here yet.</div>}
          {settings?.showLegends !== false && <div className="graph-legend pointer-events-none absolute right-4 bottom-3 left-16 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-white/10 bg-[#090c12]/95 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            {kindsPresent.map((k) => <EdgeKey key={k} color={EDGE_COLOR[k]} label={EDGE_LABEL[k]} />)}
            <span className="ml-auto text-[11px] text-slate-400">Click: details · Double-click: open · Esc: back</span>
          </div>}
        </div>
        )}
      </div>

      {stepSel && showFlows && (
        <aside className="w-[380px] shrink-0 border-l border-white/5 bg-black/40 backdrop-blur-xl">
          <WriteDetail
            step={stepSel}
            onClose={() => setStepSel(null)}
            onOpenFile={(f) => {
              setStepSel(null)
              setSelected(`f:${f}`)
            }}
          />
        </aside>
      )}
      {!stepSel && (selNode || selected?.startsWith('f:')) && (
        <aside className="w-[380px] shrink-0 border-l border-white/5 bg-black/40 backdrop-blur-xl">
          {!selNode || (selNode.kind === 'leaf' && selNode.leafKind === 'file') ? (
            <FileDetail path={selNode ? selNode.files[0] : selected!.slice(2)} onClose={() => setSelected(null)} onPick={(p) => setSelected(`f:${p}`)} />
          ) : (
            <ArchCard node={selNode} model={model} focus={focus} onClose={() => setSelected(null)} onOpen={() => drill(selNode.key)} onPick={setSelected} />
          )}
        </aside>
      )}
    </div>
  )
}

export function SystemMap() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  )
}
