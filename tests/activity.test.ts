import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Registry, Project, type StreamMessage } from '../server/projects.ts'
import { ingestActivity } from '../server/activity.ts'
import { cardActivities, activityLabel, mergeActivityEvents } from '../src/lib/activity.ts'
import { Model } from '../src/lib/model.ts'
import type { Analysis, Architecture } from '../src/lib/types.ts'
import { installHooks, uninstallHooks } from '../server/hooks.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-viz-activity-'))
const messages: StreamMessage[] = []
const registry = new Registry()
const makeProject = (name: string) => {
  const dir = path.join(root, name); fs.mkdirSync(dir)
  const p = new Project({ id: name, name, path: dir, addedAt: 0 }, m => messages.push(m))
  registry.projects.set(name, p); return p
}
const a = makeProject('chat'), b = makeProject('edited')
const file = path.join(b.meta.path, 'index.js')
fs.writeFileSync(file, '// original')
// Shapes captured from real local Codex and Claude CLI hooks; identifiers/content sanitized.
const codex = { cwd: a.meta.path, session_id: 'codex-real-shape', tool_use_id: 'exec-patch', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-old\n+new\n*** End Patch` } }
const claude = { cwd: a.meta.path, session_id: 'claude-real-shape', tool_use_id: 'toolu-edit', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: 'old', new_string: 'new', replace_all: false } }
try {
  for (const [provider, payload] of [['codex', codex], ['claude', claude]] as const) {
    ingestActivity(registry, payload, provider)
    assert.equal(a.history.length, 0, 'cross-project file belongs only to target project')
    assert.equal(cardActivities(b.history).get('index.js')?.action, 'editing')
    assert.equal(cardActivities(b.history).get('index.js')?.active, true)
    assert.ok(messages.some(m => m.type === 'activity' && m.projectId === 'edited' && m.ev.path === 'index.js'), 'real Project.push emits correct SSE message')
    ingestActivity(registry, { ...payload, hook_event_name: 'PostToolUse', tool_input: {}, tool_response: { exit_code: 0 } }, provider)
    assert.equal(cardActivities(b.history).get('index.js')?.active, false, 'pathless completion correlates with pre')
    ingestActivity(registry, { cwd: a.meta.path, session_id: payload.session_id, hook_event_name: 'Stop' }, provider)
    assert.equal(cardActivities(b.history).get('index.js')?.active, false, 'completion briefly survives stop without stale active label')
    assert.equal(cardActivities(b.history, Date.now() + 13_000).size, 0)
    a.history = []; b.history = []; messages.length = 0
  }
  for (const code of [
    'await tools.apply_patch(' + JSON.stringify(codex.tool_input.command) + ')',
    'await tools.apply_patch(`' + codex.tool_input.command.replaceAll('\\', '\\\\') + '`)',
    "await tools.apply_patch('" + codex.tool_input.command.replaceAll('\\', '\\\\').replaceAll('\n', '\\n') + "')",
  ]) {
    ingestActivity(registry, { ...codex, tool_name: 'functions.exec', tool_input: { code } }, 'codex')
    assert.equal(b.history.at(-1)?.path, 'index.js')
    ingestActivity(registry, { ...codex, hook_event_name: 'Interrupt', tool_input: {} }, 'codex')
    assert.equal(cardActivities(b.history).size, 0)
  }
  const creation = { ...codex, tool_use_id: 'create', tool_input: { command: `*** Begin Patch\n*** Add File: ${path.join(b.meta.path, 'new.js')}\n+hello\n*** End Patch` } }
  ingestActivity(registry, creation, 'codex')
  assert.equal(activityLabel(cardActivities(b.history).get('new.js')!), 'building')
  assert.equal(cardActivities(b.history, Date.now() + 121_000).size, 0)
  ingestActivity(registry, { ...creation, hook_event_name: 'PostToolUseFailure', tool_input: {} }, 'codex')
  assert.equal(cardActivities(b.history).get('new.js')?.failed, true)
  assert.equal(cardActivities(b.history).get('new.js')?.active, false)
  for (const event of ['StopFailure', 'SessionEnd']) {
    ingestActivity(registry, { ...claude, tool_use_id: event }, 'claude')
    ingestActivity(registry, { cwd: root, session_id: claude.session_id, hook_event_name: event }, 'claude')
    assert.ok([...cardActivities(b.history).values()].every(x => !x.active))
  }
  b.history = []
  const write = { ...claude, tool_name: 'Write', tool_input: { file_path: path.join(b.meta.path, 'created.js'), content: 'hello' } }
  ingestActivity(registry, write, 'claude')
  assert.equal(b.history.at(-1)?.action, 'building')
  fs.writeFileSync(write.tool_input.file_path, 'hello')
  ingestActivity(registry, { ...write, hook_event_name: 'PostToolUse' }, 'claude')
  assert.equal(b.history.at(-1)?.action, 'building', 'post keeps pre creation classification')
  ingestActivity(registry, { ...write, tool_use_id: 'overwrite' }, 'claude')
  assert.equal(b.history.at(-1)?.action, 'editing', 'Write can update an existing file')
  b.history = []
  b.push({ source: 'fs', kind: 'change', path: 'index.js' })
  ingestActivity(registry, { ...codex, tool_name: 'Bash', tool_input: { command: 'echo hello' } }, 'codex')
  ingestActivity(registry, { ...codex, tool_name: 'Read', tool_input: { command: codex.tool_input.command } }, 'codex')
  assert.equal(cardActivities(b.history).size, 0, 'filesystem and generic/read calls never infer agent edits')
  ingestActivity(registry, { ...codex, cwd: root }, 'codex')
  assert.equal(b.history.at(-1)?.path, 'index.js', 'absolute file works even with unregistered cwd')
  const config = path.join(a.meta.path, '.claude', 'settings.local.json')
  fs.mkdirSync(path.dirname(config)); fs.writeFileSync(config, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }] } }))
  installHooks(a.meta.path, 4777, 'claude'); installHooks(a.meta.path, 4777, 'claude'); uninstallHooks(a.meta.path, 'claude')
  assert.ok(fs.readFileSync(config, 'utf8').includes('echo user-hook'))
  const sample = { id: 1, ts: 1000, source: 'codex' as const, kind: 'apply_patch', phase: 'pre' as const, path: 'index.js', action: 'editing' as const, callId: 'one', sessionId: 'one' }
  const post = { ...sample, id: 2, ts: 1001, phase: 'post' as const }
  assert.equal(cardActivities(mergeActivityEvents([sample], [sample, post]), 1002).get('index.js')?.active, false, 'reconnect history fills a missed post without duplicate pre')
  const arch = { systems: [{ id: 'notes', paths: ['server/notes'], modules: [{ id: 'store', paths: ['server/notes/store'] }], packages: [] }], dataDomains: [] } as unknown as Architecture
  const model = new Model({ files: [], schema: { tables: [] } } as unknown as Analysis, arch, {})
  assert.equal(model.keyForFile('server/notes/new.js', {}), 'notes', 'pre-scan creation uses explicit feature folder ownership')
  assert.equal(model.keyForFile('server/notes/store/new.js', { system: 'notes' }), 'notes/store')
  assert.equal(model.keyForFile('server/notebook/new.js', {}), null, 'no prefix collision or guessed ownership')
  console.log('PASS: captured payload shapes, cross-project routing/SSE, wrapper literals, creation/update, lifecycle/expiry, no filesystem attribution, user hook preservation')
} finally { await a.stop(); await b.stop(); fs.rmSync(root, { recursive: true, force: true }) }
