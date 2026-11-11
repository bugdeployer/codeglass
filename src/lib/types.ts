import type { IOContract, ConnectionKind } from '../../shared/contracts'
export type Layer = 'ui' | 'api' | 'service' | 'data' | 'test' | 'config' | 'style' | 'doc' | 'asset' | 'other'

export type FileInfo = {
  path: string
  ext: string
  lang: string
  layer: Layer
  size: number
  loc: number
  mtime: number
  imports: string[]
  externals: string[]
}
export type TreeNode = {
  name: string
  path: string
  loc: number
  files: number
  children?: TreeNode[]
  lang?: string
  layer?: Layer
  mtime?: number
}
export type Route = { method: string; path: string; file: string }
export type Call = { from: string; method?: string; url: string; to?: string }
export type Column = {
  name: string
  type: string
  pk?: boolean
  unique?: boolean
  nullable?: boolean
  fk?: { table: string; column?: string }
}
export type Table = { name: string; source: string; kind: string; columns: Column[] }
export type Relation = { from: { table: string; column: string }; to: { table: string; column?: string }; cardinality?: '1:1' | 'N:1' }

export type Analysis = {
  root: string
  name: string
  generatedAt: number
  durationMs: number
  truncated: boolean
  frameworks: string[]
  stats: { files: number; dirs: number; loc: number; bytes: number; languages: { lang: string; files: number; loc: number }[] }
  tree: TreeNode
  files: FileInfo[]
  edges: { from: string; to: string }[]
  externals: { name: string; count: number; category: string; files: string[] }[]
  routes: Route[]
  calls: Call[]
  dbAccess: { file: string; table: string }[]
  schema: { tables: Table[]; relations: Relation[]; junctions: { table: string; a: string; b: string }[]; codeJoins: CodeJoin[] }
}

export type ActivityEvent = {
  id: number
  ts: number
  source: 'fs' | 'claude' | 'codex'
  kind: string
  path?: string
  phase?: 'pre' | 'post'
  detail?: string
  action?: import('../../shared/contracts').ActivityAction
  failed?: boolean
  callId?: string
  sessionId?: string
}

export type ProjectSummary = {
  id: string
  path: string
  name: string
  version: number
  files?: number
  loc?: number
  hooks: boolean
}

// ---------- architecture (Claude map / heuristic) ----------
export type SystemKind = 'core' | 'supporting' | 'generic' | 'platform' | 'external' | 'frontend' | 'backend' | 'worker' | 'database' | 'library' | 'cli' | 'infra' | 'other'
export type PartLayer = 'ui' | 'api' | 'logic' | 'data' | 'job' | 'other'
export type Effect = 'ui' | 'request' | 'logic' | 'read' | 'write' | 'external' | 'event' | 'response'
export type ArchModule = Partial<IOContract> & { id: string; name: string; summary: string; layer?: PartLayer; paths: string[]; keyFiles: string[]; createdAt?: number; updatedAt?: number }
export type ArchSystem = Partial<IOContract> & {
  id: string
  name: string
  kind: SystemKind
  summary: string
  tech: string[]
  paths: string[]
  packages: string[]
  entryPoints: string[]
  tables?: string[]
  modules: ArchModule[]
  createdAt?: number
  updatedAt?: number
}
export type ArchConnection = Partial<IOContract> & { from: string; to: string; kind: ConnectionKind; label: string; evidence: string[]; verified?: boolean }
export type ColumnWrite = { name: string; source: 'input' | 'generated'; sample: string }
export type TableWrite = { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; columns: ColumnWrite[]; code?: string; codeVerified?: boolean }
export type ColumnRead = { name: string; role: 'filter' | 'returned'; sample: string }
export type TableRead = { table: string; columns: ColumnRead[]; code?: string; codeVerified?: boolean }
export type FlowBranch = { when: string; steps: FlowStep[] }
export type FlowStep = Partial<IOContract> & {
  system: string
  module?: string
  file?: string
  symbol?: string
  action: string
  effect: Effect
  verified?: boolean
  when?: string
  branches?: FlowBranch[]
  writes?: TableWrite[]
  reads?: TableRead[]
}
export type ArchFlow = { id: string; name: string; domain?: string; trigger: string; summary: string; steps: FlowStep[]; createdAt?: number; updatedAt?: number }
export type DataDomain = { id: string; name: string; summary: string; tables: string[] }
export type Architecture = {
  contractVersion?: number
  source: 'claude' | 'codex' | 'heuristic'
  generatedAt: number
  summary: string
  systems: ArchSystem[]
  connections: ArchConnection[]
  flows: ArchFlow[]
  dataDomains: DataDomain[]
}
export type MapperState = {
  status: 'idle' | 'running' | 'error'
  provider?: 'claude' | 'codex'
  mode?: 'full' | 'update'
  startedAt?: number
  progress: string[]
  lastError?: string
  lastRun?: { mode: 'full' | 'update'; at: number; tokens: number; costUsd?: number; provider?: 'claude' | 'codex'; durationMs: number }
  totals: { tokens: number; costUsd: number; runs: number; unpricedRuns?: number }
  pending: number
  autoUpdate: boolean
  live: boolean
}
export type CodeJoin = { a: { table: string; column?: string }; b: { table: string; column?: string }; files: string[]; count: number; via: string }
