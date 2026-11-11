import { IOFields } from './IOFields'
import { CheckCircle2, CircleDashed, Copy, Database, FileCode2, KeyRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useProject } from '@/lib/store'
import type { Column, FlowStep, TableRead, TableWrite } from '@/lib/types'
import { cn } from '@/lib/utils'

// writes
const INPUT = '#ff7a1a' // value comes from what the user entered
const GEN = '#5b8cff' // produced by the code / database
// reads
const FILTER = '#ffb020' // used to find the rows
const USED = '#22e8ff' // read and used

const lit = (v: string) => (/^-?\d+(\.\d+)?$|^(true|false|null)$/i.test(v) ? v : `'${v.replace(/'/g, "''")}'`)

function writeSql(w: TableWrite) {
  const cols = w.columns
  const ins = cols.filter((c) => c.source === 'input' || !/^(id)$/i.test(c.name))
  if (w.op === 'insert' || w.op === 'upsert') {
    const body = `INSERT INTO ${w.table} (${ins.map((c) => c.name).join(', ')})\nVALUES (${ins.map((c) => lit(c.sample)).join(', ')})`
    return w.op === 'upsert' ? `${body}\nON CONFLICT DO UPDATE SET ${ins.map((c) => `${c.name} = excluded.${c.name}`).join(', ')}` : body
  }
  if (w.op === 'delete') return `DELETE FROM ${w.table}\nWHERE ${cols.map((c) => `${c.name} = ${lit(c.sample)}`).join(' AND ') || '…'}`
  const key = cols.find((c) => /^(id|pk)$/i.test(c.name))
  const sets = cols.filter((c) => c !== key)
  return `UPDATE ${w.table}\nSET ${sets.map((c) => `${c.name} = ${lit(c.sample)}`).join(',\n    ')}\nWHERE ${key ? `${key.name} = ${lit(key.sample)}` : '…'}`
}
function readSql(r: TableRead) {
  const ret = r.columns.filter((c) => c.role === 'returned')
  const fil = r.columns.filter((c) => c.role === 'filter')
  return `SELECT ${ret.length ? ret.map((c) => c.name).join(', ') : '*'}\nFROM ${r.table}${fil.length ? `\nWHERE ${fil.map((c) => `${c.name} = ${lit(c.sample)}`).join('\n  AND ')}` : ''}`
}

