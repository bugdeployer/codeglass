import type { Analysis, Architecture, ArchModule, ArchSystem, PartLayer } from './types'

export type ProvisionalSystem = ArchSystem & { provisional: true }
const CODE = new Set(['ui', 'api', 'service', 'data'])
const LAYERS: Record<string, PartLayer> = { ui: 'ui', api: 'api', service: 'logic', data: 'data' }

/** Unassigned ownership is a coverage gap, never evidence that an agent is building.
 * Keep those files accessible in one explicit bucket instead of inventing a feature per helper.
 */
export function withProvisional(arch: Architecture, owner: Record<string, string>, a: Analysis): { arch: Architecture; owner: Record<string, string>; building: string[] } {
  if (arch.source === 'heuristic') return { arch, owner, building: [] }
  const files = a.files.filter(f => CODE.has(f.layer) && !owner[f.path])
  if (!files.length) return { arch, owner, building: [] }
  let id = '__unassigned'
  while (arch.systems.some(s => s.id === id)) id += '-code'
  const out = { ...owner }
  const modules: ArchModule[] = Object.entries(LAYERS).flatMap(([layer, part]) => {
    const paths = files.filter(f => f.layer === layer).map(f => f.path)
    if (!paths.length) return []
    for (const file of paths) out[file] = `${id}/${part}`
    return [{ id: part, name: part === 'ui' ? 'Screens and components' : part === 'api' ? 'Endpoints' : part === 'data' ? 'Data access' : 'Logic', layer: part, summary: 'Scanned code not yet assigned to a feature.', paths, keyFiles: paths.slice(0, 3), input: [], output: [] }]
  })
  const system: ProvisionalSystem = { id, name: 'Unassigned code', kind: 'platform', summary: 'Scanned files not assigned to a feature in this map. Ownership is incomplete; no activity is implied.', tech: [], paths: files.map(f => f.path), packages: [], entryPoints: [], tables: [], modules, input: [], output: [], provisional: true }
  return { arch: { ...arch, systems: [...arch.systems, system] }, owner: out, building: [] }
}
export const isProvisional = (s?: ArchSystem): boolean => !!(s as ProvisionalSystem | undefined)?.provisional
