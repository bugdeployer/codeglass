import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LAYER_COLOR, LAYER_LABEL, langColor } from '@/lib/colors'
import { ago, fmt, fmtBytes, useIndex } from '@/lib/graph'
import { useProject } from '@/lib/store'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono">{children}</span>
    </div>
  )
}

function FileList({ title, files, onPick }: { title: string; files: string[]; onPick?: (p: string) => void }) {
  if (!files.length) return null
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title} <span className="text-foreground/60">{files.length}</span>
      </div>
      <ul className="space-y-0.5">
        {files.slice(0, 14).map((f) => (
          <li key={f}>
            <button className="w-full truncate text-left font-mono text-xs text-foreground/80 hover:text-primary" title={f} onClick={() => onPick?.(f)}>
              {f}
            </button>
          </li>
        ))}
        {files.length > 14 && <li className="text-xs text-muted-foreground">+{files.length - 14} more</li>}
      </ul>
    </div>
  )
}

export function FileDetail({ path, onClose, onPick }: { path: string; onClose: () => void; onPick?: (p: string) => void }) {
  const { analysis, heat } = useProject()
  const idx = useIndex()
  const f = idx?.byPath.get(path)
  if (!analysis || !idx) return null
  if (!f)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {path} no longer exists.
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  const h = heat[path]
  const routes = idx.routesByFile.get(path) ?? []
  const tables = idx.tablesByFile.get(path) ?? []
  const calls = idx.callsByFile.get(path) ?? []
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-medium" title={f.path}>
            {f.path.split('/').pop()}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{f.path}</div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" style={{ borderColor: LAYER_COLOR[f.layer], color: LAYER_COLOR[f.layer] }}>
              {LAYER_LABEL[f.layer]}
            </Badge>
            <Badge variant="outline">
              <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: langColor(f.lang) }} />
              {f.lang}
            </Badge>
            {h && (
              <Badge variant="outline" className="border-amber-400/60 text-amber-300">
                {h.by === 'claude' ? `Claude · ${h.kind}` : h.by === 'codex' ? `Codex · ${h.kind}` : h.kind} {ago(h.ts)}
              </Badge>
            )}
          </div>
          <div className="space-y-1.5">
            <Row label="Lines">{fmt(f.loc)}</Row>
            <Row label="Size">{fmtBytes(f.size)}</Row>
            <Row label="Modified">{ago(f.mtime)}</Row>
          </div>
          {routes.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Routes</div>
              {routes.map((r, i) => (
                <div key={i} className="font-mono text-xs">
                  <span className="mr-2 text-amber-300">{r.method}</span>
                  {r.path}
                </div>
              ))}
            </div>
          )}
          {calls.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Calls out</div>
              {calls.map((c, i) => (
                <div key={i} className="truncate font-mono text-xs" title={c.url}>
                  <span className="mr-2 text-teal-300">{c.method ?? 'GET'}</span>
                  {c.url}
                  {c.to && <span className="text-muted-foreground"> → {c.to.split('/').pop()}</span>}
                </div>
              ))}
            </div>
          )}
          {tables.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Touches tables</div>
              <div className="flex flex-wrap gap-1.5">
                {tables.map((t) => (
                  <Badge key={t} variant="secondary" className="font-mono">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <FileList title="Imports" files={f.imports} onPick={onPick} />
          <FileList title="Imported by" files={idx.importedBy.get(path) ?? []} onPick={onPick} />
          {f.externals.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Packages</div>
              <div className="flex flex-wrap gap-1.5">
                {f.externals.map((e) => (
                  <Badge key={e} variant="outline" className="font-mono">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
