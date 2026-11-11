import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUp, ChevronRight, Folder, FolderGit2, FolderOpen, HardDrive, Home, Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Entry = { name: string; path: string; markers: string[]; hidden: boolean }
type Listing = { path: string | null; parent: string | null; markers: string[]; entries: Entry[]; quick: { label: string; path: string }[]; error?: string }

const LAST_KEY = 'ccviz:lastBrowseDir'
const MARKER_LABEL: Record<string, string> = { node: 'Node', git: 'git', python: 'Python', go: 'Go', rust: 'Rust', php: 'PHP', ruby: 'Ruby', java: 'Java', deno: 'Deno', claude: 'CLAUDE.md' }

function splitPath(p: string): { label: string; path: string }[] {
  const win = /^[a-zA-Z]:\\/.test(p)
  const sep = win ? '\\' : '/'
  const parts = p.split(/[\\/]+/).filter(Boolean)
  const out: { label: string; path: string }[] = []
  let acc = win ? '' : '/'
  parts.forEach((part, i) => {
    acc = win ? (i === 0 ? part + '\\' : acc.replace(/\\$/, '') + '\\' + part) : (acc === '/' ? '/' + part : acc + sep + part)
    out.push({ label: part, path: acc })
  })
  return out
}

export function FolderBrowser({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (o: boolean) => void; onSelect: (path: string) => Promise<void> }) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [address, setAddress] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = useCallback(async (p?: string) => {
    setLoading(true)
    setFilter('')
    try {
      const r = await fetch('/api/fs/list' + (p ? `?path=${encodeURIComponent(p)}` : ''))
      const j: Listing = await r.json()
      setListing(j)
      setAddress(j.path ?? '')
      if (j.path && !j.error) {
        try {
          localStorage.setItem(LAST_KEY, j.path)
        } catch {}
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setError(null)
    let last: string | undefined
    try {
      last = localStorage.getItem(LAST_KEY) ?? undefined
    } catch {}
    go(last)
  }, [open, go])

  const entries = useMemo(() => {
    const f = filter.toLowerCase()
    return (listing?.entries ?? []).filter((e) => (showHidden || !e.hidden) && (!f || e.name.toLowerCase().includes(f)))
  }, [listing, filter, showHidden])

  const select = async (p: string) => {
    setBusy(true)
    setError(null)
    try {
      await onSelect(p)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  const nativePick = async () => {
    setError(null)
    try {
      const r = await fetch('/api/pick-folder', { method: 'POST' })
      const { path } = (await r.json()) as { path: string | null }
      if (path) await select(path)
    } catch {
      setError('The system folder dialog is not available here. Browse above instead.')
    }
  }

  const crumbs = listing?.path ? splitPath(listing.path) : []
  const isProject = (listing?.markers.length ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,85vh)] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Open a project folder</DialogTitle>
          <DialogDescription>Go to the folder at the root of your project. Folders that look like projects are marked.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* quick access */}
          <nav className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r p-2">
            {listing?.quick.map((q) => (
              <button
                key={q.path}
                onClick={() => go(q.path)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', listing.path === q.path && 'bg-muted')}
              >
                {/^[A-Z]:$/.test(q.label) || q.label === '/' ? <HardDrive className="size-4 text-muted-foreground" /> : q.label === 'Home' ? <Home className="size-4 text-muted-foreground" /> : <Folder className="size-4 text-muted-foreground" />}
                <span className="truncate">{q.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* address + breadcrumb */}
            <div className="space-y-2 border-b p-3">
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (address.trim()) go(address.trim().replace(/^["']|["']$/g, ''))
                }}
              >
                <Button type="button" size="icon" variant="outline" disabled={!listing?.parent} onClick={() => listing?.parent && go(listing.parent)} aria-label="Up one folder">
                  <ArrowUp />
                </Button>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} className="font-mono text-xs" spellCheck={false} placeholder="Type or paste a folder path" />
              </form>
              <div className="flex flex-wrap items-center gap-0.5 text-xs">
                {crumbs.map((c, i) => (
                  <span key={c.path} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
                    <button className={cn('rounded px-1 py-0.5 hover:bg-muted', i === crumbs.length - 1 && 'font-semibold')} onClick={() => go(c.path)}>
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter folders" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
              </label>
            </div>

            {/* listing */}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {loading && (
                <div className="grid h-full place-items-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              )}
              {!loading && listing?.error && <p className="p-3 text-sm text-red-400">{listing.error}</p>}
              {!loading && !listing?.path && <p className="p-6 text-center text-sm text-muted-foreground">Choose a starting place on the left.</p>}
              {!loading && listing?.path && !listing.error && entries.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No sub-folders here.</p>}
              {!loading &&
                entries.map((e) => (
                  <div
                    key={e.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => go(e.path)}
                    onKeyDown={(k) => k.key === 'Enter' && go(e.path)}
                    className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted"
                  >
                    {e.markers.length ? <FolderGit2 className="size-4 shrink-0 text-primary" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
                    <span className={cn('truncate', e.hidden && 'text-muted-foreground')}>{e.name}</span>
                    <span className="flex gap-1">
                      {e.markers.slice(0, 3).map((m) => (
                        <Badge key={m} variant="secondary" className="h-4 px-1.5 text-[10px]">
                          {MARKER_LABEL[m] ?? m}
                        </Badge>
                      ))}
                    </span>
                    {e.markers.length > 0 && (
                      <Button
                        size="xs"
                        className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          select(e.path)
                        }}
                      >
                        Open
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>

        <DialogFooter className="m-0 flex-row items-center gap-2 rounded-none border-t p-3 sm:justify-between">
          <button className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={nativePick}>
            Use the system folder dialog instead
          </button>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <Button disabled={!listing?.path || !!listing.error || busy} onClick={() => listing?.path && select(listing.path)}>
              {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
              Open {listing?.path ? `"${crumbs[crumbs.length - 1]?.label ?? listing.path}"` : 'folder'}
              {isProject && <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">project</Badge>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
