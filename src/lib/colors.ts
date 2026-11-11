import { CONNECTION_LABEL } from '../../shared/contracts'
import type { Effect, Layer, SystemKind } from './types'

// Neon palette — tuned to read on near-black
export const NEON = {
  cyan: '#22e8ff',
  magenta: '#ff2bd6',
  lime: '#b6ff3b',
  amber: '#ffb020',
  violet: '#9d7bff',
  orange: '#ff7a1a',
  red: '#ff3864',
  blue: '#5b8cff',
  slate: '#6b7a99',
}

export const LAYER_COLOR: Record<Layer | 'external' | 'table', string> = {
  ui: NEON.cyan,
  api: NEON.amber,
  service: NEON.violet,
  data: NEON.lime,
  test: '#7c8aa5',
  config: '#5d6b85',
  style: '#f39cff',
  doc: '#aab4c8',
  asset: '#3d475c',
  other: '#3d475c',
  external: NEON.magenta,
  table: NEON.lime,
}

export const LAYER_LABEL: Record<Layer | 'external' | 'table', string> = {
  ui: 'Client / UI',
  api: 'API / routes',
  service: 'Logic / services',
  data: 'Data access',
  test: 'Tests',
  config: 'Config',
  style: 'Styles',
  doc: 'Docs',
  asset: 'Assets',
  other: 'Other',
  external: 'External',
  table: 'Tables',
}

export const KIND_COLOR: Record<SystemKind, string> = {
  core: NEON.cyan,
  supporting: NEON.violet,
  generic: NEON.amber,
  platform: NEON.blue,
  frontend: NEON.cyan,
  backend: NEON.violet,
  worker: NEON.amber,
  database: NEON.lime,
  external: NEON.magenta,
  library: NEON.blue,
  cli: '#ffd84a',
  infra: '#8ea0c0',
  other: NEON.slate,
}
export const KIND_LABEL: Record<SystemKind, string> = {
  core: 'Core capability',
  supporting: 'Supporting capability',
  generic: 'Generic capability',
  platform: 'Shared platform',
  frontend: 'Frontend',
  backend: 'Backend',
  worker: 'Worker',
  database: 'Database',
  external: 'External service',
  library: 'Library',
  cli: 'CLI',
  infra: 'Infra',
  other: 'System',
}

export const EDGE_COLOR: Record<string, string> = {
  http: NEON.cyan,
  render: NEON.cyan,
  db: '#60a5fa',
  data: '#60a5fa', read: '#60a5fa', write: NEON.orange,
  fk: NEON.lime,
  sdk: NEON.magenta,
  event: NEON.amber,
  queue: NEON.amber,
  import: '#7d8bb0',
  other: NEON.slate,
}
export const EDGE_LABEL: Record<string, string> = { ...CONNECTION_LABEL, db: CONNECTION_LABEL.data }

export const EFFECT_COLOR: Record<Effect, string> = {
  ui: NEON.cyan,
  request: NEON.cyan,
  logic: NEON.violet,
  read: '#60a5fa',
  write: NEON.orange,
  external: NEON.magenta,
  event: NEON.amber,
  response: '#8ea0c0',
}

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#4d8dff',
  JavaScript: '#ffe14d',
  Python: '#3dffa8',
  Go: '#22e8ff',
  Rust: '#ff8a3d',
  Java: '#ff5470',
  Vue: '#4dff9a',
  Svelte: '#ff3e6c',
  CSS: '#f39cff',
  HTML: '#ff9f5a',
  JSON: '#7c8aa5',
  Markdown: '#aab4c8',
  SQL: '#22ffd5',
  Prisma: '#9d7bff',
  YAML: '#a8a29e',
  Shell: '#c6ff4d',
}
const FALLBACK = ['#c084fc', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#2dd4bf', '#e879f9', '#fde047']

export function langColor(lang: string): string {
  if (LANG_COLOR[lang]) return LANG_COLOR[lang]
  let h = 0
  for (const c of lang) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

export const CODE_LAYERS: Layer[] = ['ui', 'api', 'service', 'data']

export const JOIN_COLOR = { fk: NEON.lime, many_to_many: '#f472b6', code_join: NEON.amber }
export const JOIN_DASH = { fk: undefined, many_to_many: '5 5', code_join: '5 5' }
