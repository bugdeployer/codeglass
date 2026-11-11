import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Architecture, MapperState } from './types'
import { openStream, useProject } from './store'
import { diffArch } from './changes'
import { usePreferences } from './preferences'
import { withProvisional } from './provisional'

type ArchState = {
  arch: Architecture | null
  fileOwner: Record<string, string>
  building: string[] // ids of BUILDING (not yet described) capabilities
  mapper: MapperState | null
  cli: { path: string; version: string } | null
  runMap: (mode: 'full' | 'update') => Promise<void>
  cancelMap: () => Promise<void>
  setAutoUpdate: (v: boolean) => Promise<void>
  setLive: (v: boolean) => Promise<void>
  /** start of the current Claude session (first Claude event we've seen), for NEW / CHANGED badges */
  sessionStart: number | null
}

const Ctx = createContext<ArchState | null>(null)
export const useArch = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useArch outside provider')
  return v
}

export function ArchProvider({ id, children }: { id: string; children: ReactNode }) {
  const { settings } = usePreferences()
  const { version, events, pushChanges, analysis } = useProject()
  const prevArch = useRef<Architecture | null>(null)
  const [arch, setArch] = useState<Architecture | null>(null)
  const [fileOwner, setFileOwner] = useState<Record<string, string>>({})
  const [mapper, setMapper] = useState<MapperState | null>(null)
  const [cli, setCli] = useState<ArchState['cli']>(null)
  const archVersion = useRef(-1)
  const mapperStatus = useRef<string>('idle')
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/architecture`)
      if (r.status === 202 || !r.ok) {
        timer.current = window.setTimeout(load, 1000)
        return
      }
      const j = await r.json()
      if (prevArch.current) pushChanges(diffArch(prevArch.current, j.architecture))
      prevArch.current = j.architecture
      setArch(j.architecture)
      setFileOwner(j.fileOwner)
      setMapper(j.mapper)
      mapperStatus.current = j.mapper?.status ?? 'idle'
      setCli(j.cli)
      archVersion.current = j.archVersion
    } catch {
      timer.current = window.setTimeout(load, 1500)
    }
  }, [id, pushChanges])

  // safety net: if a live message was missed, notice the new map version and reload
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        const r = await fetch(`/api/projects/${id}/status`)
        if (!r.ok) return
        const s = await r.json()
        if (s.archVersion !== archVersion.current || (s.mapper !== 'running') !== (mapperStatus.current !== 'running')) load()
      } catch {}
    }, 4000)
    return () => clearInterval(i)
  }, [id, load])

  // reload when the scan changes (ownership depends on it)
  useEffect(() => {
    load()
    return () => clearTimeout(timer.current)
  }, [load, version, settings?.provider, settings?.claude.cliPath, settings?.codex.cliPath])

  useEffect(
    () =>
      openStream(
        (msg) => {
          if (msg.projectId !== id || msg.type !== 'mapper') return
          setMapper(msg.state)
          if (msg.archVersion !== archVersion.current && msg.state.status !== 'running') load()
        },
        (ok) => {
          if (ok) load() // re-read state after a reconnect so a finished run never looks stuck
        },
      ),
    [id, load],
  )

  useEffect(() => {
    if (mapper?.status !== 'running') return
    const i = setInterval(load, 5000) // belt and braces: don't trust a single "finished" message
    return () => clearInterval(i)
  }, [mapper?.status, load])

  const post = useCallback(
    async (body: object) => {
      const r = await fetch(`/api/projects/${id}/map`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (j.state) setMapper(j.state)
    },
    [id],
  )

  const sessionStart = useMemo(() => {
    const first = events.find((e) => e.source === 'claude') ?? events[0]
    if (!first) return null
    // the full map itself is never "new": only count what appeared after Claude first mapped the project
    const mappedAt = arch && arch.source !== 'heuristic' ? Math.min(...arch.systems.map((s) => s.createdAt ?? Infinity)) : 0
    return Math.max(first.ts, Number.isFinite(mappedAt) ? mappedAt : 0)
  }, [events, arch])

  // real time: code that no capability owns yet shows up immediately as a BUILDING capability
  const live = useMemo(() => (arch && analysis ? withProvisional(arch, fileOwner, analysis) : { arch, owner: fileOwner, building: [] as string[] }), [arch, fileOwner, analysis])

  const value = useMemo<ArchState>(
    () => ({
      arch: live.arch,
      fileOwner: live.owner,
      building: live.building,
      mapper,
      cli,
      sessionStart,
      runMap: (mode) => post({ mode }),
      cancelMap: () => post({ cancel: true }),
      setAutoUpdate: (v) => post({ autoUpdate: v }),
      setLive: (v) => post({ live: v }),
    }),
    [live, mapper, cli, sessionStart, post],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
