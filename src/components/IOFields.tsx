import type { IOContract } from '@shared/contracts'
export function IOFields({ input = [], output = [] }: Partial<IOContract>) {
  return <div className="grid grid-cols-2 gap-3 text-xs">
    {([['Input', input], ['Output', output]] as const).map(([label, fields]) => <div key={label} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      {fields.length ? fields.map((f) => <div key={f.name} title={f.description} className="break-words font-mono text-[11px]"><span>{f.name}</span><span className="ml-1 text-cyan-300">{f.type}</span></div>) : <span className="text-[11px] text-slate-500">Not documented</span>}
    </div>)}
  </div>
}
