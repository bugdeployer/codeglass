import { useEffect, useRef, useState } from 'react'
import { animate, stagger } from 'animejs'
import { BarChart3, Database, FolderOpen, Mountain, Network, Radar, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderBrowser } from '@/components/FolderBrowser'
import { ChangeToasts } from '@/components/ChangeToasts'
import { LiveSwitch } from '@/components/LiveSwitch'
import { ActivityHooks } from '@/components/ActivityHooks'
import { Settings } from '@/components/Settings'
import { useConfirm } from '@/components/ConfirmDialog'
import { usePreferences } from '@/lib/preferences'
import { providerName } from '@shared/settings'
import { ArchProvider, useArch } from '@/lib/arch'
import { fmt } from '@/lib/graph'
import { ProjectProvider, useProject, useProjects } from '@/lib/store'
import type { ProjectSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Overview } from '@/views/Overview'
import { Schema } from '@/views/Schema'
import { SystemMap } from '@/views/SystemMap'
import { Topography } from '@/views/Topography'

const VIEWS = [
  { id: 'map', label: 'System map', icon: Network, el: SystemMap, color: '#22e8ff', blurb: 'Capabilities, how they depend on each other, and the step-by-step flows inside them.' },
  { id: 'schema', label: 'Schema', icon: Database, el: Schema, color: '#b6ff3b', blurb: 'Your tables wired by their real joins, with a join-path finder.' },
  { id: 'topography', label: 'Topography', icon: Mountain, el: Topography, color: '#9d7bff', blurb: 'The folder as terrain, by size, language or recent edits.' },
  { id: 'stats', label: 'Stats', icon: BarChart3, el: Overview, color: '#5b8cff', blurb: 'Languages, layers, the largest files and the most-imported modules.' },
] as const

function readHash(): { id: string | null; view: string } {
  const [, id, view] = location.hash.split('/')
  return { id: id || null, view: VIEWS.some((v) => v.id === view) ? view : 'map' }
}

/** the Codeglass mark: a lens over a small graph */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="M15.6 15.6 21 21" />
      <circle cx="8" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8.9 9.6 10 12.1M9.2 8.8l2.6-.4M12.6 9.2l-1.4 2.8" strokeWidth="1.1" />
    </svg>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid size-8 place-items-center rounded-lg border border-[#22e8ff]/40 bg-[#22e8ff]/10 text-[#22e8ff] shadow-[0_0_24px_-4px_#22e8ff]">
        <Mark className="size-[18px]" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">
          code<span className="text-[#22e8ff]">glass</span>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">live code map</div>
      </div>
    </div>
  )
}

