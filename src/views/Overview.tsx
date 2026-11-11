import { useEffect, useMemo, useRef } from 'react'
import { animate, stagger } from 'animejs'
import { AlertTriangle, BarChart3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CountUp } from '@/components/CountUp'
import { EvilBarChart } from '@/components/evilcharts/charts/recharts-bar-chart'
import { EvilPieChart } from '@/components/evilcharts/charts/recharts-pie-chart'
import { LAYER_COLOR, LAYER_LABEL, langColor } from '@/lib/colors'
import { baseOf, fmt, fmtBytes, useIndex } from '@/lib/graph'
import { useProject } from '@/lib/store'
import type { Layer } from '@/lib/types'

export function Overview() {
  const { analysis } = useProject()
  const idx = useIndex()
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!grid.current || document.hidden) return
    animate(grid.current.querySelectorAll('[data-in]'), {
      opacity: [0, 1],
      translateY: [14, 0],
      delay: stagger(60),
      duration: 650,
      ease: 'outExpo',
    })
  }, [analysis?.root])

  const langs = useMemo(() => {
    if (!analysis) return []
    const L = analysis.stats.languages.filter((l) => l.loc > 0)
    const top = L.slice(0, 7)
    const rest = L.slice(7).reduce((s, l) => s + l.loc, 0)
    return rest ? [...top, { lang: 'Other', files: 0, loc: rest }] : top
  }, [analysis])

  const layerData = useMemo(() => {
    if (!analysis) return []
    const m = new Map<Layer, number>()
    for (const f of analysis.files) if (f.loc > 0) m.set(f.layer, (m.get(f.layer) ?? 0) + f.loc)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([layer, loc]) => ({ layer: LAYER_LABEL[layer].split(' /')[0], loc, color: LAYER_COLOR[layer] }))
  }, [analysis])

  const topFiles = useMemo(() => (analysis ? [...analysis.files].filter((f) => f.loc > 0).sort((a, b) => b.loc - a.loc).slice(0, 8) : []), [analysis])
  const hubs = useMemo(() => {
    if (!idx) return []
    return [...idx.importedBy.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)
  }, [idx])

  if (!analysis) return null
  const a = analysis
  const stats = [
    { label: 'Files', value: a.stats.files },
    { label: 'Lines of code', value: a.stats.loc },
    { label: 'Folders', value: a.stats.dirs },
    { label: 'Import links', value: a.edges.length },
    { label: 'API routes', value: a.routes.length },
    { label: 'DB tables', value: a.schema.tables.length },
  ]
  const pieConfig = Object.fromEntries(langs.map((l) => [l.lang, { label: l.lang, colors: { dark: [l.lang === 'Other' ? '#64748b' : langColor(l.lang)] } }]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="map-toolbar flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex items-center gap-1.5 px-1.5 text-sm font-semibold"><BarChart3 className="size-4 shrink-0 text-[#22e8ff]" /><span className="max-w-[240px] truncate" title={a.name}>{a.name}</span></span>
        {a.frameworks.map((f) => (
          <Badge key={f} variant="secondary">
            {f}
          </Badge>
        ))}
        <span className="ml-auto truncate pl-4 font-mono text-[11px] text-muted-foreground" title={a.root}>
          {a.root} · scanned in {a.durationMs} ms · {fmtBytes(a.stats.bytes)}
        </span>
      </div>
    <div ref={grid} className="min-h-0 flex-1 overflow-y-auto p-5">
      {a.truncated && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          <AlertTriangle className="size-4" /> Very large project — scan capped at 12,000 files. Add build output to .gitignore to see everything relevant.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} size="sm" data-in>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums tracking-tight">
                <CountUp value={s.value} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card data-in>
          <CardHeader>
            <CardTitle>Languages</CardTitle>
            <CardDescription>Share of lines of code</CardDescription>
          </CardHeader>
          <CardContent>
            {langs.length ? (
              <EvilPieChart config={pieConfig} data={langs} dataKey="loc" nameKey="lang" className="h-64 w-full">
                <EvilPieChart.Pie innerRadius="58%" />
                <EvilPieChart.Tooltip />
                <EvilPieChart.Legend />
              </EvilPieChart>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No source files yet.</p>
            )}
          </CardContent>
        </Card>

        <Card data-in>
          <CardHeader>
            <CardTitle>Where the code lives</CardTitle>
            <CardDescription>Lines of code by architectural layer</CardDescription>
          </CardHeader>
          <CardContent>
            {layerData.length ? (
              <EvilBarChart data={layerData} config={{ loc: { label: 'Lines', colors: { dark: ['#5eead4', '#38bdf8'] } } }} className="h-64 w-full">
                <EvilBarChart.Grid />
                <EvilBarChart.XAxis dataKey="layer" />
                <EvilBarChart.Bar dataKey="loc" variant="gradient" />
                <EvilBarChart.Tooltip />
              </EvilBarChart>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Nothing to chart yet.</p>
            )}
          </CardContent>
        </Card>

        <Card data-in>
          <CardHeader>
            <CardTitle>Largest files</CardTitle>
            <CardDescription>Candidates for splitting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {topFiles.map((f) => (
              <div key={f.path} data-file={f.path} className="flex items-center gap-3 rounded px-1 text-sm">
                <i className="size-2 shrink-0 rounded-full" style={{ background: langColor(f.lang) }} />
                <span className="truncate font-mono text-xs" title={f.path}>
                  {baseOf(f.path)}
                </span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">{f.path.slice(0, f.path.length - baseOf(f.path).length)}</span>
                <span className="ml-auto font-mono text-xs tabular-nums">{fmt(f.loc)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-in>
          <CardHeader>
            <CardTitle>Hubs</CardTitle>
            <CardDescription>Most imported modules — changing these ripples furthest</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hubs.length === 0 && <p className="text-sm text-muted-foreground">No import links yet.</p>}
            {hubs.map(([p, by]) => {
              const max = hubs[0][1].length
              return (
                <div key={p} data-file={p} className="relative flex items-center gap-3 rounded px-1 text-sm">
                  <div className="absolute inset-y-0 left-0 rounded bg-primary/10" style={{ width: `${(by.length / max) * 100}%` }} />
                  <span className="relative truncate font-mono text-xs" title={p}>
                    {p}
                  </span>
                  <span className="relative ml-auto font-mono text-xs tabular-nums">{by.length}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {a.externals.length > 0 && (
        <Card className="mt-4" data-in>
          <CardHeader>
            <CardTitle>Packages in use</CardTitle>
            <CardDescription>By number of files importing them</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {a.externals.slice(0, 40).map((e) => (
              <Badge key={e.name} variant={e.category === 'package' ? 'outline' : 'secondary'} className="font-mono">
                {e.name} <span className="ml-1 opacity-60">{e.count}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
    </div>
  )
}
