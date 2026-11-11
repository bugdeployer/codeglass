import { useEffect, useState } from 'react'
import { Boxes, Database, FileMinus, FilePlus, GitBranch, Link2, Package, Route, Sparkles, Table2, Workflow, X } from 'lucide-react'
import { CHANGE_VIEW, type Change, type ChangeKind } from '@/lib/changes'
import { useProject } from '@/lib/store'
import { cn } from '@/lib/utils'

export const CHANGE_META: Record<ChangeKind, { icon: typeof Table2; verb: string; color: string }> = {
  'table-added': { icon: Table2, verb: 'added table', color: '#b6ff3b' },
  'table-removed': { icon: Table2, verb: 'removed table', color: '#ff3864' },
  'column-added': { icon: Database, verb: 'added column', color: '#b6ff3b' },
  'column-removed': { icon: Database, verb: 'removed column', color: '#ff3864' },
  'join-added': { icon: Link2, verb: 'linked', color: '#b6ff3b' },
  'route-added': { icon: Route, verb: 'added route', color: '#22e8ff' },
  'route-removed': { icon: Route, verb: 'removed route', color: '#ff3864' },
  'file-added': { icon: FilePlus, verb: 'created', color: '#22e8ff' },
  'file-removed': { icon: FileMinus, verb: 'deleted', color: '#ff3864' },
  'package-added': { icon: Package, verb: 'started using', color: '#ff2bd6' },
  'system-added': { icon: Boxes, verb: 'new system', color: '#9d7bff' },
  'module-added': { icon: GitBranch, verb: 'new module', color: '#9d7bff' },
  'flow-added': { icon: Workflow, verb: 'new flow', color: '#ff2bd6' },
  'flow-updated': { icon: Workflow, verb: 'flow grew', color: '#ff2bd6' },
  'connection-added': { icon: Link2, verb: 'new connection', color: '#ffb020' },
}

const SHOW_MS = 9000

export function ChangeToasts({ onOpen }: { onOpen: (view: string) => void }) {
  const { changes } = useProject()
  const [now, setNow] = useState(Date.now())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  // files are noisy: only toast them when nothing more meaningful happened in the same scan
  const recent = changes.filter((c) => now - c.ts < SHOW_MS && !dismissed.has(c.id))
  const meaningful = recent.filter((c) => c.kind !== 'file-added' && c.kind !== 'file-removed')
  const list = (meaningful.length ? meaningful : recent).slice(-4).reverse()
  const extra = (meaningful.length ? meaningful : recent).length - list.length
  if (!list.length) return null
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[340px] flex-col gap-2">
      {list.map((c: Change) => {
        const m = CHANGE_META[c.kind]
        const Icon = m.icon
        return (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(CHANGE_VIEW[c.kind])}
            className="toast-in pointer-events-auto flex cursor-pointer items-start gap-3 rounded-xl border bg-[#09090f]/95 p-3 backdrop-blur-xl"
            style={{ borderColor: `${m.color}55`, boxShadow: `0 0 30px -10px ${m.color}` }}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ color: m.color, background: `${m.color}14`, boxShadow: `0 0 16px -4px ${m.color}` }}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {c.by !== 'you' ? (
                  <span className="flex items-center gap-1 font-semibold text-[#ffb020]">
                    <Sparkles className="size-3" /> {c.by === 'codex' ? 'Codex' : 'Claude'}
                  </span>
                ) : (
                  <span>You</span>
                )}
                {m.verb}
              </div>
              <div className="truncate font-mono text-[13px] font-semibold" style={{ color: m.color }}>
                {c.label}
              </div>
              {c.detail && <div className="truncate text-[11px] text-muted-foreground">{c.detail}</div>}
            </div>
            <button
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setDismissed((d) => new Set(d).add(c.id))
              }}
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
      {extra > 0 && <div className={cn('toast-in self-end rounded-full border border-white/10 bg-black/70 px-3 py-1 font-mono text-[11px] text-muted-foreground')}>+{extra} more changes</div>}
    </div>
  )
}
