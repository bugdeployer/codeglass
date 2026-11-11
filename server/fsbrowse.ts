import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKERS: [string, string][] = [
  ['package.json', 'node'],
  ['.git', 'git'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['go.mod', 'go'],
  ['Cargo.toml', 'rust'],
  ['composer.json', 'php'],
  ['Gemfile', 'ruby'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['deno.json', 'deno'],
  ['CLAUDE.md', 'claude'],
]
const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', 'AppData', '__pycache__'])

export type DirEntry = { name: string; path: string; markers: string[]; hidden: boolean }
export type Listing = {
  path: string | null
  parent: string | null
  markers: string[]
  entries: DirEntry[]
  quick: { label: string; path: string }[]
  error?: string
}

async function markersOf(dir: string): Promise<string[]> {
  const out = new Set<string>()
  await Promise.all(
    MARKERS.map(async ([file, tag]) => {
      try {
        await fs.access(path.join(dir, file))
        out.add(tag)
      } catch {}
    }),
  )
  return [...out]
}

function quickLinks(): { label: string; path: string }[] {
  const home = os.homedir()
  const q = [
    { label: 'Home', path: home },
    { label: 'Documents', path: path.join(home, 'Documents') },
    { label: 'Desktop', path: path.join(home, 'Desktop') },
    { label: 'Projects', path: path.join(home, 'Projects') },
    { label: 'source/repos', path: path.join(home, 'source', 'repos') },
    { label: 'dev', path: path.join(home, 'dev') },
    { label: 'code', path: path.join(home, 'code') },
  ].filter((x) => existsSync(x.path))
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`
      if (existsSync(d)) q.push({ label: d.slice(0, 2), path: d })
    }
  } else q.push({ label: '/', path: '/' })
  return q
}

export async function listDir(p?: string): Promise<Listing> {
  const quick = quickLinks()
  const abs = path.resolve(p || os.homedir()) // first open starts in the home folder
  try {
    const items = await fs.readdir(abs, { withFileTypes: true })
    const dirs = items.filter((d) => d.isDirectory() && !SKIP.has(d.name)).slice(0, 800)
    const entries = await Promise.all(
      dirs.map(async (d) => {
        const full = path.join(abs, d.name)
        return { name: d.name, path: full, markers: await markersOf(full), hidden: d.name.startsWith('.') }
      }),
    )
    entries.sort((a, b) => Number(b.markers.length > 0) - Number(a.markers.length > 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const parent = path.dirname(abs)
    return { path: abs, parent: parent === abs ? null : parent, markers: await markersOf(abs), entries, quick }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    const error = code === 'ENOENT' ? 'This folder no longer exists.' : code === 'EACCES' || code === 'EPERM' ? 'You do not have permission to open this folder.' : code === 'ENOTDIR' ? 'This is a file, not a folder.' : (e as Error).message
    return { path: abs, parent: path.dirname(abs), markers: [], entries: [], quick, error }
  }
}
