// Extracts DB schema (tables, columns, relations) from common sources:
// Prisma, SQL DDL, Drizzle, Django models, SQLAlchemy models.

export type Column = {
  name: string
  type: string
  pk?: boolean
  unique?: boolean
  nullable?: boolean
  fk?: { table: string; column?: string }
}
export type Table = {
  name: string
  source: string
  kind: 'prisma' | 'sql' | 'drizzle' | 'django' | 'sqlalchemy'
  columns: Column[]
  alias?: string[] // identifiers used in code to refer to this table
}
export type Relation = {
  from: { table: string; column: string }
  to: { table: string; column?: string }
  cardinality?: '1:1' | 'N:1'
}
export type CodeJoin = { a: { table: string; column?: string }; b: { table: string; column?: string }; files: string[]; count: number; via: string }
export type Schema = {
  tables: Table[]
  relations: Relation[]
  junctions: { table: string; a: string; b: string }[]
  codeJoins: CodeJoin[]
  relFields: { model: string; field: string; target: string }[]
}

// ---------- helpers ----------
function extractBalanced(src: string, openIdx: number, open: string, close: string): { inner: string; end: number } | null {
  let depth = 0
  let quote: string | null = null
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return { inner: src.slice(openIdx + 1, i), end: i }
    }
  }
  return null
}

function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      cur += c
      continue
    }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    if (c === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

const unq = (s: string) => s.trim().replace(/^["'`\[]+|["'`\]]+$/g, '')
const lastIdent = (s: string) => unq(s.split('.').pop() ?? s)
const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// ---------- Prisma ----------
const PRISMA_SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'])

const prismaRelFields: { model: string; field: string; target: string }[] = []
function parsePrisma(src: string, file: string): { tables: Table[]; relations: Relation[] } {
  const tables: Table[] = []
  const relations: Relation[] = []
  const modelNames = new Set<string>()
  const enums = new Set<string>()
  for (const m of src.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) modelNames.add(m[1])
  for (const m of src.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) enums.add(m[1])

  for (const m of src.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const model = m[1]
    const body = m[2]
    const mapped = body.match(/@@map\(\s*"([^"]+)"/)?.[1]
    const columns: Column[] = []
    const compositePk = body.match(/@@id\(\s*\[([^\]]+)\]/)?.[1]?.split(',').map((s) => s.trim()) ?? []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line || line.startsWith('@@')) continue
      const fm = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/)
      if (!fm) continue
      const [, name, type, list, opt, rest] = fm
      const isRelationTarget = modelNames.has(type)
      if (isRelationTarget) {
        prismaRelFields.push({ model, field: name, target: type })
        const rel = rest.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/)
        if (rel && !list) {
          const fields = rel[1].split(',').map((s) => s.trim())
          const refs = rel[2].split(',').map((s) => s.trim())
          fields.forEach((f, i) => relations.push({ from: { table: model, column: f }, to: { table: type, column: refs[i] } }))
        }
        continue
      }
      if (!PRISMA_SCALARS.has(type) && !enums.has(type)) continue
      columns.push({
        name,
        type: type + (list ? '[]' : ''),
        pk: /@id\b/.test(rest) || compositePk.includes(name),
        unique: /@unique\b/.test(rest),
        nullable: !!opt,
      })
    }
    tables.push({ name: model, source: file, kind: 'prisma', columns, alias: [camel(model), model, ...(mapped ? [mapped] : [])] })
  }
  // mark fk columns
  for (const r of relations) {
    const t = tables.find((t) => t.name === r.from.table)
    const c = t?.columns.find((c) => c.name === r.from.column)
    if (c) c.fk = { table: r.to.table, column: r.to.column }
  }
  return { tables, relations }
}

// ---------- SQL ----------
function stripSqlComments(s: string) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
}

