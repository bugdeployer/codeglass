import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, pack, treemap, treemapSquarify, type HierarchyNode } from 'd3-hierarchy'
import { animate, stagger } from 'animejs'
import { ChevronRight, Circle, LayoutGrid, Mountain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileDetail } from '@/components/FileDetail'
import { LAYER_COLOR, LAYER_LABEL, langColor } from '@/lib/colors'
import { ago, fmt } from '@/lib/graph'
import { usePreferences } from '@/lib/preferences'
import { useProject } from '@/lib/store'
import type { TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'

type Mode = 'contour' | 'treemap'
type ColorBy = 'lang' | 'layer' | 'recent'

const W = 1000
const H = 680
const MAX_LEAVES = 1400

function find(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    if (path === c.path || path.startsWith(c.path + '/')) {
      const r = find(c, path)
      if (r) return r
    }
  }
  return null
}

function prune(node: TreeNode, budget: { n: number }): TreeNode | null {
  if (!node.children) {
    if (node.loc <= 0) return null
    if (budget.n-- <= 0) return null
    return node
  }
  const kids = node.children.map((c) => prune(c, budget)).filter(Boolean) as TreeNode[]
  if (!kids.length) return null
  return { ...node, children: kids }
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
}

export function Topography() {
  const { analysis, heat } = useProject()
  const { settings } = usePreferences()
  const [focus, setFocus] = useState('')
  const [mode, setMode] = useState<Mode>('contour')
  const [colorBy, setColorBy] = useState<ColorBy>('lang')
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<{ node: TreeNode; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const focusNode = useMemo(() => (analysis ? (find(analysis.tree, focus) ?? analysis.tree) : null), [analysis, focus])

  const root = useMemo(() => {
    if (!focusNode) return null
    const pruned = prune(focusNode, { n: MAX_LEAVES }) ?? focusNode
    const h = hierarchy<TreeNode>(pruned, (d) => d.children).sum((d) => (d.children ? 0 : Math.pow(Math.max(d.loc, 1), 0.85)))
    h.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    if (mode === 'contour') return pack<TreeNode>().size([W, H]).padding((d) => (d.depth === 0 ? 8 : 5))(h)
    return treemap<TreeNode>().size([W, H]).tile(treemapSquarify).paddingInner(2).paddingOuter(4).paddingTop(16).round(true)(h)
  }, [focusNode, mode])

  // entrance animation when layout changes
  const layoutKey = `${focus}|${mode}`
  useEffect(() => {
    if (!svgRef.current || document.hidden) return
    const leaves = svgRef.current.querySelectorAll('.t-leaf')
    const folders = svgRef.current.querySelectorAll('.t-folder')
    animate(folders, { opacity: [0, 1], duration: 500, delay: stagger(12), ease: 'outQuad' })
    animate(leaves, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 650,
      delay: stagger(Math.min(6, 900 / Math.max(leaves.length, 1)), { from: 'center' }),
      ease: 'outBack(1.4)',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, !!root])

  if (!analysis || !focusNode || !root) return null

  const now = Date.now()
  const colorOf = (d: TreeNode) => {
    if (colorBy === 'lang') return langColor(d.lang ?? 'Other')
    if (colorBy === 'layer') return LAYER_COLOR[d.layer ?? 'other']
    const h = heat[d.path]
    if (h && now - h.ts < 90_000) return '#fbbf24'
    const age = now - (d.mtime ?? 0)
    const t = Math.max(0, Math.min(1, 1 - Math.log10(age / 60000 + 1) / 4.2))
    return lerpColor([51, 65, 85], [94, 234, 212], t)
  }

  const crumbs = focus ? focus.split('/') : []
  const nodes = root.descendants() as unknown as (HierarchyNode<TreeNode> & { x: number; y: number; r: number; x0: number; x1: number; y0: number; y1: number })[]
  const folders = nodes.filter((n) => n.children && n.depth > 0)
  const leaves = nodes.filter((n) => !n.children)

  const onEnter = (e: React.MouseEvent, node: TreeNode) => {
    const box = wrapRef.current!.getBoundingClientRect()
    setHover({ node, x: e.clientX - box.left, y: e.clientY - box.top })
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="map-toolbar flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <button className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold hover:bg-white/5" onClick={() => setFocus('')}>
              <Mountain className="size-4 shrink-0 text-[#22e8ff]" /><span className="max-w-[240px] truncate" title={analysis.name}>{analysis.name}</span>
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <button
                  className={cn('rounded px-1.5 py-0.5 hover:bg-white/5', i === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground')}
                  onClick={() => setFocus(crumbs.slice(0, i + 1).join('/'))}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="segmented flex rounded-lg border border-white/10 p-0.5">
              {(['lang', 'layer', 'recent'] as ColorBy[]).map((c) => (
                <Button key={c} size="xs" variant={colorBy === c ? 'secondary' : 'ghost'} onClick={() => setColorBy(c)}>
                  {c === 'lang' ? 'Language' : c === 'layer' ? 'Layer' : 'Recency'}
                </Button>
              ))}
            </div>
            <div className="segmented flex rounded-lg border border-white/10 p-0.5">
              <Button size="xs" variant={mode === 'contour' ? 'secondary' : 'ghost'} onClick={() => setMode('contour')}>
                <Circle /> Contour
              </Button>
              <Button size="xs" variant={mode === 'treemap' ? 'secondary' : 'ghost'} onClick={() => setMode('treemap')}>
                <LayoutGrid /> Treemap
              </Button>
            </div>
          </div>
        </div>

        <div ref={wrapRef} className="relative min-h-0 flex-1 p-3">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="size-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              <radialGradient id="terrain" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="#5eead4" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill="url(#terrain)" />

            {mode === 'contour' ? (
              <>
                {folders.map((n) => (
                  <g key={n.data.path} className="t-folder cursor-pointer" data-folder={n.data.path} onClick={() => setFocus(n.data.path)}>
                    <circle cx={n.x} cy={n.y} r={n.r} fill={`rgba(94,234,212,${0.025 + n.depth * 0.018})`} stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
                    {n.r > 28 && <circle cx={n.x} cy={n.y} r={n.r - 4} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth={1} strokeDasharray="2 4" />}
                    {n.r > 60 && <circle cx={n.x} cy={n.y} r={n.r - 9} fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth={1} />}
                  </g>
                ))}
                {leaves.map((n) => (
                  <circle
                    key={n.data.path}
                    className="t-leaf cursor-pointer"
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    data-file={n.data.path}
                    cx={n.x}
                    cy={n.y}
                    r={Math.max(n.r - 0.6, 1)}
                    fill={colorOf(n.data)}
                    fillOpacity={selected === n.data.path ? 1 : 0.78}
                    stroke={selected === n.data.path ? '#fff' : 'rgba(0,0,0,0.35)'}
                    strokeWidth={selected === n.data.path ? 2 : 0.6}
                    onMouseMove={(e) => onEnter(e, n.data)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(n.data.path)}
                  />
                ))}
                {folders
                  .filter((n) => n.r > 38)
                  .map((n) => (
                    <text
                      key={'l' + n.data.path}
                      x={n.x}
                      y={n.y - n.r + 14}
                      textAnchor="middle"
                      className="pointer-events-none fill-slate-300 font-mono"
                      style={{ fontSize: Math.min(13, Math.max(8, n.r / 7)), paintOrder: 'stroke' }}
                      stroke="rgba(15,18,28,0.9)"
                      strokeWidth={3}
                    >
                      {n.data.name}
                    </text>
                  ))}
              </>
            ) : (
              <>
                {folders.map((n) => (
                  <g key={n.data.path} className="t-folder cursor-pointer" data-folder={n.data.path} onClick={() => setFocus(n.data.path)}>
                    <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={n.y1 - n.y0} rx={4} fill={`rgba(94,234,212,${0.02 + n.depth * 0.015})`} stroke="rgba(148,163,184,0.3)" />
                    {n.x1 - n.x0 > 50 && (
                      <text x={n.x0 + 6} y={n.y0 + 12} className="pointer-events-none fill-slate-400 font-mono" style={{ fontSize: 10 }}>
                        {n.data.name}
                      </text>
                    )}
                  </g>
                ))}
                {leaves.map((n) => (
                  <rect
                    key={n.data.path}
                    className="t-leaf cursor-pointer"
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    data-file={n.data.path}
                    x={n.x0}
                    y={n.y0}
                    width={Math.max(n.x1 - n.x0, 1)}
                    height={Math.max(n.y1 - n.y0, 1)}
                    rx={2}
                    fill={colorOf(n.data)}
                    fillOpacity={selected === n.data.path ? 1 : 0.78}
                    stroke={selected === n.data.path ? '#fff' : 'rgba(0,0,0,0.35)'}
                    strokeWidth={selected === n.data.path ? 2 : 0.6}
                    onMouseMove={(e) => onEnter(e, n.data)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(n.data.path)}
                  />
                ))}
              </>
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 220), top: hover.y + 14 }}
            >
              <div className="font-mono font-medium">{hover.node.name}</div>
              <div className="text-muted-foreground">
                {hover.node.lang} · {fmt(hover.node.loc)} lines · {LAYER_LABEL[hover.node.layer ?? 'other']}
              </div>
              <div className="text-muted-foreground">edited {ago(hover.node.mtime ?? 0)}</div>
            </div>
          )}

          {settings?.showLegends !== false && <div className="graph-legend pointer-events-none absolute right-4 bottom-3 left-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-white/10 bg-[#090c12]/95 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            {colorBy === 'lang' &&
              analysis.stats.languages.slice(0, 7).map((l) => (
                <span key={l.lang} className="flex items-center gap-2">
                  <i className="size-2 rounded-full" style={{ background: langColor(l.lang) }} />
                  {l.lang}
                </span>
              ))}
            {colorBy === 'layer' &&
              (['ui', 'api', 'service', 'data', 'test', 'config'] as const).map((l) => (
                <span key={l} className="flex items-center gap-2">
                  <i className="size-2 rounded-full" style={{ background: LAYER_COLOR[l] }} />
                  {LAYER_LABEL[l]}
                </span>
              ))}
            {colorBy === 'recent' && <span>Brighter = edited more recently · Amber = touched in the last 90 seconds</span>}
            <span className="ml-auto text-[11px] text-slate-400">Click a folder: open · Click a file: details</span>
          </div>}
        </div>
      </div>

      {selected && (
        <aside className="w-[380px] shrink-0 border-l border-white/5 bg-black/40 backdrop-blur-xl">
          <FileDetail path={selected} onClose={() => setSelected(null)} onPick={setSelected} />
        </aside>
      )}
    </div>
  )
}
