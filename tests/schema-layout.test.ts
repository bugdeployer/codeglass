import assert from 'node:assert/strict'
import type { Node } from '@xyflow/react'
import { applySchemaPins, readSchemaPins, saveSchemaPins, schemaAbsoluteX, schemaLayoutKey } from '../src/lib/schemaLayout.ts'
import { Analyzer } from '../server/analyze.ts'
import { fullMappingPlan } from '../server/mappingPlan.ts'
import { defaults, validateSettings } from '../server/settings.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
const nodes: Node[] = [
  { id: 'group', position: { x: 100, y: 200 }, data: {}, style: { width: 800, height: 600 } },
  { id: 'users', parentId: 'group', position: { x: 40, y: 70 }, width: 240, height: 200, extent: [[24, 64], [776, 576]], data: {} },
]
const key = schemaLayoutKey('project-a', true)
saveSchemaPins(key, { group: { x: 300, y: 400 }, users: { x: 150, y: 120, parentId: 'group' } })
const saved = readSchemaPins(key)
const positioned = applySchemaPins(nodes, saved)
assert.deepEqual(positioned[1].position, { x: 150, y: 120 })
assert.equal(schemaAbsoluteX(positioned[1], positioned), 450, 'Moving the group moves the table in world space')
assert.deepEqual(nodes[1].position, { x: 40, y: 70 }, 'Default layout remains unchanged')
const bounded = applySchemaPins(nodes, { users: { x: -500, y: 10_000, parentId: 'group' } })
assert.deepEqual(bounded[1].position, { x: 24, y: 376 }, 'Tables remain inside their group below its header')
const regrouped = applySchemaPins([{ ...nodes[1], parentId: 'different-group' }], saved)
assert.deepEqual(regrouped[0].position, nodes[1].position, 'Ownership changes do not reuse stale relative positions')
assert.deepEqual(readSchemaPins(schemaLayoutKey('project-b', true)), {})
assert.deepEqual(readSchemaPins(schemaLayoutKey('project-a', false)), {})
storage.set('broken', '{invalid')
assert.deepEqual(readSchemaPins('broken'), {})
storage.set('invalid', '{"bad":{"x":"left","y":1}}')
assert.deepEqual(readSchemaPins('invalid'), {})
saveSchemaPins(key, {})
assert.deepEqual(applySchemaPins(nodes, readSchemaPins(key)), nodes, 'Auto-arrange restores calculated positions')

const legacy = structuredClone(defaults) as any
delete legacy.claude.detail
assert.equal(validateSettings(legacy).claude.detail, 'quick')
assert.throws(() => validateSettings({ ...defaults, claude: { ...defaults.claude, detail: 'invalid' } }))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-viz-parity-'))
try {
  fs.writeFileSync(path.join(root, 'index.ts'), 'export function greet(name: string): string { return `Hello ${name}` }')
  const analyzer = new Analyzer(root)
  const scan = await analyzer.run()
  const quick = fullMappingPlan('quick', scan, (file) => analyzer.contentOf(file))
  const detailed = fullMappingPlan('detailed', scan, (file) => analyzer.contentOf(file))
  assert.equal(quick.schema.properties.flows.maxItems, 6)
  assert.equal(detailed.schema.properties.flows.maxItems, undefined)
  assert.ok(quick.prompt.includes('greet(name: string)'))
  assert.ok(quick.prompt.includes('"contractVersion":1'))
  assert.ok(detailed.systemPrompt.includes('Do not call tools'))
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS: schema table/group positions, containment, persistence/reset, regrouping, Claude settings migration, common mapping plans')
