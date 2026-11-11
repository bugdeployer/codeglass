import { Loader2, Radio } from 'lucide-react'
import { useArch } from '@/lib/arch'
import { usePreferences } from '@/lib/preferences'
import { providerName } from '@shared/settings'
import { cn } from '@/lib/utils'

/**
 * LIVE: keep the map in step with the code while you or a coding agent work.
 * The server only calls the mapping provider when the *structure* changed (new or removed files, routes, tables
 * or packages), after a pause in edits or when the agent ends a turn.
 */
export function LiveSwitch() {
  const { settings } = usePreferences()
  const name = providerName(settings?.provider ?? 'claude')
  const { mapper, arch, setLive, cli } = useArch()
  if (!mapper) return null
  const on = mapper.live
  const busy = mapper.status === 'running'
  const title = on
    ? `LIVE is on: ${name} updates the map after each pause in structural edits. Click to turn off.`
    : arch?.source !== 'heuristic'
      ? `Turn on LIVE: ${name} updates the map as the code changes`
      : `Turn on LIVE: map the project with ${name} now and keep it current`
  return (
    <div className="flex items-center gap-2">
      <button
        role="switch"
        aria-checked={on}
        disabled={!cli}
        title={title}
        onClick={() => setLive(!on)}
        className={cn(
          'group flex items-center gap-2 workspace-badge rounded-lg border px-2.5 font-mono text-[11px] font-semibold tracking-[0.18em] transition-all disabled:opacity-40',
          on ? 'border-[#ff2bd6]/60 bg-[#ff2bd6]/10 text-[#ff9bea] shadow-[0_0_24px_-6px_#ff2bd6]' : 'border-white/10 text-muted-foreground hover:border-white/25 hover:text-foreground',
        )}
      >
        <span className={cn('relative h-4 w-7 rounded-full transition-colors', on ? 'bg-[#ff2bd6]/40' : 'bg-white/10')}>
          <span className={cn('absolute top-0.5 size-3 rounded-full transition-all', on ? 'left-3.5 bg-[#ff2bd6] shadow-[0_0_10px_#ff2bd6]' : 'left-0.5 bg-slate-400')} />
        </span>
        {on && busy ? <Loader2 className="size-3 animate-spin" /> : <Radio className={cn('size-3', on && 'animate-pulse')} />}
        LIVE
      </button>

    </div>
  )
}
