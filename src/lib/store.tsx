import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ActivityEvent, Analysis, ProjectSummary } from './types'
import { ActivityProvider } from './activity-context'
import { mergeActivityEvents } from './activity'
import { usePreferences } from './preferences'
import { pulseFile } from './pulse'
import { diffAnalysis, type Change } from './changes'

/**
 * One shared SSE connection for the whole app (browsers cap open connections per host, so a stream per
 * component starves). Reconnects by hand, because EventSource gives up for good on a non-200
 * (e.g. while the API restarts). Listeners subscribe and get every message plus connection state.
 */
type Listener = { onMsg: (m: any) => void; onState: (connected: boolean) => void }
const listeners = new Set<Listener>()
let shared: EventSource | null = null
let sharedOpen = false
let retry: number | undefined

function connectShared() {
  if (shared || !listeners.size) return
  const es = new EventSource('/api/stream')
  shared = es
  es.onopen = () => {
    sharedOpen = true
    listeners.forEach((l) => l.onState(true))
  }
  es.onmessage = (m) => {
    let msg: any
    try {
      msg = JSON.parse(m.data)
    } catch {
      return
    }
    listeners.forEach((l) => l.onMsg(msg))
  }
  es.onerror = () => {
    sharedOpen = false
    listeners.forEach((l) => l.onState(false))
    es.close()
    if (shared === es) shared = null
    clearTimeout(retry)
    retry = window.setTimeout(connectShared, 1500)
  }
}

export function openStream(onMsg: (m: any) => void, onState: (connected: boolean) => void) {
  const l: Listener = { onMsg, onState }
  listeners.add(l)
  if (shared && sharedOpen) queueMicrotask(() => listeners.has(l) && onState(true))
  connectShared()
  return () => {
    listeners.delete(l)
    if (!listeners.size) {
      clearTimeout(retry)
      shared?.close()
      shared = null
      sharedOpen = false
    }
  }
}

type Heat = Record<string, { ts: number; by: 'claude' | 'codex' | 'fs'; kind: string }>

type ProjectState = {
  analysis: Analysis | null
  version: number
  events: ActivityEvent[]
  heat: Heat
  hooks: boolean
  loading: boolean
  connected: boolean
  agentNow: ActivityEvent | null
  /** structural changes seen this session (tables, routes, files, modules…), oldest first */
  changes: Change[]
  pushChanges: (c: Change[]) => void
  refresh: () => void
  setHooks: (enable: boolean) => Promise<void>
}

const Ctx = createContext<ProjectState | null>(null)
export const useProject = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProject outside provider')
  return v
}

/** list of registered projects, kept fresh through the SSE stream */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/projects')
      setProjects(await r.json())
      setError(null)
    } catch {
      setError('Can\'t reach the Codeglass server. Check that it is still running in your terminal.')
    }
  }, [])
  useEffect(() => {
    load()
    return openStream(
      (msg) => {
        if (msg.type === 'projects' || msg.type === 'analysis') load()
      },
      (ok) => {
        setError(ok ? null : 'Lost connection to the Codeglass server. Retrying…')
        if (ok) load()
      },
    )
  }, [load])
  const add = async (path: string) => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Could not open that folder')
    await load()
    return j.id as string
  }
  const remove = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    await load()
  }
  return { projects, error, add, remove }
}

const CLAUDE_ACTIVE_MS = 9000

