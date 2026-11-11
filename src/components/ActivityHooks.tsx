import { Activity, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '@/components/ConfirmDialog'
import { useProject } from '@/lib/store'
import { usePreferences } from '@/lib/preferences'
import { providerName } from '@shared/settings'

/** installs or removes the passive hooks that let cards show what the coding agent is doing right now */
export function ActivityHooks() {
  const { hooks, setHooks, analysis } = useProject()
  const { settings } = usePreferences()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const provider = settings?.provider ?? 'claude'
  const name = providerName(provider)
  const codex = provider === 'codex'
  const file = codex ? '.codex/hooks.json' : '.claude/settings.local.json'

  const run = async (enable: boolean) => {
    setBusy(true)
    try {
      await setHooks(enable)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        disabled={busy}
        className={`workspace-badge w-[104px] justify-center gap-1.5 rounded-lg border px-2 text-[11px] ${hooks ? 'border-amber-300/40 text-amber-200' : 'border-white/15 text-slate-400'}`}
        title={hooks ? `${name} hooks are on. Cards show what ${name} is doing as it works.` : `Turn on ${name} hooks so cards show what ${name} is doing as it works.`}
        onClick={() =>
          hooks
            ? confirm.ask(
                {
                  title: `Turn off ${name} hooks?`,
                  description: (
                    <>
                      Codeglass removes its entries from <span className="font-mono text-foreground">{file}</span>{analysis ? ` in ${analysis.name}` : ''}. Any other hooks in that file stay. Cards stop showing live activity; the map itself keeps updating.
                    </>
                  ),
                  confirmLabel: 'Turn off hooks',
                },
                () => run(false),
              )
            : confirm.ask(
                {
                  title: `Turn on ${name} hooks?`,
                  description: (
                    <>
                      Codeglass adds passive hooks to <span className="font-mono text-foreground">{file}</span>{analysis ? ` in ${analysis.name}` : ''}. They only report which files {name} reads and edits, so cards can show <i>Building</i> or <i>Editing</i>. They never block or change what {name} does. Your existing hooks stay.
                      {codex && <span className="mt-2 block">Codex asks you to review and trust project hooks: run <span className="font-mono text-foreground">/hooks</span> in Codex, then restart the session.</span>}
                    </>
                  ),
                  confirmLabel: 'Turn on hooks',
                },
                () => run(true),
              )
        }
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Activity className="size-3" />}
        {`Hooks · ${hooks ? 'on' : 'off'}`}
      </button>
      {confirm.dialog}
    </>
  )
}
