import { useState, type ReactNode } from 'react'
import { Check, Loader2, Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePreferences } from '@/lib/preferences'
import { providerName, type Provider, type VisualizerSettings } from '@shared/settings'

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="settings-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Settings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, defaults, providers, error: loadError, reload, save } = usePreferences()
  const [draft, setDraft] = useState<VisualizerSettings | null>(() => settings ? structuredClone(settings) : null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (draft === null && settings !== null) setDraft(structuredClone(settings))
  const update = <K extends keyof VisualizerSettings>(key: K, value: VisualizerSettings[K]) => setDraft((prev) => prev && ({ ...prev, [key]: value }))
  const p = draft?.provider ?? 'claude'
  const model = (key: 'fullModel' | 'updateModel' | 'cliPath', value: string) => { if (draft) update(p, { ...draft[p], [key]: value }) }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg"><Settings2 className="size-4 text-cyan-300" /> Settings</DialogTitle>
          <DialogDescription className="mt-2">Who maps your projects, how long a run may take, and how Codeglass looks. Saved on this computer.</DialogDescription>
        </div>
        {draft ? <form className="contents" onSubmit={async (event) => {
          event.preventDefault(); setSaving(true); setError(null)
          try { await save(draft); onOpenChange(false) } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
        }}>
          <div className="settings-body space-y-6 overflow-y-auto px-6 py-5">
            <section className="space-y-3" aria-labelledby="provider-heading">
              <h2 id="provider-heading" className="text-sm font-semibold">Mapping provider</h2>
              <div className="grid grid-cols-2 gap-3">
                {(['claude', 'codex'] as Provider[]).map((provider) => <button type="button" key={provider} aria-pressed={p === provider} onClick={() => update('provider', provider)} className={`provider-option ${p === provider ? 'selected' : ''}`}>
                  <span className="flex items-center justify-between font-medium">{providerName(provider)}{p === provider && <Check className="size-4" />}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{providers[provider] ? 'CLI detected' : 'CLI not found'}</span>
                </button>)}
              </div>
              <p className="break-all text-xs text-muted-foreground">{providers[p]?.version ?? `${providerName(p)} CLI not found. Install it and sign in, or set its path below.`}</p>
              {<Field label="Mapping depth" hint="Quick maps capabilities and one representative flow each. Detailed includes more flows and branches and takes longer.">
                <select value={draft[p].detail} onChange={(e) => update(p, { ...draft[p], detail: e.target.value as 'quick' | 'detailed' })} className="h-[38px] rounded-lg border border-white/15 bg-[#080b12] px-3 text-sm">
                  <option value="quick">Quick overview</option><option value="detailed">Detailed flows</option>
                </select>
              </Field>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full map model" hint={p === 'codex' ? 'Leave blank to use your Codex default.' : undefined}><input value={draft[p].fullModel} onChange={(e) => model('fullModel', e.target.value)} placeholder={p === 'codex' ? 'Codex default' : 'sonnet'} /></Field>
                <Field label="Update model" hint={p === 'codex' ? 'Leave blank to use your Codex default.' : undefined}><input value={draft[p].updateModel} onChange={(e) => model('updateModel', e.target.value)} placeholder={p === 'codex' ? 'Codex default' : 'sonnet'} /></Field>
              </div>
              <Field label={`${providerName(p)} executable path`} hint="Optional. Leave blank for automatic detection. Use the executable, not a shell script."><input value={draft[p].cliPath} onChange={(e) => model('cliPath', e.target.value)} placeholder={p === 'codex' ? 'Auto-detect codex' : 'Auto-detect claude'} /></Field>
              {p === 'claude' ? <div className="grid grid-cols-2 gap-3">
                <Field label="Full map budget (USD)"><input type="number" min="0.01" max="100" step="0.01" required value={draft.claude.fullBudget} onChange={(e) => update('claude', { ...draft.claude, fullBudget: e.target.valueAsNumber })} /></Field>
                <Field label="Update budget (USD)"><input type="number" min="0.01" max="100" step="0.01" required value={draft.claude.updateBudget} onChange={(e) => update('claude', { ...draft.claude, updateBudget: e.target.valueAsNumber })} /></Field>
              </div> : <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs leading-relaxed text-muted-foreground">Codex uses your CLI sign-in and runs in a read-only sandbox. Codeglass records its token usage; Codex does not report a dollar cost, so budget caps are not available. The time and tool limits below still apply.</p>}
            </section>
            <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="limits-heading">
              <h2 id="limits-heading" className="text-sm font-semibold">Mapping & live updates</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Full map timeout (seconds)"><input type="number" min="15" max="3600" required value={draft.fullTimeout} onChange={(e) => update('fullTimeout', e.target.valueAsNumber)} /></Field>
                <Field label="Update timeout (seconds)"><input type="number" min="15" max="3600" required value={draft.updateTimeout} onChange={(e) => update('updateTimeout', e.target.valueAsNumber)} /></Field>
                <Field label="Tool calls per run"><input type="number" min="1" max="500" step="1" required value={draft.maxToolCalls} onChange={(e) => update('maxToolCalls', e.target.valueAsNumber)} /></Field>
                <Field label="Wait after edits (seconds)"><input type="number" min="3" max="300" required value={draft.liveDelay} onChange={(e) => update('liveDelay', e.target.valueAsNumber)} /></Field>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Turn LIVE on per project from the header. Edits from Claude, Codex or your editor all count. With hooks on, the map also updates as soon as the agent finishes a turn.</p>
            </section>
            <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="appearance-heading">
              <h2 id="appearance-heading" className="text-sm font-semibold">Appearance</h2>
              <label className="flex items-center justify-between gap-3 text-sm">Show connection legends<input type="checkbox" checked={draft.showLegends} onChange={(e) => update('showLegends', e.target.checked)} /></label>
              <label className="flex items-center justify-between gap-3 text-sm">Reduce animations<input type="checkbox" checked={draft.reduceMotion} onChange={(e) => update('reduceMotion', e.target.checked)} /></label>
              <Field label={`Sidebar width · ${draft.sidebarWidth}px`}><input type="range" min="200" max="360" step="8" value={draft.sidebarWidth} onChange={(e) => update('sidebarWidth', e.target.valueAsNumber)} /></Field>
            </section>
          </div>
          <div className="border-t border-white/10 px-6 py-4">
            {error && <p role="alert" className="mb-3 text-xs text-red-300">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" disabled={saving} className="text-xs text-muted-foreground hover:text-white" onClick={() => defaults && setDraft(structuredClone(defaults))}>Reset to defaults</button>
              <div className="flex gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}Save settings</Button></div>
            </div>
          </div>
        </form> : <div className="p-6"><p role="status" className="text-sm text-muted-foreground">{loadError ?? 'Loading settings…'}</p>{loadError && <Button className="mt-3" onClick={reload}>Retry</Button>}</div>}
      </DialogContent>
    </Dialog>
  )
}
