import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CONNECTION_KINDS, connectionKind, valueType } from '../shared/contracts.ts'
import { withProvisional } from '../src/lib/provisional.ts'
import { Model } from '../src/lib/model.ts'
import { cardActivities } from '../src/lib/activity.ts'
import { fullSchema, validate, type Architecture } from '../server/arch.ts'
import { strictSchema } from '../server/codex.ts'
import { Analyzer } from '../server/analyze.ts'
import { mappingInput, schemaContract } from '../server/contracts.ts'
import { ingestActivity } from '../server/activity.ts'
import { installHooks, uninstallHooks, hooksInstalled } from '../server/hooks.ts'
import { mcpRequest } from '../server/mcp.ts'
import type { Registry } from '../server/projects.ts'
import type { ActivityEvent } from '../src/lib/types.ts'

assert.equal(connectionKind('db'), 'data')
assert.equal(connectionKind('sounds-like-a-read'), 'other')
assert.equal(valueType('VARCHAR(100)'), 'string')
assert.equal(valueType('IntegerField'), 'number')
const quick = strictSchema(fullSchema('quick'))
assert.equal(quick.properties.flows.maxItems, 6)
assert.equal(quick.properties.flows.items.properties.steps.maxItems, 4)
assert.deepEqual(quick.properties.connections.items.properties.kind.enum, [...CONNECTION_KINDS])
assert.ok(quick.properties.systems.items.required.includes('input'))
assert.ok(quick.properties.systems.items.properties.modules.items.required.includes('output'))
assert.equal((fullSchema('detailed') as any).properties.flows.maxItems, undefined)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-viz-contract-test-'))
try {
  fs.writeFileSync(path.join(root, 'index.ts'), 'export const run = (value: string) => value')
  fs.writeFileSync(path.join(root, 'schema.sql'), 'CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));')
  const analyzer = new Analyzer(root)
  const scan = await analyzer.run()
  const input = mappingInput(scan, (file) => analyzer.contentOf(file))
  assert.equal(input.contractVersion, 1)
  assert.ok(input.sources.some((s) => s.path === 'index.ts'))
  assert.equal(schemaContract(scan).relationships[0]?.kind, 'fk')
  const old: Architecture = { source: 'claude', generatedAt: 0, summary: '', systems: [{ id: 'orders', name: 'Orders', kind: 'core', summary: '', tech: [], paths: ['index.ts'], packages: [], entryPoints: [], modules: [] }], connections: [], flows: [], dataDomains: [] }
  const normalized = validate(old, scan, (file) => analyzer.contentOf(file))
  assert.deepEqual(normalized.systems[0].input, [])
  assert.deepEqual(normalized.systems[0].output, [])
  assert.equal(normalized.contractVersion, 1)
  const sequential = validate({ ...old, flows: [{ id: 'plain', name: 'Plain sequence', trigger: 'request', summary: '', steps: [{ system: 'orders', effect: 'request', action: 'Read request' }, { system: 'orders', effect: 'response', action: 'Return result', when: 'The request has been read' }] }] }, scan, p => analyzer.contentOf(p))
  assert.equal(sequential.flows[0].steps[1].when, undefined, 'Sequential hand-offs do not imply branch conditions')
  const unownedScan = { ...scan, files: scan.files.map(f => ({ ...f, layer: 'service' as const })) }
  const unassigned = withProvisional({ ...old, source: 'codex' }, {}, unownedScan)
  assert.equal(unassigned.arch.systems.filter(s => s.id.startsWith('__unassigned')).length, 1)
  assert.deepEqual(unassigned.building, [])
  const target = { ...old.systems[0], id: 'users', name: 'Users' }
  const links: Architecture = { ...old, systems: [...old.systems, target], connections: [{ from: 'orders', to: 'users', kind: 'http', label: 'calls', evidence: [] }, { from: 'orders', to: 'users', kind: 'event', label: 'notifies', evidence: [] }] }
  const graph = new Model(scan, links, {}).graph({})
  assert.equal(graph.edges.length, 2, 'Different connection types remain separate edges')
  assert.ok(graph.edges.some(e => e.kinds.http))
  assert.ok(graph.edges.some(e => e.kinds.event))

  const events: ActivityEvent[] = []
  const project = { meta: { path: root }, analysis: scan, analyzer, mapper: { ownsSession: (id: string) => id === 'mapper-session' }, push: (event: Omit<ActivityEvent, 'id' | 'ts'>) => events.push({ ...event, id: events.length, ts: 1000 + events.length }) }
  const registry = { owner: (cwd: string) => cwd === root || cwd.startsWith(root + path.sep) ? project : undefined } as unknown as Registry
  const payload = { cwd: root, tool_name: 'apply_patch', session_id: 'codex-session', tool_use_id: 'patch-1', hook_event_name: 'PreToolUse', tool_input: '*** Begin Patch\n*** Update File: index.ts\n@@\n-old\n+new\n*** End Patch' }
  ingestActivity(registry, payload, 'codex')
  assert.equal(events[0].path, 'index.ts')
  assert.equal(events[0].action, 'editing')
  assert.equal(cardActivities(events, 1005).get('index.ts')?.active, true)
  ingestActivity(registry, { ...payload, hook_event_name: 'PostToolUse' }, 'codex')
  assert.equal(cardActivities(events, 1005).get('index.ts')?.active, false)
  ingestActivity(registry, { cwd: root, session_id: 'codex-session', hook_event_name: 'Stop' }, 'codex')
  assert.equal(cardActivities(events, 1005).get('index.ts')?.active, false)
  ingestActivity(registry, { ...payload, tool_name: 'functions.exec', tool_input: { code: 'await tools.apply_patch(' + JSON.stringify(payload.tool_input) + ')' } }, 'codex')
  assert.equal(events.at(-1)?.action, 'editing')
  assert.equal(events.at(-1)?.path, 'index.ts')
  const count = events.length
  ingestActivity(registry, { ...payload, session_id: 'mapper-session' }, 'codex')
  ingestActivity(registry, { ...payload, tool_input: { file_path: '../outside.ts' } }, 'codex')
  assert.equal(events.length, count)
  const report = mcpRequest(registry, { id: 1, method: 'tools/call', params: { name: 'report_activity', arguments: { cwd: root, provider: 'claude', path: 'index.ts', action: 'refactoring', phase: 'pre', sessionId: 'claude-session', callId: 'refactor-1' } } })
  assert.ok('result' in report)
  assert.equal(cardActivities(events, 1006).get('index.ts')?.action, 'refactoring')
  ingestActivity(registry, { ...payload, session_id: 'failure-session' }, 'claude')
  ingestActivity(registry, { ...payload, session_id: 'failure-session', hook_event_name: 'PostToolUseFailure' }, 'claude')
  const failed = cardActivities(events.filter(e => e.sessionId === 'failure-session'), 1100).get('index.ts')
  assert.equal(failed?.active, false)
  assert.equal(failed?.failed, true)
  ingestActivity(registry, { cwd: root, session_id: 'failure-session', hook_event_name: 'StopFailure' }, 'claude')
  assert.equal(cardActivities(events.filter(e => e.sessionId === 'failure-session'), 1100).get('index.ts')?.active, false)
  const listing = mcpRequest(registry, { id: 2, method: 'tools/list' }) as any
  assert.equal(listing.result.tools.length, 2)
  assert.ok(listing.result.tools.every((t: any) => t.outputSchema))
  assert.equal((report as any).result.structuredContent.matched, true)

  fs.mkdirSync(path.join(root, '.codex'))
  fs.writeFileSync(path.join(root, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo existing-user-hook' }] }] } }))
  installHooks(root, 4777, 'codex'); installHooks(root, 4777, 'claude')
  assert.equal(hooksInstalled(root, 'codex'), true)
  assert.equal(hooksInstalled(root, 'claude'), true)
  const claudeHooks = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8')).hooks
  assert.ok(claudeHooks.PostToolUseFailure)
  assert.ok(claudeHooks.SessionEnd)
  const relay = fs.readFileSync(path.join(root, '.codeglass', 'codeglass-codex-relay.cjs'), 'utf8')
  assert.ok(relay.includes('provider=codex'))
  uninstallHooks(root, 'codex')
  assert.equal(hooksInstalled(root, 'codex'), false)
  assert.equal(hooksInstalled(root, 'claude'), true)
  assert.ok(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8').includes('existing-user-hook'))
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS: feature IO schemas, quick limits, legacy migration, structured scanner/schema input, activity lifecycle, MCP tools, hook preservation')
