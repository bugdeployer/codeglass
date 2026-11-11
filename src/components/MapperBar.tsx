import { useEffect, useState } from 'react'
import { useConfirm } from '@/components/ConfirmDialog'
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Square, Wand2 } from 'lucide-react'
import { useArch } from '@/lib/arch'
import { ago, fmt } from '@/lib/graph'
import { usePreferences } from '@/lib/preferences'
import { providerName } from '@shared/settings'

export function MapperBar() {
  const { settings } = usePreferences()
  const { arch, mapper, cli, runMap, cancelMap } = useArch()
  const confirm = useConfirm()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mapper?.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [mapper?.status])
  if (!arch || !mapper) return null
  const running = mapper.status === 'running'
  const mapped = arch.source !== 'heuristic'
  const name = providerName(running ? mapper.provider ?? settings?.provider ?? 'claude' : settings?.provider ?? 'claude')
  const changed = mapped && arch.source !== settings?.provider
  const elapsed = mapper.startedAt ? Math.max(0, Math.round((now - mapper.startedAt) / 1000)) : 0
  const error = mapper.status === 'error'
  const description = running ? mapper.progress.at(-1) : error ? mapper.lastError : mapped
    ? `Saved map: ${arch.source === 'codex' ? 'Codex' : 'Claude'}, ${ago(arch.generatedAt)}. Next run: ${name}.`
    : `Quick map from the file scan. Map with ${name} to describe the real capabilities and their flows.`
  return <div className="mapper-bar flex shrink-0 items-center gap-1.5 text-xs">
    <span className={`mapper-status inline-flex w-[148px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 ${error ? 'border-red-300/30 text-red-300' : running ? 'border-cyan-300/40 text-cyan-200' : 'border-white/15 text-slate-300'}`} title={description}>
      {running ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : error ? <AlertTriangle className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />}
      <span className="truncate text-[11px]">{name} · {running ? mapper.mode === 'full' ? 'mapping' : 'updating' : error ? 'failed' : !cli ? 'unavailable' : !mapped ? 'quick map' : changed ? 'selected' : ago(arch.generatedAt)}</span>
      {running && <span aria-hidden="true" className="ml-auto w-[5ch] shrink-0 text-right font-mono text-[10px] tabular-nums">{elapsed}s</span>}
    </span>
    <div className="mapper-actions flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg border border-white/15 bg-white/[0.03]">
      <button disabled={running || !cli || !mapped || !mapper.pending} onClick={() => runMap('update')} title={mapper.pending ? `Fold ${mapper.pending} recent ${mapper.pending === 1 ? 'change' : 'changes'} into the saved map` : 'Nothing has changed since the last map'} className="flex w-[80px] items-center justify-center gap-1.5 text-[12px] text-slate-200 hover:bg-white/5 disabled:text-slate-500"><RefreshCw className="size-3.5" />Update{mapper.pending > 0 && <span className="font-mono text-[9px]">{mapper.pending}</span>}</button>
      <span className="w-px bg-white/15" />
      <button disabled={!running && !cli} onClick={() => {
        if (running) return void cancelMap()
        if (!mapped) return void runMap('full')
        confirm.ask(
          {
            title: 'Re-map the whole project?',
            description: `${name} reads the project again and replaces the saved map. Cards you dragged keep their positions. ${settings?.provider === 'claude' ? `This run can cost up to $${settings.claude.fullBudget.toFixed(2)}.` : 'This uses Codex tokens.'} To fold in recent changes only, use Update instead.`,
            confirmLabel: `Re-map with ${name}`,
          },
          () => runMap('full'),
        )
      }} title={running ? 'Stop this run. The saved map stays as it was.' : mapped ? `Map the whole project again with ${name}` : `Map the project with ${name}`} className="flex w-[80px] items-center justify-center gap-1.5 text-[12px] text-slate-200 hover:bg-white/5 disabled:text-slate-500">{running ? <Square className="size-3.5" /> : <Wand2 className="size-3.5" />}{running ? 'Cancel' : mapped ? 'Re-map' : 'Map'}</button>
    </div>
    <span className="w-[108px] shrink-0 whitespace-nowrap text-right font-mono text-[10px] text-slate-400" title={`${mapper.totals.runs} ${mapper.totals.runs === 1 ? 'run' : 'runs'} for this project. Codex does not report a dollar cost.`}>
      {mapper.totals.runs ? `${fmt(mapper.totals.tokens)} tokens${mapper.totals.unpricedRuns ? '' : ' · $' + mapper.totals.costUsd.toFixed(2)}` : 'Not mapped yet'}
    </span>
    {confirm.dialog}
  </div>
}