function Query({ code, verified, sql }: { code?: string; verified?: boolean; sql: string }) {
  return (
    <div className="space-y-2 border-t border-white/5 bg-black/30 px-3 py-2">
      {code && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            in code
            {verified ? (
              <span className="flex items-center gap-0.5 normal-case tracking-normal text-[#b6ff3b]">
                <CheckCircle2 className="size-3" /> found in file
              </span>
            ) : (
              <span className="flex items-center gap-0.5 normal-case tracking-normal" title="The mapper's quote could not be matched word-for-word in the file">
                <CircleDashed className="size-3" /> approximate
              </span>
            )}
          </div>
          <pre className="overflow-x-auto rounded-md border border-white/5 bg-[#06060a] p-2 font-mono text-[10.5px] leading-relaxed text-slate-200">{code}</pre>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          as sql
          <button className="ml-auto rounded p-0.5 hover:bg-white/10" onClick={() => navigator.clipboard.writeText(sql)} aria-label="Copy SQL">
            <Copy className="size-3" />
          </button>
        </div>
        <pre className="overflow-x-auto rounded-md border border-white/5 bg-[#06060a] p-2 font-mono text-[10.5px] leading-relaxed text-[#bff7ff]">{sql}</pre>
      </div>
    </div>
  )
}

function Columns({ cols, color }: { cols: Column[]; color: (c: Column) => { color: string; sample: string } | null }) {
  return (
    <ul>
      {cols.map((c) => {
        const hit = color(c)
        return (
          <li
            key={c.name}
            className={cn('grid grid-cols-[14px_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 border-b border-white/[0.04] px-3 py-1 font-mono text-[11px] last:border-0', !hit && 'text-white/80')}
            style={hit ? { background: `${hit.color}14`, color: hit.color } : undefined}
          >
            {c.pk ? <KeyRound className="size-3 opacity-80" /> : <span />}
            <span className={cn('truncate', hit && 'font-semibold')} title={`${c.name}${c.type ? ' · ' + c.type : ''}`}>
              {c.name}
              {c.type ? <span className="ml-1 text-[9px] opacity-50">{c.type}</span> : null}
            </span>
            <span className="truncate text-right" title={hit?.sample}>
              {hit ? hit.sample : <span className="text-white/30">—</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const Legend = ({ items }: { items: [string, string][] }) => (
  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
    {items.map(([c, t]) => (
      <span key={t} className="flex items-center gap-1.5">
        <i className="size-2 rounded-sm" style={{ background: c, boxShadow: c.startsWith('#') ? `0 0 6px ${c}` : undefined }} /> {t}
      </span>
    ))}
  </div>
)

/** What a "writes" / "reads" step does to the database: tables, every column, which ones it touches, sample data and the query. */
export function WriteDetail({ step, onClose, onOpenFile }: { step: FlowStep; onClose: () => void; onOpenFile: (f: string) => void }) {
  const { analysis } = useProject()
  const writes = step.writes ?? []
  const reads = step.reads ?? []
  const isWrite = writes.length > 0
  const accent = isWrite ? INPUT : USED
  const tableCols = (name: string, fallback: string[]): Column[] => analysis?.schema.tables.find((x) => x.name === name)?.columns ?? fallback.map((n) => ({ name: n, type: '' }))

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-white/5 p-4">
        <div className="mb-3"><IOFields input={step.input} output={step.output} /></div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ color: accent, background: `${accent}14`, boxShadow: `0 0 22px -6px ${accent}` }}>
            <Database className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: accent }}>
              {isWrite ? 'writes data' : reads.length ? 'reads data' : step.effect}
            </div>
            <div className="text-base font-semibold tracking-tight">{step.action}</div>
            {step.file && (
              <button className="mt-0.5 flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-muted-foreground hover:text-[#22e8ff]" onClick={() => onOpenFile(step.file!)}>
                <FileCode2 className="size-3 shrink-0" /> {step.file}
                {step.symbol ? ` › ${step.symbol}` : ''}
              </button>
            )}
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {isWrite ? (
          <Legend items={[[INPUT, 'from what the user entered'], [GEN, 'generated'], ['rgba(255,255,255,0.8)', 'not changed']]} />
        ) : (
          <Legend items={[[FILTER, 'used to find the rows'], [USED, 'read and used'], ['rgba(255,255,255,0.8)', 'not read']]} />
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {writes.map((w) => {
            const set = new Map(w.columns.map((c) => [c.name, c]))
            return (
              <section key={`w-${w.table}`} className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0d08]">
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                  <Database className="size-3.5 text-[#b6ff3b]" />
                  <span className="font-mono text-[13px] font-semibold">{w.table}</span>
                  <span className="ml-auto rounded px-1.5 font-mono text-[9px] font-bold uppercase" style={{ color: w.op === 'delete' ? '#ff3864' : INPUT, border: `1px solid ${w.op === 'delete' ? '#ff3864' : INPUT}66` }}>
                    {w.op}
                  </span>
                </div>
                <Columns
                  cols={tableCols(w.table, w.columns.map((c) => c.name))}
                  color={(c) => {
                    const h = set.get(c.name)
                    return h ? { color: h.source === 'input' ? INPUT : GEN, sample: h.sample } : null
                  }}
                />
                <Query code={w.code} verified={w.codeVerified} sql={writeSql(w)} />
              </section>
            )
          })}
          {reads.map((r) => {
            const set = new Map(r.columns.map((c) => [c.name, c]))
            return (
              <section key={`r-${r.table}`} className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0d08]">
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                  <Database className="size-3.5 text-[#b6ff3b]" />
                  <span className="font-mono text-[13px] font-semibold">{r.table}</span>
                  <span className="ml-auto rounded px-1.5 font-mono text-[9px] font-bold uppercase" style={{ color: USED, border: `1px solid ${USED}66` }}>
                    select
                  </span>
                </div>
                <Columns
                  cols={tableCols(r.table, r.columns.map((c) => c.name))}
                  color={(c) => {
                    const h = set.get(c.name)
                    return h ? { color: h.role === 'filter' ? FILTER : USED, sample: h.sample } : null
                  }}
                />
                <Query code={r.code} verified={r.codeVerified} sql={readSql(r)} />
              </section>
            )
          })}
          {!writes.length && !reads.length && <p className="text-sm text-muted-foreground">No table reads or writes recorded for this step.</p>}
        </div>
      </ScrollArea>
    </div>
  )
}
