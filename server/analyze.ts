import fs from 'node:fs/promises'
import path from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { parseSchemas, type Schema, type Table } from './schema.ts'

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
export type Route = { method: string; path: string; file: string; handler?: string; urlFile?: string }
export type Call = { from: string; method?: string; url: string; to?: string }
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
  schema: Schema
}

export const HARD_IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.vercel', '.output',
  'dist', 'build', 'out', 'coverage', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'target', '.idea', '.gradle', '.dart_tool', 'Pods', '.terraform', '.expo', '.angular', '.claude-viz', '.cc-viz', '.codeglass',
  // coding-agent and editor configuration is not part of the app
  '.claude', '.codex', '.cursor', '.vscode',
])
const LOCKFILE = /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|uv\.lock)$/
const MAX_FILES = 12000
const MAX_PARSE_BYTES = 400_000

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', cs: 'C#', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cc: 'C++',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  html: 'HTML', htm: 'HTML',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  md: 'Markdown', mdx: 'Markdown', txt: 'Text', rst: 'Text',
  sql: 'SQL', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL',
  sh: 'Shell', bash: 'Shell', ps1: 'Shell', bat: 'Shell',
  svg: 'SVG',
}
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'avif', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'webm', 'mov', 'pdf', 'zip', 'gz', 'wasm', 'lock', 'map'])
const JS_LIKE = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro'])
const CODE_EXT = new Set([...JS_LIKE, 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc'])
const RESOLVE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro', '.json', '.css', '.scss']

const DB_PACKAGES: Record<string, string> = {
  '@prisma/client': 'database', prisma: 'database', 'drizzle-orm': 'database', pg: 'database', postgres: 'database', mysql2: 'database', mysql: 'database',
  mongodb: 'database', mongoose: 'database', redis: 'database', ioredis: 'database', 'better-sqlite3': 'database', sqlite3: 'database', knex: 'database',
  typeorm: 'database', sequelize: 'database', '@supabase/supabase-js': 'database', firebase: 'database', 'firebase-admin': 'database', '@libsql/client': 'database',
  '@neondatabase/serverless': 'database', '@vercel/postgres': 'database', '@upstash/redis': 'database', sqlalchemy: 'database', psycopg2: 'database', django: 'framework',
  stripe: 'service', openai: 'service', '@anthropic-ai/sdk': 'service', 'ai': 'service', '@sendgrid/mail': 'service', resend: 'service', nodemailer: 'service',
  twilio: 'service', '@aws-sdk/client-s3': 'service', axios: 'network', 'node-fetch': 'network', 'socket.io': 'network', ws: 'network',
  react: 'ui', 'react-dom': 'ui', next: 'framework', vue: 'ui', svelte: 'ui', express: 'framework', hono: 'framework', fastify: 'framework', koa: 'framework',
  fastapi: 'framework', flask: 'framework',
}

const toPosix = (p: string) => p.split(path.sep).join('/')

function pkgName(spec: string) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

type Cached = { mtime: number; size: number; info: FileInfo; content?: string; rawImports: string[] }

export class Analyzer {
  private cache = new Map<string, Cached>()
  root: string
  constructor(root: string) {
    this.root = root
  }

  async run(): Promise<Analysis> {
    const t0 = Date.now()
    const root = this.root
    const rootIg = ignore()
    try {
      rootIg.add(await fs.readFile(path.join(root, '.gitignore'), 'utf8'))
    } catch {}

    const entries: { rel: string; abs: string; size: number; mtime: number }[] = []
    const dirs = new Set<string>()
    let truncated = false

    const walk = async (dirAbs: string, dirRel: string, igs: { base: string; ig: Ignore }[]) => {
      if (entries.length >= MAX_FILES) {
        truncated = true
        return
      }
      let list
      try {
        list = await fs.readdir(dirAbs, { withFileTypes: true })
      } catch {
        return
      }
      // nested .gitignore
      let localIgs = igs
      if (dirRel && list.some((d) => d.isFile() && d.name === '.gitignore')) {
        try {
          const ig = ignore().add(await fs.readFile(path.join(dirAbs, '.gitignore'), 'utf8'))
          localIgs = [...igs, { base: dirRel, ig }]
        } catch {}
      }
      const isIgnored = (rel: string, isDir: boolean) =>
        localIgs.some(({ base, ig }) => {
          const sub = base ? (rel.startsWith(base + '/') ? rel.slice(base.length + 1) : null) : rel
          return sub ? ig.ignores(isDir ? sub + '/' : sub) : false
        })
      await Promise.all(
        list.map(async (d) => {
          const rel = dirRel ? `${dirRel}/${d.name}` : d.name
          if (d.isDirectory()) {
            if (HARD_IGNORE.has(d.name) || isIgnored(rel, true)) return
            dirs.add(rel)
            await walk(path.join(dirAbs, d.name), rel, localIgs)
          } else if (d.isFile()) {
            if (LOCKFILE.test(d.name) || isIgnored(rel, false)) return
            if (entries.length >= MAX_FILES) {
              truncated = true
              return
            }
            try {
              const st = await fs.stat(path.join(dirAbs, d.name))
              entries.push({ rel, abs: path.join(dirAbs, d.name), size: st.size, mtime: st.mtimeMs })
            } catch {}
          }
        }),
      )
    }
    await walk(root, '', [{ base: '', ig: rootIg }])
    entries.sort((a, b) => (a.rel < b.rel ? -1 : 1))

    // ---- tsconfig aliases ----
    const aliases = await this.loadAliases()

    const fileSet = new Set(entries.map((e) => e.rel))
    const seen = new Set<string>()
    const infos: FileInfo[] = []
    const contents = new Map<string, string>()

    await Promise.all(
      entries.map(async (e) => {
        seen.add(e.rel)
        const cached = this.cache.get(e.rel)
        if (cached && cached.mtime === e.mtime && cached.size === e.size) {
          infos.push(cached.info)
          if (cached.content !== undefined) contents.set(e.rel, cached.content)
          return
        }
        const ext = path.extname(e.rel).slice(1).toLowerCase()
        const lang = LANG[ext] ?? (ASSET_EXT.has(ext) ? 'Asset' : 'Other')
        let content: string | undefined
        let loc = 0
        const textual = (ext in LANG && ext !== 'svg') || ['prisma', 'sql', 'graphql'].includes(ext)
        if (textual && e.size <= MAX_PARSE_BYTES) {
          try {
            content = await fs.readFile(e.abs, 'utf8')
            loc = content.split('\n').filter((l) => l.trim()).length
          } catch {}
        } else if (textual) {
          loc = Math.round(e.size / 40)
        }
        const rawImports = content && CODE_EXT.has(ext) ? extractImports(content, ext) : []
        const info: FileInfo = {
          path: e.rel,
          ext,
          lang,
          layer: 'other',
          size: e.size,
          loc,
          mtime: e.mtime,
          imports: [],
          externals: [],
        }
        info.layer = classify(e.rel, ext, content)
        const keepContent = content !== undefined && (CODE_EXT.has(ext) || ['sql', 'prisma'].includes(ext)) ? content : undefined
        this.cache.set(e.rel, { mtime: e.mtime, size: e.size, info, content: keepContent, rawImports })
        infos.push(info)
        if (keepContent !== undefined) contents.set(e.rel, keepContent)
      }),
    )
    for (const k of this.cache.keys()) if (!seen.has(k)) this.cache.delete(k)
    infos.sort((a, b) => (a.path < b.path ? -1 : 1))

    // ---- resolve imports ----
    const edges: { from: string; to: string }[] = []
    const extUse = new Map<string, Set<string>>()
    for (const info of infos) {
      const raw = this.cache.get(info.path)?.rawImports ?? []
      const internal = new Set<string>()
      const ext = new Set<string>()
      for (const spec of raw) {
        const resolved = info.ext === 'py' ? resolvePython(spec, info.path, fileSet) : resolveJs(spec, info.path, fileSet, aliases)
        if (resolved === 'external') {
          if (info.ext === 'py') {
            const n = spec.replace(/^\.+/, '').split('.')[0]
            if (n) ext.add(n)
          } else if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:')) ext.add(pkgName(spec))
        } else if (resolved && resolved !== info.path) internal.add(resolved)
      }
      info.imports = [...internal]
      info.externals = [...ext]
      for (const t of internal) edges.push({ from: info.path, to: t })
      for (const x of ext) {
        if (!extUse.has(x)) extUse.set(x, new Set())
        extUse.get(x)!.add(info.path)
      }
    }

    // ---- schema ----
    const schemaFiles = infos
      .filter((i) => contents.has(i.path) && (['sql', 'prisma', 'py'].includes(i.ext) || /schema|db|model|table|entit/i.test(i.path)))
      .map((i) => ({ path: i.path, content: contents.get(i.path)! }))
    const schema = parseSchemas(schemaFiles)
    schema.codeJoins = extractCodeJoins(infos, contents, schema)
    // mark schema source files as data layer
    for (const t of schema.tables) {
      const f = infos.find((i) => i.path === t.source)
      if (f && f.layer !== 'test') f.layer = 'data'
    }

    // ---- routes / calls ----
    const routes: Route[] = []
    for (const info of infos) {
      const c = contents.get(info.path)
      if (!c || !CODE_EXT.has(info.ext)) continue
      routes.push(...extractRoutes(info.path, info.ext, c))
    }
    // Django-style url confs point at a view (views.overview): move the route onto the module that defines it
    const byPath = new Map(infos.map((i) => [i.path, i]))
    for (const r of routes) {
      if (!r.handler || !r.handler.includes('.')) {
        if (r.handler) {
          // directly imported function: find the imported module that defines it
          const def = (byPath.get(r.file)?.imports ?? []).find((p) => new RegExp(`^\\s*(?:async\\s+)?def\\s+${r.handler}\\b|^class\\s+${r.handler}\\b`, 'm').test(contents.get(p) ?? ''))
          if (def) (r.urlFile = r.file), (r.file = def)
        }
        continue
      }
      const [mod, fn] = [r.handler.slice(0, r.handler.lastIndexOf('.')), r.handler.split('.').pop()!]
      const modName = mod.split('.').pop()!
      const imports = byPath.get(r.file)?.imports ?? []
      const target = imports.find((p) => p.endsWith(`/${modName}.py`) || p.endsWith(`/${modName}/__init__.py`) || p === `${modName}.py`) ?? imports.find((p) => new RegExp(`^\\s*(?:async\\s+)?def\\s+${fn}\\b`, 'm').test(contents.get(p) ?? ''))
      if (target) {
        r.urlFile = r.file
        r.file = target
        r.handler = fn
      }
    }
    const calls: Call[] = []
    for (const info of infos) {
      const c = contents.get(info.path)
      if (!c || !CODE_EXT.has(info.ext) || info.layer === 'test') continue
      const seenUrls = new Set<string>()
      for (const call of extractCalls(c)) {
        const target = matchRoute(call.url, call.method, routes)
        seenUrls.add(call.url)
        calls.push({ from: info.path, method: call.method, url: call.url, to: target?.file })
      }
      // URL literals passed to API wrappers (request('/api/x'), api.get(`/users/${id}`) …): keep the ones that hit a real route
      if (JS_LIKE.has(info.ext) && routes.length) {
        for (const m of c.matchAll(/['"`](\/[A-Za-z][\w\-./${}:]*)(?:\?[^'"`\s]*)?['"`]/g)) {
          const url = m[1].replace(/\$\{[^}]*\}/g, ':param').replace(/\/+$/, '') || '/'
          if (seenUrls.has(url) || /\.(css|js|ts|tsx|svg|png|jpe?g|ico|json|html|woff2?)$/.test(url)) continue
          const target = matchRoute(url, undefined, routes)
          if (!target) continue
          seenUrls.add(url)
          calls.push({ from: info.path, url, to: target.file })
        }
      }
    }
    for (const r of routes) {
      const f = infos.find((i) => i.path === r.file)
      if (f && f.layer !== 'test' && f.layer !== 'data') f.layer = 'api'
    }

    // ---- db access ----
    const dbAccess: { file: string; table: string }[] = []
    if (schema.tables.length) {
      const matchers = schema.tables.map((t) => tableMatcher(t))
      for (const info of infos) {
        const c = contents.get(info.path)
        if (!c || !CODE_EXT.has(info.ext) || info.layer === 'test') continue
        if (schema.tables.some((t) => t.source === info.path)) continue
        schema.tables.forEach((t, i) => {
          if (matchers[i](c, info.ext)) dbAccess.push({ file: info.path, table: t.name })
        })
      }
    }

    // ---- stats / tree / frameworks ----
    const langAgg = new Map<string, { files: number; loc: number }>()
    let loc = 0
    let bytes = 0
    for (const f of infos) {
      bytes += f.size
      loc += f.loc
      if (f.lang === 'Asset' || f.lang === 'Other' || !f.loc) continue
      const a = langAgg.get(f.lang) ?? { files: 0, loc: 0 }
      a.files++
      a.loc += f.loc
      langAgg.set(f.lang, a)
    }
    const languages = [...langAgg.entries()].map(([lang, v]) => ({ lang, ...v })).sort((a, b) => b.loc - a.loc)

    const externals = [...extUse.entries()]
      .map(([name, set]) => ({ name, count: set.size, category: DB_PACKAGES[name] ?? 'package', files: [...set] }))
      .sort((a, b) => b.count - a.count)

    const tree = buildTree(path.basename(root), infos)
    const frameworks = await this.detectFrameworks(externals.map((e) => e.name))

    return {
      root,
      name: path.basename(root),
      generatedAt: Date.now(),
      durationMs: Date.now() - t0,
      truncated,
      frameworks,
      stats: { files: infos.length, dirs: dirs.size, loc, bytes, languages },
      tree,
      files: infos,
      edges,
      externals,
      routes,
      calls,
      dbAccess,
      schema,
    }
  }

  contentOf(p: string): string | undefined {
    return this.cache.get(p)?.content
  }

  private async loadAliases() {
    const out: { prefix: string; targets: string[] }[] = []
    let baseUrl = ''
    for (const name of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json', 'tsconfig.base.json']) {
      try {
        const raw = await fs.readFile(path.join(this.root, name), 'utf8')
        const json = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
        const co = json.compilerOptions ?? {}
        if (co.baseUrl) baseUrl = co.baseUrl
        for (const [k, v] of Object.entries<string[]>(co.paths ?? {})) {
          out.push({ prefix: k.replace(/\*$/, ''), targets: v.map((t) => path.posix.join(baseUrl || '.', t.replace(/\*$/, ''))) })
        }
      } catch {}
    }
    if (!out.some((a) => a.prefix === '@/')) out.push({ prefix: '@/', targets: ['src/', ''] })
    if (!out.some((a) => a.prefix === '~/')) out.push({ prefix: '~/', targets: ['src/', ''] })
    return { aliases: out, baseUrl: baseUrl ? path.posix.normalize(baseUrl) : '' }
  }

  private async detectFrameworks(pkgs: string[]) {
    const have = new Set(pkgs)
    const out: string[] = []
    const map: [string, string][] = [
      ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['vite', 'Vite'], ['express', 'Express'], ['hono', 'Hono'],
      ['fastify', 'Fastify'], ['@prisma/client', 'Prisma'], ['drizzle-orm', 'Drizzle'], ['mongoose', 'Mongoose'], ['tailwindcss', 'Tailwind'],
      ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['django', 'Django'], ['sqlalchemy', 'SQLAlchemy'], ['@supabase/supabase-js', 'Supabase'],
    ]
    for (const [k, v] of map) if (have.has(k)) out.push(v)
    try {
      const pj = JSON.parse(await fs.readFile(path.join(this.root, 'package.json'), 'utf8'))
      const deps = { ...pj.dependencies, ...pj.devDependencies }
      for (const [k, v] of map) if (deps[k] && !out.includes(v)) out.push(v)
    } catch {}
    return out
  }
}

// ---------- classification ----------
function classify(rel: string, ext: string, content?: string): Layer {
  const p = rel.toLowerCase()
  if (ASSET_EXT.has(ext)) return 'asset'
  if (/(^|\/)(__tests__|tests?|spec|e2e|cypress)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p)) return 'test'
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'style'
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) return 'doc'
  if (['sql', 'prisma'].includes(ext)) return 'data'
  if (['json', 'yaml', 'yml', 'toml'].includes(ext) || /\.config\.[a-z]+$/.test(p) || /(^|\/)\.[^/]+$/.test(p)) return 'config'
  if (!CODE_EXT.has(ext) && ext !== 'html') return 'other'
  if (/(^|\/)(migrations?|db|database|drizzle|prisma|models?|entities|schemas?)(\/|\.)/.test(p)) return 'data'
  if (/(^|\/)(api|routes?|controllers?|handlers?|server|backend|functions)(\/|\.)/.test(p) || /(^|\/)route\.[jt]sx?$/.test(p)) return 'api'
  if (content) {
    if (/\b(express|Hono|fastify|FastAPI|Flask)\s*\(/.test(content) || /@(app|router)\.(get|post|put|delete|patch)\(/.test(content)) return 'api'
    if (/from\s+['"](@prisma\/client|drizzle-orm[^'"]*|pg|mysql2|mongoose|better-sqlite3|knex|typeorm)['"]/.test(content) || /new PrismaClient\(/.test(content)) return 'data'
  }
  if (['tsx', 'jsx', 'vue', 'svelte', 'astro', 'html'].includes(ext) || /(^|\/)(components?|pages?|views?|ui|app|screens|hooks|layouts?|public|client|frontend|web)\//.test(p)) return 'ui'
  return 'service'
}

// ---------- imports ----------
function extractImports(src: string, ext: string): string[] {
  const out = new Set<string>()
  if (ext === 'py') {
    for (const m of src.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
      const mod = m[1]
      if (/^\.+$/.test(mod)) {
        for (const n of m[2].replace(/[()\n]/g, '').split(',')) {
          const name = n.trim().split(/\s+as\s+/)[0]
          if (name && name !== '*') out.add(mod + name)
        }
      } else out.add(mod)
    }
    for (const m of src.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const n of m[1].split(',')) out.add(n.trim().split(/\s+as\s+/)[0])
    return [...out]
  }
  if (!JS_LIKE.has(ext)) return []
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/gm)) out.add(m[1])
  for (const m of code.matchAll(/\b(?:require|import)\s*\(\s*['"`]([^'"`\n$]+)['"`]\s*\)/g)) out.add(m[1])
  return [...out]
}

function resolveFile(base: string, fileSet: Set<string>): string | null {
  const b = path.posix.normalize(base).replace(/^\.\//, '')
  const stripped = b.replace(/\.(m|c)?jsx?$/, '')
  const cands = [b, ...RESOLVE_EXT.map((e) => b + e), ...RESOLVE_EXT.map((e) => `${b}/index${e}`)]
  if (stripped !== b) cands.push(...RESOLVE_EXT.map((e) => stripped + e))
  for (const c of cands) if (fileSet.has(c)) return c
  return null
}

function resolveJs(
  spec: string,
  from: string,
  fileSet: Set<string>,
  cfg: { aliases: { prefix: string; targets: string[] }[]; baseUrl: string },
): string | 'external' | null {
  const dir = path.posix.dirname(from)
  if (spec.startsWith('.')) return resolveFile(path.posix.join(dir, spec), fileSet)
  for (const a of cfg.aliases) {
    if (a.prefix && spec.startsWith(a.prefix)) {
      for (const t of a.targets) {
        const r = resolveFile(path.posix.join(t, spec.slice(a.prefix.length)), fileSet)
        if (r) return r
      }
    }
  }
  if (cfg.baseUrl) {
    const r = resolveFile(path.posix.join(cfg.baseUrl, spec), fileSet)
    if (r) return r
  }
  return 'external'
}

function resolvePython(spec: string, from: string, fileSet: Set<string>): string | 'external' | null {
  const dots = spec.match(/^\.+/)?.[0].length ?? 0
  const rest = spec.slice(dots).replace(/\./g, '/')
  const tryBases = dots
    ? [path.posix.join(path.posix.dirname(from), ...Array(dots - 1).fill('..'), rest)]
    : [rest, path.posix.join('src', rest), path.posix.join(path.posix.dirname(from), rest)]
  for (const b of tryBases) {
    for (const c of [`${b}.py`, `${b}/__init__.py`]) if (fileSet.has(path.posix.normalize(c))) return path.posix.normalize(c)
  }
  return dots ? null : 'external'
}

// ---------- routes & calls ----------
function nextRoutePath(rel: string): string | null {
  let m = rel.match(/(?:^|\/)app\/(.*)\/route\.[jt]sx?$/)
  if (m) return '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')
  m = rel.match(/(?:^|\/)pages\/(api\/.*)\.[jt]sx?$/)
  if (m) return '/' + m[1].replace(/\/index$/, '')
  return null
}

function extractRoutes(rel: string, ext: string, src: string): Route[] {
  const out: Route[] = []
  const np = nextRoutePath(rel)
  if (np) {
    const methods = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])
    if (methods.length) methods.forEach((m) => out.push({ method: m, path: np, file: rel }))
    else out.push({ method: 'ANY', path: np, file: rel })
    return out
  }
  if (JS_LIKE.has(ext)) {
    for (const m of src.matchAll(/\b(?:app|router|api|server|r|route|routes|fastify|[A-Za-z_$][\w$]*(?:Router|Routes?|App|Api))\.(get|post|put|delete|patch|all)\(\s*['"`](\/[^'"`]*)['"`]/g)) {
      out.push({ method: m[1].toUpperCase(), path: m[2], file: rel })
    }
  } else if (ext === 'py') {
    for (const m of src.matchAll(/@\w+\.(get|post|put|delete|patch|route)\(\s*['"]([^'"]+)['"]/g)) out.push({ method: m[1].toUpperCase(), path: m[2], file: rel })
    for (const m of src.matchAll(/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*(?:,\s*([\w.]+))?/g)) {
      if (m[2] === 'include') continue
      out.push({ method: 'ANY', path: '/' + m[1].replace(/<\w+:(\w+)>/g, ':$1').replace(/<(\w+)>/g, ':$1').replace(/^\^|\$$/g, ''), file: rel, handler: m[2] })
    }
  }
  return out
}

function extractCalls(src: string): { url: string; method?: string }[] {
  const out: { url: string; method?: string }[] = []
  const norm = (u: string) => u.replace(/\$\{[^}]*\}/g, ':param').split('?')[0].replace(/^https?:\/\/[^/]+/, '')
  for (const m of src.matchAll(/\bfetch\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\{[^}]*?method:\s*['"`](\w+)['"`])?/g)) out.push({ url: norm(m[1]), method: m[2]?.toUpperCase() })
  for (const m of src.matchAll(/\baxios\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g)) out.push({ url: norm(m[2]), method: m[1].toUpperCase() })
  for (const m of src.matchAll(/\b(?:useSWR|useQuery)\(\s*['"`]([^'"`]+)['"`]/g)) out.push({ url: norm(m[1]) })
  return out.filter((c) => c.url.startsWith('/'))
}

function matchRoute(url: string, method: string | undefined, routes: Route[]): Route | undefined {
  const segs = url.split('/').filter(Boolean)
  const tryMatch = (s: string[]) => {
    const cands = routes.filter((r) => {
      const rs = r.path.split('/').filter(Boolean)
      if (rs.length !== s.length) return false
      return rs.every((x, i) => /^(:|\[|\{|<)/.test(x) || s[i] === ':param' || x === s[i])
    })
    return cands.find((r) => method && r.method === method) ?? cands[0]
  }
  // exact first; then allow a mount prefix the route file doesn't know about (e.g. Django include('api/'), app.use('/api', router))
  for (let drop = 0; drop <= Math.min(2, segs.length - 1); drop++) {
    const m = tryMatch(segs.slice(drop))
    if (m) return m
  }
  return undefined
}

const SQL_HINT = /\b(select|insert|update|delete)\b[\s\S]{0,300}?\b(from|into|set)\b/i
function tableMatcher(t: Table): (src: string, ext: string) => boolean {
  const names = [...new Set<string>([t.name, ...(t.alias ?? [])].filter((n) => n.length >= 3))]
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sql = new RegExp(names.map((n) => `\\b(?:from|into|update|join)\\s+["'\`]?${esc(n)}\\b`).join('|'), 'i')
  const prisma = new RegExp([...names.map((n) => `\\bprisma\\.${esc(n)}\\b`), `\\b(?:prisma|db|client)\\.${esc(t.name.charAt(0).toLowerCase() + t.name.slice(1))}\\.`].join('|'))
  // ORM identifiers only count in the ORM's own language, and case-sensitively (class / variable names)
  const ident = new RegExp((t.alias ?? []).filter((n) => n.length >= 3).map((n) => `\\b${esc(n)}\\b`).join('|') || '(?!)')
  const identLang = t.kind === 'django' || t.kind === 'sqlalchemy' ? (e: string) => e === 'py' : t.kind === 'drizzle' ? (e: string) => JS_LIKE.has(e) : () => false
  return (src, ext) => {
    if (t.kind === 'prisma' && JS_LIKE.has(ext) && prisma.test(src)) return true
    if (identLang(ext) && ident.test(src)) return true
    return SQL_HINT.test(src) && sql.test(src)
  }
}

// ---------- joins written in code ----------
function extractCodeJoins(infos: FileInfo[], contents: Map<string, string>, schema: Schema): Schema['codeJoins'] {
  const tables = new Map<string, string>() // lowercase alias/name -> table
  for (const t of schema.tables) {
    tables.set(t.name.toLowerCase(), t.name)
    for (const al of t.alias ?? []) tables.set(al.toLowerCase(), t.name)
  }
  const resolve = (s: string) => tables.get(s.replace(/["`[\]]/g, '').split('.').pop()!.toLowerCase())
  const acc = new Map<string, Schema['codeJoins'][number]>()
  const add = (ta: string, ca: string | undefined, tb: string, cb: string | undefined, file: string, via: string) => {
    if (ta === tb) return
    const [x, y] = ta < tb ? [{ table: ta, column: ca }, { table: tb, column: cb }] : [{ table: tb, column: cb }, { table: ta, column: ca }]
    const k = `${x.table}.${x.column ?? ''}|${y.table}.${y.column ?? ''}`
    const e = acc.get(k) ?? { a: x, b: y, files: [], count: 0, via }
    e.count++
    if (!e.files.includes(file)) e.files.push(file)
    acc.set(k, e)
  }
  for (const f of infos) {
    const c = contents.get(f.path)
    if (!c || !CODE_EXT.has(f.ext)) continue
    // SQL: FROM t [AS] x ... JOIN u [AS] y ON x.a = y.b
    if (/\bjoin\b/i.test(c)) {
      const alias = new Map<string, string>()
      for (const m of c.matchAll(/\b(?:from|join)\s+([\w."`]+)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi)) {
        const t = resolve(m[1])
        if (!t) continue
        alias.set(m[1].replace(/["`]/g, '').split('.').pop()!.toLowerCase(), t)
        if (m[2] && !/^(on|join|where|inner|left|right|full|cross|using|group|order|limit|set|values)$/i.test(m[2])) alias.set(m[2].toLowerCase(), t)
      }
      for (const m of c.matchAll(/\bon\s+"?(\w+)"?\."?(\w+)"?\s*=\s*"?(\w+)"?\."?(\w+)"?/gi)) {
        const ta = alias.get(m[1].toLowerCase()) ?? resolve(m[1])
        const tb = alias.get(m[3].toLowerCase()) ?? resolve(m[3])
        if (ta && tb) add(ta, m[2], tb, m[4], f.path, 'sql')
      }
    }
    // Drizzle: .innerJoin(users, eq(orders.userId, users.id))
    for (const m of c.matchAll(/\.(?:inner|left|right|full)Join\(\s*\w+\s*,\s*eq\(\s*(\w+)\.(\w+)\s*,\s*(\w+)\.(\w+)\s*\)/g)) {
      const ta = resolve(m[1])
      const tb = resolve(m[3])
      if (ta && tb) add(ta, m[2], tb, m[4], f.path, 'drizzle')
    }
    // Prisma: prisma.order.findMany({ include: { user: true } })
    if (schema.relFields.length) {
      for (const m of c.matchAll(/\b(?:prisma|db)\.(\w+)\.\w+\(\s*\{[\s\S]{0,400}?(?:include|select)\s*:\s*\{([\s\S]{0,400}?)\}/g)) {
        const base = resolve(m[1])
        if (!base) continue
        for (const fm of m[2].matchAll(/(\w+)\s*:/g)) {
          const rf = schema.relFields.find((r) => r.model === base && r.field === fm[1])
          if (rf) add(base, undefined, rf.target, undefined, f.path, 'prisma')
        }
      }
    }
  }
  return [...acc.values()]
}

// ---------- tree ----------
function buildTree(rootName: string, files: FileInfo[]): TreeNode {
  const root: TreeNode = { name: rootName, path: '', loc: 0, files: 0, children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/')
      let next = cur.children!.find((c) => c.path === p)
      if (!next) {
        next = { name: parts[i], path: p, loc: 0, files: 0, children: [] }
        cur.children!.push(next)
      }
      cur = next
    }
    cur.children!.push({ name: parts[parts.length - 1], path: f.path, loc: Math.max(f.loc, f.lang === 'Asset' ? 0 : 1), files: 1, lang: f.lang, layer: f.layer, mtime: f.mtime })
  }
  const total = (n: TreeNode): void => {
    if (!n.children) return
    n.children.forEach(total)
    n.loc = n.children.reduce((s, c) => s + c.loc, 0)
    n.files = n.children.reduce((s, c) => s + c.files, 0)
    n.children.sort((a, b) => b.loc - a.loc)
  }
  total(root)
  return root
}

export function toRel(root: string, abs: string): string | null {
  const r = path.relative(root, abs)
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null
  return toPosix(r)
}
