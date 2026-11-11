import type { Analysis } from './analyze.ts'
import { contractDescription, CONTRACT_VERSION, valueType } from '../shared/contracts.ts'
import { sourcePacket } from './sourcePacket.ts'

export function schemaContract(a: Analysis) {
  return {
    tables: a.schema.tables.map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c, valueType: valueType(c.type) })) })),
    relationships: [
      ...a.schema.relations.map((r) => ({ kind: 'fk', from: r.from, to: r.to, cardinality: r.cardinality ?? 'N:1', evidence: a.schema.tables.filter((t) => t.name === r.from.table).map((t) => t.source) })),
      ...a.schema.junctions.map((j) => ({ kind: 'many_to_many', from: { table: j.a }, to: { table: j.b }, cardinality: 'M:N', via: j.table })),
      ...a.schema.codeJoins.map((j) => ({ kind: 'code_join', from: j.a, to: j.b, cardinality: 'unknown', evidence: j.files })),
    ],
  }
}
export function mappingInput(a: Analysis, contentOf: (file: string) => string | undefined, sourceLimit = 60_000) {
  const packet = sourcePacket(a, contentOf, sourceLimit)
  return {
    contractVersion: CONTRACT_VERSION, vocabulary: contractDescription,
    project: { name: a.name, frameworks: a.frameworks, files: a.stats.files, loc: a.stats.loc },
    files: a.files.slice(0, 1500).map((f) => ({ path: f.path, layer: f.layer, language: f.lang })),
    connections: [
      ...a.edges.slice(0, 2000).map((e) => ({ kind: 'import', from: e.from, to: e.to })),
      ...a.calls.slice(0, 300).map((c) => ({ kind: 'http', from: c.from, to: c.to ?? '', method: c.method ?? 'unknown', url: c.url })),
      ...a.dbAccess.slice(0, 500).map((d) => ({ kind: 'data', from: d.file, to: d.table, operation: 'unknown' })),
    ],
    routes: a.routes.slice(0, 300), database: schemaContract(a),
    externalPackages: a.externals.filter((e) => e.category !== 'package' || e.count > 2).slice(0, 100),
    sources: packet.records,
    coverage: { included: packet.included.length, total: a.files.length, excerptsMayBePartial: true },
  }
}