function ProjectItem({ p, active, onSelect, onRemove }: { p: ProjectSummary; active: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
      data-proj
      title={`${p.name} · ${p.path}`}
      aria-label={`Open ${p.name}`}
      className={cn('project-item group relative cursor-pointer rounded-lg border px-3 py-3 transition-all', active ? 'border-[#22e8ff]/40 bg-[#22e8ff]/[0.06] shadow-[0_0_24px_-10px_#22e8ff]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]')}
    >
      {active && <div className="absolute top-2 bottom-2 -left-px w-0.5 rounded-full bg-[#22e8ff] shadow-[0_0_10px_#22e8ff]" />}
      <div className="flex items-center gap-2" data-initial={p.name.charAt(0).toUpperCase()}>
        <span className={cn('size-1.5 shrink-0 rounded-full', p.hooks ? 'bg-[#ffb020] shadow-[0_0_8px_#ffb020]' : 'bg-[#22e8ff]/70')} title={p.hooks ? 'Hooks on' : 'Watching files'} />
        <span className="truncate text-sm font-medium">{p.name}</span>
        <button
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title={`Remove ${p.name} from Codeglass`}
          aria-label={`Remove ${p.name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={p.path}>
        {p.path}
      </div>
      <div className="mt-1 font-mono text-[10px] text-slate-500">{p.files == null ? 'Scanning…' : `${fmt(p.files)} files · ${fmt(p.loc ?? 0)} lines`}</div>
    </div>
  )
}

function LiveBadge() {
  const { agentNow, connected } = useProject()
  const { mapper } = useArch()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (agentNow && ref.current) animate(ref.current, { opacity: [0.4, 1], translateY: [-4, 0], duration: 350, ease: 'outExpo' })
  }, [agentNow?.id])
  if (!connected) return <div className="workspace-badge rounded-lg border border-red-400/40 px-3 font-mono text-[11px] text-red-300">Server offline</div>
  if (agentNow)
    return (
      <div ref={ref} className="workspace-badge flex max-w-md items-center gap-2 rounded-lg border border-[#ffb020]/50 bg-[#ffb020]/10 px-3 text-xs text-[#ffd27a] shadow-[0_0_24px_-6px_#ffb020]">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ffb020] opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-[#ffb020]" />
        </span>
        <span className="shrink-0 font-semibold">{agentNow.source === 'codex' ? 'Codex' : 'Claude'} · {agentNow.action ?? agentNow.kind}</span>
        <span className="truncate font-mono text-[11px] text-[#ffe2a8]/80">{agentNow.path ?? agentNow.detail ?? ''}</span>
      </div>
    )
  return (
    <div className="workspace-badge flex items-center gap-2 rounded-lg border border-white/10 px-3 font-mono text-[11px] text-muted-foreground">
      <Radar className="size-3.5 text-[#22e8ff]" /> Watching{mapper?.pending ? ` · ${mapper.pending} ${mapper.pending === 1 ? 'change' : 'changes'} since last map` : ''}
    </div>
  )
}

function Workspace({ view, setView, project }: { view: string; setView: (v: string) => void; project: ProjectSummary }) {
  const { loading } = useProject()
  const V = VIEWS.find((v) => v.id === view)!.el
  return (
    <>
      <header className="workspace-header flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur">
        <nav className="flex items-center gap-0.5 rounded-xl border border-white/5 bg-white/[0.02] p-1">
          {VIEWS.map((v) => {
            const on = v.id === view
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-all', on ? 'bg-white/[0.06] text-white' : 'text-muted-foreground hover:text-foreground')}
                style={on ? { boxShadow: `inset 0 -2px 0 ${v.color}, 0 8px 24px -14px ${v.color}` } : undefined}
              >
                <v.icon className="size-3.5" style={on ? { color: v.color, filter: `drop-shadow(0 0 6px ${v.color})` } : undefined} />
                {v.label}
              </button>
            )
          })}
        </nav>
        <div className="workspace-status flex items-center gap-3">
          <ActivityHooks />
          <LiveSwitch />
          <LiveBadge />
        </div>
      </header>
      <main className="grid-bg min-h-0 flex-1">
        {loading ? (
          <div className="space-y-4 p-6">
            <div className="font-mono text-sm text-muted-foreground">Scanning {project.path}…</div>
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <V />
        )}
      </main>
      <ChangeToasts onOpen={setView} />
    </>
  )
}

function Landing({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current && !document.hidden) animate(ref.current.querySelectorAll('[data-in]'), { opacity: [0, 1], translateY: [16, 0], delay: stagger(90), duration: 800, ease: 'outExpo' })
  }, [])
  return (
    <div ref={ref} className="grid-bg relative grid flex-1 place-items-center overflow-hidden p-8">
      <div className="pointer-events-none absolute top-1/3 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22e8ff]/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-2/3 left-[60%] size-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff2bd6]/10 blur-[110px]" />
      <div className="relative w-full max-w-2xl text-center">
        <div data-in className="mx-auto mb-5 w-fit rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Runs on your machine · Updates live
        </div>
        <h1 data-in className="text-5xl font-semibold tracking-tight">
          See through <span className="bg-gradient-to-r from-[#22e8ff] via-[#9d7bff] to-[#ff2bd6] bg-clip-text text-transparent">your codebase</span>
        </h1>
        <p data-in className="mx-auto mt-4 max-w-lg text-[15px] text-muted-foreground">
          Open a project to map its capabilities, flows and database. Codeglass keeps the map current while you or your coding agent work.
        </p>
        <div data-in className="mt-8">
          <Button size="lg" onClick={onOpen} className="h-12 rounded-xl bg-[#22e8ff] px-6 text-base text-black shadow-[0_0_40px_-6px_#22e8ff] hover:bg-[#6ff0ff]">
            <FolderOpen className="size-5" /> Open project folder
          </Button>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-3 text-left md:grid-cols-4">
          {VIEWS.map((t) => (
            <div key={t.id} data-in className="glass rounded-xl p-3">
              <t.icon className="mb-2 size-4" style={{ color: t.color, filter: `drop-shadow(0 0 6px ${t.color})` }} />
              <div className="text-[13px] font-medium">{t.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.blurb}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { projects, error, add, remove } = useProjects()
  const [{ id, view }, setNav] = useState(readHash)
  const [browse, setBrowse] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { settings } = usePreferences()
  const confirm = useConfirm()
  useEffect(() => {
    const on = () => setNav(readHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const go = (nid: string | null, v = view) => {
    location.hash = nid ? `/${nid}/${v}` : ''
  }
  const current = projects.find((p) => p.id === id) ?? projects[0] ?? null

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground">
      <aside className="project-sidebar flex shrink-0 flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl" style={{ width: settings?.sidebarWidth ?? 256 }}>
        <div className="px-4 py-4">
          <Logo />
        </div>
        <div className="px-3 pb-3">
          <Button onClick={() => setBrowse(true)} className="w-full justify-start border border-[#22e8ff]/30 bg-[#22e8ff]/10 text-[#bff7ff] hover:bg-[#22e8ff]/20">
            <FolderOpen /> Open project folder
          </Button>
        </div>
        <div className="px-4 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Projects</div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {projects.map((p) => (
            <ProjectItem key={p.id} p={p} active={current?.id === p.id} onSelect={() => go(p.id)} onRemove={() =>
                confirm.ask(
                  {
                    title: `Remove ${p.name}?`,
                    description: (
                      <>
                        Codeglass stops watching <span className="font-mono break-all text-foreground">{p.path}</span> and removes the hooks it installed there. Your files and the saved map stay, so you can add the folder again later.
                      </>
                    ),
                    confirmLabel: 'Remove project',
                    destructive: true,
                  },
                  async () => {
                    await remove(p.id)
                    if (current?.id === p.id) go(null)
                  },
                )
              }
            />
          ))}
          {projects.length === 0 && <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">No projects yet. Open a folder to start.</p>}
        </div>
        <div className="border-t border-white/10 p-3">
          <button className="settings-launch flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" /><span>Settings</span><span className="ml-auto text-[11px] text-muted-foreground">{providerName(settings?.provider ?? 'claude')}</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && <div className="border-b border-red-400/30 bg-red-500/10 px-4 py-1.5 font-mono text-xs text-red-200">{error}</div>}
        {current ? (
          <ProjectProvider key={current.id} id={current.id}>
            <ArchProvider id={current.id}>
              <Workspace view={view} setView={(v) => go(current.id, v)} project={current} />
            </ArchProvider>
          </ProjectProvider>
        ) : (
          <Landing onOpen={() => setBrowse(true)} />
        )}
      </div>

      {confirm.dialog}
      {settingsOpen && <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />}
      <FolderBrowser
        open={browse}
        onOpenChange={setBrowse}
        onSelect={async (p) => {
          const nid = await add(p)
          go(nid, 'map')
        }}
      />
    </div>
  )
}
