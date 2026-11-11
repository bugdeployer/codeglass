import { Analyzer } from '../server/analyze.ts'
import { heuristic } from '../server/arch.ts'
const a = await new Analyzer(process.argv[2]).run()
const h = heuristic(a)
for (const s of h.systems) console.log(s.kind.padEnd(9), s.name.padEnd(16), s.modules.map((m) => `${m.name}(${m.paths.length})`).join(' '), s.tables?.length ? '| tables: ' + s.tables.join(',') : '')
console.log('flows', h.flows.length, '| first:', h.flows.slice(0, 3).map((f) => `${f.name} [${f.domain}]`).join('; '))