function parseSql(srcRaw: string, file: string): { tables: Table[]; relations: Relation[] } {
  const src = stripSqlComments(srcRaw)
  const tables: Table[] = []
  const relations: Relation[] = []
  const re = /create\s+(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const name = lastIdent(m[1])
    const open = m.index + m[0].length - 1
    const bal = extractBalanced(src, open, '(', ')')
    if (!bal) continue
    const columns: Column[] = []
    const pkCols: string[] = []
    const uniqueCols: string[] = []
    for (const partRaw of splitTopLevel(bal.inner)) {
      const part = partRaw.trim().replace(/\s+/g, ' ')
      if (!part) continue
      const up = part.toUpperCase()
      const tableFk = part.match(/(?:CONSTRAINT\s+\S+\s+)?FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/i)
      if (tableFk) {
        const cols = tableFk[1].split(',').map(unq)
        const refCols = tableFk[3]?.split(',').map(unq) ?? []
        cols.forEach((c, i) => relations.push({ from: { table: name, column: c }, to: { table: lastIdent(tableFk[2]), column: refCols[i] } }))
        continue
      }
      const pk = part.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY KEY\s*\(([^)]+)\)/i)
      if (pk) {
        pkCols.push(...pk[1].split(',').map(unq))
        continue
      }
      const uq = part.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]+)\)/i)
      if (uq) {
        uniqueCols.push(...uq[1].split(',').map(unq))
        continue
      }
      if (/^(CONSTRAINT|CHECK|INDEX|KEY|FULLTEXT|EXCLUDE|LIKE)\b/i.test(part)) continue
      const cm = part.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\w]+(?:\s*\([^)]*\))?(?:\s+(?:varying|precision|with(?:out)? time zone))*)/i)
      if (!cm) continue
      const col: Column = {
        name: unq(cm[1]),
        type: cm[2].toLowerCase(),
        pk: /PRIMARY KEY/.test(up),
        unique: /\bUNIQUE\b/.test(up),
        nullable: !/NOT NULL/.test(up) && !/PRIMARY KEY/.test(up),
      }
      const ref = part.match(/REFERENCES\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/i)
      if (ref) {
        col.fk = { table: lastIdent(ref[1]), column: ref[2] ? unq(ref[2]) : undefined }
        relations.push({ from: { table: name, column: col.name }, to: { table: col.fk.table, column: col.fk.column } })
      }
      columns.push(col)
    }
    for (const c of columns) {
      if (pkCols.includes(c.name)) {
        c.pk = true
        c.nullable = false
      }
      if (uniqueCols.includes(c.name)) c.unique = true
    }
    tables.push({ name, source: file, kind: 'sql', columns, alias: [name] })
  }
  // ALTER TABLE ... ADD ... FOREIGN KEY
  const alt = /alter\s+table\s+(?:only\s+)?([\w."`\[\]]+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/gi
  while ((m = alt.exec(src))) {
    const t = lastIdent(m[1])
    const cols = m[2].split(',').map(unq)
    const refCols = m[4]?.split(',').map(unq) ?? []
    cols.forEach((c, i) => relations.push({ from: { table: t, column: c }, to: { table: lastIdent(m![3]), column: refCols[i] } }))
  }
  return { tables, relations }
}

// ---------- Drizzle ----------
function parseDrizzle(src: string, file: string): { tables: Table[]; relations: Relation[]; varToTable: Map<string, string> } {
  const tables: Table[] = []
  const relations: Relation[] = []
  const varToTable = new Map<string, string>()
  const pending: { table: string; column: string; refVar: string; refCol: string }[] = []
  const re = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:pg|sqlite|mysql)Table\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const varName = m[1]
    const tableName = m[2]
    varToTable.set(varName, tableName)
    const open = m.index + m[0].length - 1
    const bal = extractBalanced(src, open, '{', '}')
    if (!bal) continue
    const columns: Column[] = []
    for (const prop of splitTopLevel(bal.inner)) {
      const pm = prop.trim().match(/^(\w+)\s*:\s*([\s\S]+)$/)
      if (!pm) continue
      const [, key, expr] = pm
      const tm = expr.match(/^(\w+)\s*\(\s*(?:['"`]([^'"`]+)['"`])?/)
      if (!tm) continue
      const col: Column = {
        name: tm[2] ?? key,
        type: tm[1],
        pk: /\.primaryKey\(/.test(expr),
        unique: /\.unique\(/.test(expr),
        nullable: !/\.notNull\(/.test(expr) && !/\.primaryKey\(/.test(expr),
      }
      const ref = expr.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/)
      if (ref) pending.push({ table: tableName, column: col.name, refVar: ref[1], refCol: ref[2] })
      columns.push(col)
    }
    tables.push({ name: tableName, source: file, kind: 'drizzle', columns, alias: [varName, tableName] })
  }
  for (const p of pending) {
    const target = varToTable.get(p.refVar) ?? p.refVar
    const t = tables.find((t) => t.name === p.table)
    const c = t?.columns.find((c) => c.name === p.column)
    if (c) c.fk = { table: target, column: p.refCol }
    relations.push({ from: { table: p.table, column: p.column }, to: { table: target, column: p.refCol } })
  }
  return { tables, relations, varToTable }
}

// ---------- Python ORMs (Django, SQLAlchemy) ----------
function parsePythonModels(src: string, file: string): { tables: Table[]; relations: Relation[] } {
  const tables: Table[] = []
  const relations: Relation[] = []
  const lines = src.split(/\r?\n/)
  const classRe = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(classRe)
    if (!cm) continue
    const bases = cm[2]
    const isDjango = /models\.Model|Model\b/.test(bases) && !/Base\b|DeclarativeBase/.test(bases)
    const isSa = /\bBase\b|DeclarativeBase|db\.Model/.test(bases)
    if (!isDjango && !isSa) continue
    let j = i + 1
    const block: string[] = []
    while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) block.push(lines[j++])
    const tn = block.join('\n').match(/__tablename__\s*=\s*['"]([^'"]+)['"]/)?.[1]
    const name = tn ?? cm[1]
    const columns: Column[] = []
    for (const l of block) {
      const fm = l.match(/^\s+(\w+)\s*(?::[^=]+)?=\s*((?:models|db|sa|sqlalchemy)?\.?(?:Column|mapped_column|\w*Field|ForeignKey|OneToOneField|ManyToManyField))\s*\(([\s\S]*)$/)
      if (!fm) continue
      const [, col, fn, args] = fm
      if (/ManyToMany/.test(fn)) continue
      const c: Column = { name: col, type: fn.replace(/^(models|db|sa|sqlalchemy)\./, '') }
      c.pk = /primary_key\s*=\s*True/.test(args)
      c.unique = /unique\s*=\s*True/.test(args)
      c.nullable = /null\s*=\s*True|nullable\s*=\s*True/.test(args)
      let target: string | undefined
      if (/ForeignKey|OneToOneField/.test(fn)) {
        target = args.match(/^\s*['"]?([\w.]+)['"]?/)?.[1]
      }
      const saFk = args.match(/ForeignKey\(\s*['"]([\w.]+)['"]/)
      if (saFk) target = saFk[1]
      if (target && target !== 'self') {
        const parts = target.split('.')
        c.fk = { table: parts[0], column: parts[1] }
        if (!isSa) c.fk.column = 'id'
        relations.push({ from: { table: name, column: col }, to: { table: c.fk.table, column: c.fk.column } })
      }
      columns.push(c)
    }
    tables.push({ name, source: file, kind: isSa ? 'sqlalchemy' : 'django', columns, alias: [cm[1], name] })
  }
  return { tables, relations }
}

// ---------- Orchestrator ----------
export function parseSchemas(files: { path: string; content: string }[]): Schema {
  prismaRelFields.length = 0
  const tables: Table[] = []
  const relations: Relation[] = []
  for (const f of files) {
    const lower = f.path.toLowerCase()
    let r: { tables: Table[]; relations: Relation[] } | null = null
    if (lower.endsWith('.prisma')) r = parsePrisma(f.content, f.path)
    else if (lower.endsWith('.sql')) r = parseSql(f.content, f.path)
    else if (/\.(ts|js|mjs|cjs)$/.test(lower) && /(pg|sqlite|mysql)Table\(/.test(f.content)) r = parseDrizzle(f.content, f.path)
    else if (lower.endsWith('.py') && /(models\.Model|__tablename__|DeclarativeBase|\(Base\))/.test(f.content)) r = parsePythonModels(f.content, f.path)
    if (r) {
      tables.push(...r.tables)
      relations.push(...r.relations)
    }
  }
  // de-dupe tables by name (migrations can redefine) — keep the one with most columns
  const byName = new Map<string, Table>()
  for (const t of tables) {
    if (t.columns.length === 0) continue // a class that merely looked like a model
    const prev = byName.get(t.name)
    if (!prev || t.columns.length >= prev.columns.length) byName.set(t.name, t)
  }
  const names = new Set(byName.keys())
  const seen = new Set<string>()
  const rels = relations.filter((r) => {
    if (!names.has(r.from.table) || !names.has(r.to.table)) return false
    const k = `${r.from.table}.${r.from.column}->${r.to.table}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  // propagate fk to columns (sql ALTER TABLE)
  for (const r of rels) {
    const c = byName.get(r.from.table)?.columns.find((c) => c.name === r.from.column)
    if (c && !c.fk) c.fk = { table: r.to.table, column: r.to.column }
  }
  // cardinality: FK column that is unique / the whole PK => one-to-one
  for (const r of rels) {
    const t = byName.get(r.from.table)
    const c = t?.columns.find((c) => c.name === r.from.column)
    const pkCount = t?.columns.filter((c) => c.pk).length ?? 0
    r.cardinality = c && (c.unique || (c.pk && pkCount === 1)) ? '1:1' : 'N:1'
  }
  // junction tables: only FKs to 2 distinct tables + bookkeeping columns
  const junctions: Schema['junctions'] = []
  for (const t of byName.values()) {
    const out = rels.filter((r) => r.from.table === t.name)
    const targets = [...new Set(out.map((r) => r.to.table))].filter((x) => x !== t.name)
    if (targets.length !== 2) continue
    const fkCols = new Set(out.map((r) => r.from.column))
    const extra = t.columns.filter((c) => !fkCols.has(c.name) && !/^(id|created_?at|updated_?at|assigned_?at|added_?at|position|order|sort_?order|role|createdAt|updatedAt)$/i.test(c.name))
    if (extra.length === 0) junctions.push({ table: t.name, a: targets[0], b: targets[1] })
  }
  return { tables: [...byName.values()], relations: rels, junctions, codeJoins: [], relFields: [...prismaRelFields] }
}
