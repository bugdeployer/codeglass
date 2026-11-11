import { IOFields } from './IOFields'
import { useMemo } from 'react'
import { ArrowDownLeft, ArrowUpRight, FileCode2, KeyRound, Link2, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { KIND_ICON, kindColor } from '@/components/MapNodes'
import { EDGE_COLOR, KIND_LABEL, LAYER_COLOR } from '@/lib/colors'
import { ago, fmt, useIndex } from '@/lib/graph'
import { dominantKind, edgeSummary, OTHER, type Focus, type MapNode, type Model } from '@/lib/model'
import { useProject } from '@/lib/store'

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section>
      <h4 className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title} {count != null && <span className="text-slate-500">{count}</span>}
      </h4>
      {children}
    </section>
  )
}

export function ArchCard({ node, model, focus, onClose, onOpen, onPick }: { node: MapNode; model: Model; focus: Focus; onClose: () => void; onOpen: () => void; onPick: (key: string) => void }) {
  const { analysis, events } = useProject()
  const idx = useIndex()

  // the level this node lives at (where its neighbours are siblings)
  const level: Focus = useMemo(() => {
    if (node.kind === 'system') return {}
    if (node.kind === 'module') return { system: node.key.split('/')[0] }
    return focus
  }, [node, focus])
  const levelGraph = useMemo(() => model.graph(level), [model, level])
  const out = levelGraph.edges.filter((e) => e.source === node.key)
  const inc = levelGraph.edges.filter((e) => e.target === node.key)
  const labelOf = (k: string) => levelGraph.nodes.find((n) => n.key === k)?.label ?? k

  const files = node.files
  const loc = files.reduce((s, f) => s + (idx?.byPath.get(f)?.loc ?? 0), 0)
  const tables = useMemo(() => {
    const fs = new Set(files)
    return [...new Set(analysis?.dbAccess.filter((d) => fs.has(d.file)).map((d) => d.table) ?? [])]
  }, [files, analysis])
  const routes = useMemo(() => {
    const fs = new Set(files)
    return analysis?.routes.filter((r) => fs.has(r.file)) ?? []
  }, [files, analysis])
  const activity = useMemo(
    () =>
      events
        .filter((e) => e.path && model.keyForFile(e.path, level) === node.key)
        .slice(-6)
        .reverse(),
    [events, model, level, node.key],
  )

  const s = node.system
  const color = node.kind === 'leaf' ? (node.leafKind === 'table' ? LAYER_COLOR.table : LAYER_COLOR.external) : kindColor(s?.kind)
  const Icon = s ? KIND_ICON[s.kind] : FileCode2
  const table = node.leafKind === 'table' ? analysis?.schema.tables.find((t) => t.name === node.tables[0]) : undefined
  const keyFiles = node.module?.keyFiles?.length ? node.module.keyFiles : [...files].sort((a, b) => (idx?.byPath.get(b)?.loc ?? 0) - (idx?.byPath.get(a)?.loc ?? 0)).slice(0, 6)

  const EdgeList = ({ list, dir }: { list: typeof out; dir: 'out' | 'in' }) => (
    <ul className="space-y-1.5">
      {list.map((e) => {
        const k = dominantKind(e.kinds)
        const other = dir === 'out' ? e.target : e.source
        return (
          <li key={e.key} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
            <button className="flex w-full items-center gap-1.5 text-left text-[12px] font-medium hover:text-[#22e8ff]" onClick={() => onPick(other)}>
              {dir === 'out' ? <ArrowUpRight className="size-3.5" style={{ color: EDGE_COLOR[k] }} /> : <ArrowDownLeft className="size-3.5" style={{ color: EDGE_COLOR[k] }} />}
              {labelOf(other)}
            </button>
            <div className="mt-2"><IOFields input={e.input} output={e.output} /></div>
            <div className="mt-0.5 truncate font-mono text-[10px]" style={{ color: EDGE_COLOR[k] }} title={e.labels.join('\n')}>
              {edgeSummary(e)}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-white/5 p-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ color, background: `${color}14`, boxShadow: `0 0 22px -6px ${color}` }}>
            <Icon className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold tracking-tight">{node.label}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color }}>
              {node.kind === 'system' ? KIND_LABEL[s!.kind] : node.kind === 'module' ? `module · ${s?.name}` : node.leafKind}
            </div>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {node.kind !== 'leaf' && <div className="mt-3"><IOFields input={node.module?.input ?? s?.input} output={node.module?.output ?? s?.output} /></div>}
        {node.sub && node.kind !== 'leaf' && <p className="mt-3 text-[13px] leading-relaxed text-slate-200">{node.sub}</p>}
        {node.kind !== 'leaf' && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={onOpen} className="bg-white/10 text-white hover:bg-white/15">
              <Maximize2 /> Look inside
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground">
              {files.length} files · {fmt(loc)} lines
            </span>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {s && node.kind === 'system' && s.tech.length > 0 && (
            <Section title="Tech">
              <div className="flex flex-wrap gap-1">
                {s.tech.map((t) => (
                  <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[11px]">
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {s && node.kind === 'system' && model.arch.flows.some((f) => f.domain === s.id) && (
            <Section title="Flows" count={model.arch.flows.filter((f) => f.domain === s.id).length}>
              <ul className="space-y-1">
                {model.arch.flows
                  .filter((f) => f.domain === s.id)
                  .map((f) => (
                    <li key={f.id}>
                      <button onClick={onOpen} className="w-full rounded-md border border-[#ff2bd6]/20 bg-[#ff2bd6]/[0.04] px-2.5 py-1.5 text-left hover:border-[#ff2bd6]/50">
                        <div className="text-[12px] font-medium">{f.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {f.trigger} · {f.steps.length} steps
                        </div>
                      </button>
                    </li>
                  ))}
              </ul>
            </Section>
          )}

          {s && node.kind === 'system' && s.modules.length > 0 && (
            <Section title="Parts" count={s.modules.length}>
              <ul className="space-y-1.5">
                {s.modules.map((m) => (
                  <li key={m.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                    <div className="text-[12px] font-medium">{m.name}</div>
                    <div className="text-[11px] leading-snug text-muted-foreground">{m.summary}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {out.length > 0 && (
            <Section title="Talks to" count={out.length}>
              <EdgeList list={out} dir="out" />
            </Section>
          )}
          {inc.length > 0 && (
            <Section title="Used by" count={inc.length}>
              <EdgeList list={inc} dir="in" />
            </Section>
          )}

          {s && node.kind === 'system' && s.entryPoints.length > 0 && (
            <Section title="Entry points">
              <ul className="space-y-0.5 font-mono text-[11px]">
                {s.entryPoints.slice(0, 10).map((e) => (
                  <li key={e} className="truncate" title={e}>
                    {idx?.byPath.has(e) ? (
                      <button className="hover:text-[#22e8ff]" onClick={() => onPick(`f:${e}`)}>
                        {e}
                      </button>
                    ) : (
                      e
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {routes.length > 0 && (
            <Section title="Routes" count={routes.length}>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {routes.slice(0, 14).map((r, i) => (
                  <li key={i}>
                    <span className="mr-2 text-[#ffb020]">{r.method}</span>
                    {r.path}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {tables.length > 0 && (
            <Section title="Data it touches" count={tables.length}>
              <div className="flex flex-wrap gap-1">
                {tables.map((t) => (
                  <span key={t} className="rounded border border-[#b6ff3b]/30 bg-[#b6ff3b]/5 px-1.5 py-0.5 font-mono text-[11px] text-[#d8ff9a]">
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {table && (
            <Section title="Columns" count={table.columns.length}>
              <ul className="space-y-0.5">
                {table.columns.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 font-mono text-[11px]">
                    {c.pk ? <KeyRound className="size-3 text-[#ffb020]" /> : c.fk ? <Link2 className="size-3 text-[#22e8ff]" /> : <span className="size-3" />}
                    {c.name}
                    <span className="ml-auto text-muted-foreground">
                      {c.type}
                      {c.fk ? ` → ${c.fk.table}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {node.kind === 'system' && s?.packages.length ? (
            <Section title="Packages">
              <div className="flex flex-wrap gap-1">
                {s.packages.map((p) => (
                  <span key={p} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[11px]">
                    {p}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {keyFiles.length > 0 && node.kind !== 'leaf' && (
            <Section title={node.module?.keyFiles?.length ? 'Key files' : 'Largest files'}>
              <ul className="space-y-0.5">
                {keyFiles.map((f) => (
                  <li key={f}>
                    <button className="w-full truncate text-left font-mono text-[11px] text-slate-300 hover:text-[#22e8ff]" title={f} onClick={() => onPick(`f:${f}`)}>
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {activity.length > 0 && (
            <Section title="Recent activity">
              <ul className="space-y-1">
                {activity.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                    <span className={e.source === 'claude' ? 'text-[#ffb020]' : 'text-[#22e8ff]'}>{e.source !== 'fs' ? `${e.source === 'codex' ? 'Codex' : 'Claude'} ${e.action ?? e.kind}` : e.kind}</span>
                    <span className="truncate font-mono text-slate-400">{e.path?.split('/').pop()}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{ago(e.ts)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {node.key.endsWith('/' + OTHER) && <p className="text-xs text-muted-foreground">Files the mapper didn't place in a specific module.</p>}
        </div>
      </ScrollArea>
    </div>
  )
}
