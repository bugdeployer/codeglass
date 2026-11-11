// Projects opened before the rename keep state in `.cc-viz` with hooks pointing at a relay there.
// Opening them again must move the folder and rewrite only our hook entries.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hooksInstalled, migrateProjectFolder, uninstallHooks } from '../server/hooks.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeglass-migration-'))
try {
  const legacy = path.join(root, '.cc-viz')
  fs.mkdirSync(legacy)
  fs.writeFileSync(path.join(legacy, 'architecture.json'), '{"architecture":null}')
  fs.writeFileSync(path.join(legacy, 'cc-visualizer-claude-relay.cjs'), '// old relay')
  fs.mkdirSync(path.join(root, '.claude'))
  const userHook = { type: 'command', command: 'echo mine' }
  const oldHook = { type: 'command', command: `node "${path.join(legacy, 'cc-visualizer-claude-relay.cjs').replaceAll('\\', '/')}"` }
  fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { Stop: [{ hooks: [userHook, oldHook] }] } }))

  assert.equal(hooksInstalled(root, 'claude'), true, 'legacy hook entries count as installed')
  migrateProjectFolder(root, 4777)

  assert.equal(fs.existsSync(legacy), false, 'old folder is moved')
  assert.equal(fs.readFileSync(path.join(root, '.codeglass', 'architecture.json'), 'utf8'), '{"architecture":null}', 'saved map moves with it')
  assert.ok(fs.existsSync(path.join(root, '.codeglass', 'codeglass-claude-relay.cjs')), 'new relay written')
  assert.ok(!fs.existsSync(path.join(root, '.codeglass', 'cc-visualizer-claude-relay.cjs')), 'old relay removed')

  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'))
  const commands = Object.values(settings.hooks as Record<string, { hooks: { command: string }[] }[]>).flat().flatMap((e) => e.hooks.map((h) => h.command))
  assert.ok(commands.includes('echo mine'), 'user hook kept')
  assert.ok(!commands.some((c) => c.includes('cc-visualizer')), 'no hook points at the old relay')
  assert.ok(commands.some((c) => c.includes('.codeglass/codeglass-claude-relay.cjs')), 'hooks point at the new relay')
  assert.deepEqual(settings.permissions, { allow: ['Read'] }, 'other settings untouched')
  assert.equal(hooksInstalled(root, 'codex'), false, 'only providers that had hooks get them')

  migrateProjectFolder(root, 4777) // second run is a no-op
  uninstallHooks(root, 'claude')
  const after = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'))
  assert.deepEqual(Object.values(after.hooks).flat(), [{ hooks: [userHook] }], 'removal leaves only the user hook')
  console.log('PASS: legacy folder and hook migration, user hooks preserved')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
