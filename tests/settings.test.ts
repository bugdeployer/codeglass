import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaults, validateSettings } from '../server/settings.ts'
import { Analyzer } from '../server/analyze.ts'
import { sourcePacket } from '../server/sourcePacket.ts'
import { runCodex, strictSchema } from '../server/codex.ts'
import { FULL_SCHEMA, PATCH_SCHEMA, type Architecture } from '../server/arch.ts'
import { diffArch } from '../src/lib/changes.ts'

const settings = structuredClone(defaults)
settings.provider = 'codex'
settings.codex.fullModel = ''
assert.deepEqual(validateSettings(settings), settings)
const legacy = structuredClone(settings) as any
delete legacy.codex.detail
assert.equal(validateSettings(legacy).codex.detail, 'quick')
assert.throws(() => validateSettings({ ...settings, codex: { ...settings.codex, detail: 'unknown' } }))
for (const [key, value] of [['provider', 'unknown'], ['liveDelay', 0], ['fullTimeout', -1], ['sidebarWidth', 800], ['showLegends', 'yes']] as const) {
  assert.throws(() => validateSettings({ ...settings, [key]: value }), Error, `Reject ${key}`)
}
assert.throws(() => validateSettings({ ...settings, codex: { ...settings.codex, cliPath: 'bad\npath' } }))
assert.throws(() => validateSettings({ ...settings, claude: { ...settings.claude, fullBudget: NaN } }))
function checkSchema(schema: any) {
  if (!schema || typeof schema !== 'object') return
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, Object.keys(schema.properties))
  }
  Object.values(schema).forEach((value) => { if (Array.isArray(value)) value.forEach(checkSchema); else checkSchema(value) })
}
checkSchema(strictSchema(FULL_SCHEMA))
checkSchema(strictSchema(PATCH_SCHEMA))
assert.equal('additionalProperties' in FULL_SCHEMA, false, 'Original Claude schema unchanged')
const previous: Architecture = { source: 'codex', generatedAt: 1, summary: '', systems: [], flows: [], connections: [], dataDomains: [] }
const next: Architecture = { ...previous, systems: [{ id: 'greeting', name: 'Greeting', kind: 'core', summary: '', tech: [], paths: [], packages: [], entryPoints: [], modules: [] }] }
assert.equal(diffArch(previous, next)[0]?.by, 'codex', 'Codex changes retain provider attribution')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-viz-failure-test-'))
try {
  fs.writeFileSync(path.join(root, 'index.ts'), 'export const greet = () => "Hello"')
  fs.writeFileSync(path.join(root, 'schema.sql'), 'CREATE TABLE users (id INTEGER PRIMARY KEY);')
  const analyzer = new Analyzer(root)
  const scan = await analyzer.run()
  const packet = sourcePacket(scan, (p) => analyzer.contentOf(p))
  assert.ok(packet.included.includes('index.ts'))
  assert.ok(packet.included.includes('schema.sql'))
  assert.ok(packet.text.includes('1: export const greet'))
  assert.ok(packet.text.length < 101_000)
  const withSecret = { ...scan, files: [...scan.files, { ...scan.files[0], path: '.env.secret', layer: 'service' as const }] }
  sourcePacket(withSecret, (p) => { assert.notEqual(p, '.env.secret'); return analyzer.contentOf(p) })
  await assert.rejects(runCodex({ cli: { path: path.join(root, 'missing-cli.exe'), version: 'test' }, root, model: '', prompt: '', schema: FULL_SCHEMA, timeout: 15, maxTools: 1, onProgress: () => {}, onChild: () => {}, isCancelled: () => false }), /ENOENT/)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS: settings validation and migration, source evidence packet, strict schemas, Codex attribution, CLI startup failure')