export function ProjectProvider({ id, children }: { id: string; children: ReactNode }) {
  const { settings } = usePreferences()
  const provider = settings?.provider ?? 'claude'
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [version, setVersion] = useState(0)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [heat, setHeat] = useState<Heat>({})
  const [hooks, setHooksState] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [tick, setTick] = useState(0)
  const fetchTimer = useRef<number | undefined>(undefined)
  const [changes, setChanges] = useState<Change[]>([])
  const analysisRef = useRef<Analysis | null>(null)
  const heatRef = useRef<Heat>({})
  heatRef.current = heat
  const pushChanges = useCallback((c: Change[]) => {
    if (c.length) setChanges((prev) => [...prev, ...c].slice(-400))
  }, [])

  const fetchAnalysis = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/analysis`)
      if (r.status === 202) {
        fetchTimer.current = window.setTimeout(fetchAnalysis, 600)
        return
      }
      if (!r.ok) {
        fetchTimer.current = window.setTimeout(fetchAnalysis, 1500)
        return
      }
      const j = await r.json()
      const prev = analysisRef.current
      if (prev && prev !== j.analysis) {
        // Scanner diffs have no agent provenance. Explicit hooks drive card activity.
        pushChanges(diffAnalysis(prev, j.analysis, () => 'you'))
      }
      analysisRef.current = j.analysis
      setAnalysis(j.analysis)
      setVersion(j.version)
      setHooksState(j.hooks)
      setEvents(prev => mergeActivityEvents(prev, j.history ?? []))
      setLoading(false)
      return j
    } catch {}
  }, [id, pushChanges])

  // initial load + history
  useEffect(() => {
    setAnalysis(null)
    setEvents([])
    setHeat({})
    setChanges([])
    analysisRef.current = null
    setLoading(true)
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/projects/${id}/analysis`).catch(() => null)
      if (cancelled) return
      if (!r) return void (fetchTimer.current = window.setTimeout(fetchAnalysis, 1500))
      if (r.status === 202) return void (fetchTimer.current = window.setTimeout(fetchAnalysis, 600))
      if (!r.ok) return void (fetchTimer.current = window.setTimeout(fetchAnalysis, 1500))
      const j = await r.json()
      if (cancelled) return
      analysisRef.current = j.analysis
      setAnalysis(j.analysis)
      setVersion(j.version)
      setHooksState(j.hooks)
      setEvents(j.history as ActivityEvent[])
      const h: Heat = {}
      for (const e of j.history as ActivityEvent[]) {
        if (e.path) h[e.path] = { ts: e.ts, by: e.source, kind: e.kind }
      }
      setHeat(h)
      setLoading(false)
    })()
    return () => {
      cancelled = true
      clearTimeout(fetchTimer.current)
    }
  }, [id, fetchAnalysis])

  useEffect(() => { void fetchAnalysis() }, [provider, fetchAnalysis])

  // live stream
  useEffect(() => {
    let t: number | undefined
    let first = true
    const close = openStream(
      (msg) => {
        if (msg.projectId !== id) return
        if (msg.type === 'analysis') {
          clearTimeout(t)
          t = window.setTimeout(fetchAnalysis, 150)
        } else if (msg.type === 'activity') {
          const ev = msg.ev as ActivityEvent
          setEvents((prev) => mergeActivityEvents(prev, [ev]))
          if (ev.path) {
            setHeat((h) => ({ ...h, [ev.path!]: { ts: ev.ts, by: ev.source, kind: ev.kind } }))
            pulseFile(ev.path, ev.source !== 'fs' ? '#fbbf24' : '#5eead4')
          }
        }
      },
      (ok) => {
        setConnected(ok)
        if (ok && !first) fetchAnalysis() // resync after a reconnect
        if (ok) first = false
      },
    )
    return () => {
      clearTimeout(t)
      close()
    }
  }, [id, fetchAnalysis])

  // safety net: if a live message was missed, notice the new scan version and reload
  const versionRef = useRef(0)
  versionRef.current = version
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        const r = await fetch(`/api/projects/${id}/status`)
        if (!r.ok) return
        const s = await r.json()
        if (s.version && s.version !== versionRef.current) fetchAnalysis()
      } catch {}
    }, 4000)
    return () => clearInterval(i)
  }, [id, fetchAnalysis])

  // lets "Claude is working on …" expire
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 1500)
    return () => clearInterval(i)
  }, [])

  const agentNow = useMemo(() => {
    void tick
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.source === 'fs') continue
      if (e.kind === 'stop') return null
      return Date.now() - e.ts < CLAUDE_ACTIVE_MS ? e : null
    }
    return null
  }, [events, tick])

  const setHooks = useCallback(
    async (enable: boolean) => {
      const r = await fetch(`/api/projects/${id}/hooks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enable, provider }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Could not update hooks')
      setHooksState(j.hooks)
    },
    [id, provider],
  )

  const value = useMemo<ProjectState>(
    () => ({ analysis, version, events, heat, hooks, loading, connected, agentNow, changes, pushChanges, refresh: () => void fetchAnalysis(), setHooks }),
    [analysis, version, events, heat, hooks, loading, connected, agentNow, changes, pushChanges, fetchAnalysis, setHooks],
  )
  return <Ctx.Provider value={value}><ActivityProvider events={events}>{children}</ActivityProvider></Ctx.Provider>
}
