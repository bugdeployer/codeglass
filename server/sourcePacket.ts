import type { Analysis } from './analyze.ts'

const CODE = new Set(['ui', 'api', 'service', 'data'])
const SECRET = /(^|\/)(\.env(?:\.[^/]*)?|\.claude|\.codex|credentials|secrets?)(\/|\.|$)/i
const ANCHOR = /(^|\/)(readme\.md|package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|main\.[a-z]+|index\.[a-z]+|app\.[a-z]+|server\.[a-z]+)$/i
const IMPORTANT = /\b(export |function |class |async def |def |CREATE TABLE|model |return\b|yield\b|router\.|app\.|select\b|insert\b|update\b|delete\b|\.find|\.create|\.save|\.filter)/i

/** Representative code, with line numbers, prepared from the scanner's existing cache.
 * The model never needs a shell round trip just to discover or read these files.
 */
export function sourcePacket(a: Analysis, contentOf: (file: string) => string | undefined, limit = 100_000) {
  const routes = new Set(a.routes.map((r) => r.file))
  const schemas = new Set(a.schema.tables.map((t) => t.source))
  const inbound = new Map<string, number>()
  for (const edge of a.edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1)
  const candidates = a.files.filter((f) => !SECRET.test(f.path) && !/components\/(ui|evilcharts)\//.test(f.path) && (CODE.has(f.layer) || schemas.has(f.path) || ANCHOR.test(f.path)))
  const score = (p: string) => (routes.has(p) ? 100 : 0) + (schemas.has(p) ? 100 : 0) + (ANCHOR.test(p) ? 40 : 0) + Math.min(inbound.get(p) ?? 0, 20) - (/components\/ui\//.test(p) ? 30 : 0)
  candidates.sort((x, y) => score(y.path) - score(x.path) || x.path.localeCompare(y.path))
  // Give each directory a turn so a large API folder cannot crowd out screens and services.
  const groups = new Map<string, typeof candidates>()
  for (const file of candidates) {
    const key = file.path.split('/').slice(0, -1).join('/')
    const group = groups.get(key) ?? []
    group.push(file); groups.set(key, group)
  }
  const ordered: typeof candidates = []
  while (ordered.length < candidates.length) for (const group of groups.values()) { const file = group.shift(); if (file) ordered.push(file) }
  const parts: string[] = []
  const included: string[] = []
  const records: { path: string; excerpt: string; partial: boolean }[] = []
  let used = 0
  for (const file of ordered) {
    const content = contentOf(file.path)
    if (!content) continue
    const lines = content.split(/\r?\n/)
    const chosen = new Set<number>()
    if (content.length <= 6500) lines.forEach((_, i) => chosen.add(i))
    else {
      for (let i = 0; i < Math.min(18, lines.length); i++) chosen.add(i)
      for (let i = 0; i < lines.length; i++) if (IMPORTANT.test(lines[i])) {
        for (let j = Math.max(0, i - 1); j < Math.min(lines.length, i + 7); j++) chosen.add(j)
      }
    }
    const annotated = [...chosen].sort((x, y) => x - y).map((i) => `${i + 1}: ${lines[i]}`).join('\n')
    const perFileLimit = limit <= 60_000 ? 4000 : 7000
    const excerpt = annotated.slice(0, perFileLimit)
    const partial = content.length > 6500 || annotated.length > perFileLimit
    const part = `--- ${file.path}${partial ? ' (selected excerpts; gaps are omitted)' : ''}\n${excerpt}\n`
    if (used + part.length > limit) continue
    parts.push(part); included.push(file.path); used += part.length
    records.push({ path: file.path, excerpt, partial })
  }
  return {
    text: `SCANNED SOURCE EVIDENCE (${included.length}/${candidates.length} candidate files; excerpts may omit details). Only describe flows supported by this evidence.\n\n${parts.join('\n')}`,
    included,
    records,
  }
}
