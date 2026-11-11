import { useMemo } from 'react'
import type { Analysis, FileInfo } from './types'
import { useProject } from './store'

export type Index = ReturnType<typeof buildIndex>

export function buildIndex(a: Analysis) {
  const byPath = new Map<string, FileInfo>(a.files.map((f) => [f.path, f]))
  const importedBy = new Map<string, string[]>()
  for (const e of a.edges) {
    const l = importedBy.get(e.to) ?? []
    l.push(e.from)
    importedBy.set(e.to, l)
  }
  const routesByFile = new Map<string, typeof a.routes>()
  for (const r of a.routes) routesByFile.set(r.file, [...(routesByFile.get(r.file) ?? []), r])
  const tablesByFile = new Map<string, string[]>()
  const filesByTable = new Map<string, string[]>()
  for (const d of a.dbAccess) {
    tablesByFile.set(d.file, [...(tablesByFile.get(d.file) ?? []), d.table])
    filesByTable.set(d.table, [...(filesByTable.get(d.table) ?? []), d.file])
  }
  const callsByFile = new Map<string, typeof a.calls>()
  for (const c of a.calls) callsByFile.set(c.from, [...(callsByFile.get(c.from) ?? []), c])
  return { byPath, importedBy, routesByFile, tablesByFile, filesByTable, callsByFile }
}

export function useIndex(): Index | null {
  const { analysis } = useProject()
  return useMemo(() => (analysis ? buildIndex(analysis) : null), [analysis])
}

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString())
export const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`)
export function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
