import fs from 'node:fs'
import path from 'node:path'

import { LEGACY_PROJECT_DIR, PROJECT_DIR } from './paths.ts'

const MARK = 'codeglass'
/** hooks written before the rename */
const LEGACY_MARK = 'cc-visualizer'
const ours = (command?: string) => !!command && (command.includes(MARK) || command.includes(LEGACY_MARK))
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }

export function installHooks(projectPath: string, port: number, provider: 'claude' | 'codex' = 'claude') {
  const dir = path.join(projectPath, provider === 'codex' ? '.codex' : '.claude')
  const file = path.join(dir, provider === 'codex' ? 'hooks.json' : 'settings.local.json')
  const relay = path.join(projectPath, PROJECT_DIR, `codeglass-${provider}-relay.cjs`)
  fs.mkdirSync(path.dirname(relay), { recursive: true })
  fs.writeFileSync(path.join(projectPath, PROJECT_DIR, '.gitignore'), '*\n')
  fs.writeFileSync(relay, `if (process.env.CODEGLASS_MAPPER === '1' || process.env.CC_VIZ_MAPPER === '1') process.exit(0);
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{if(body.length<2000000)body+=c});process.stdin.on('end',()=>{
// Opt-in local diagnostics only. Payloads can contain source code; never log by default.
try { const fs=require('node:fs'),path=require('node:path'),dir=__dirname,file=path.join(dir,'${provider}-hooks.jsonl');if(fs.existsSync(path.join(dir,'trace-hooks'))){if(fs.existsSync(file)&&fs.statSync(file).size>2000000)fs.writeFileSync(file,'');fs.appendFileSync(file,JSON.stringify({at:Date.now(),payload:JSON.parse(body)})+'\\n');} } catch {}
fetch('http://127.0.0.1:${port}/api/hook?src=codeglass&provider=${provider}',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(1500)}).catch(()=>{});});
`)
  const command = `node ${JSON.stringify(relay.replaceAll('\\', '/'))}`
  fs.mkdirSync(dir, { recursive: true })
  let json: any = {}
  if (fs.existsSync(file)) json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (json.hooks && (typeof json.hooks !== 'object' || Array.isArray(json.hooks))) throw new Error('Existing hook configuration is invalid')
  json.hooks ??= {}
  const events = provider === 'codex' ? [...EVENTS, 'Interrupt', 'SessionEnd'] : [...EVENTS, 'PostToolUseFailure', 'StopFailure', 'SessionEnd']
  for (const ev of events) {
    const list: HookEntry[] = json.hooks[ev] ?? []
    const cleaned = list.map((entry) => ({ ...entry, hooks: entry.hooks?.filter((hook) => !ours(hook.command)) ?? [] })).filter(entry => entry.hooks.length)
    const entry: HookEntry = { hooks: [{ type: 'command', command, timeout: ev === 'Interrupt' || ev === 'SessionEnd' ? 2 : 5 }] }
    if (ev === 'PreToolUse' || ev === 'PostToolUse' || ev === 'PostToolUseFailure') entry.matcher = '*'
    cleaned.push(entry)
    json.hooks[ev] = cleaned
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2))
  return file
}

export function uninstallHooks(projectPath: string, provider: 'claude' | 'codex' = 'claude') {
  const file = path.join(projectPath, provider === 'codex' ? '.codex' : '.claude', provider === 'codex' ? 'hooks.json' : 'settings.local.json')
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const ev of Object.keys(json.hooks ?? {})) {
      json.hooks[ev] = json.hooks[ev].map((entry: HookEntry) => ({ ...entry, hooks: entry.hooks?.filter(hook => !ours(hook.command)) ?? [] })).filter((entry: HookEntry) => entry.hooks.length)
      if (!json.hooks[ev].length) delete json.hooks[ev]
    }
    if (!Object.keys(json.hooks ?? {}).length) delete json.hooks
    fs.writeFileSync(file, JSON.stringify(json, null, 2))
  } catch {}
}

export function hooksInstalled(projectPath: string, provider: 'claude' | 'codex' = 'claude') {
  try {
    const text = fs.readFileSync(path.join(projectPath, provider === 'codex' ? '.codex' : '.claude', provider === 'codex' ? 'hooks.json' : 'settings.local.json'), 'utf8')
    return text.includes(MARK) || text.includes(LEGACY_MARK)
  } catch {
    return false
  }
}

/**
 * Projects first opened before the rename keep their map in `.cc-viz` and their hooks point at a relay there.
 * Move the folder to `.codeglass` and rewrite our hook entries to the new relay. Other hooks are left alone.
 */
export function migrateProjectFolder(projectPath: string, port: number) {
  const legacy = path.join(projectPath, LEGACY_PROJECT_DIR)
  const current = path.join(projectPath, PROJECT_DIR)
  if (!fs.existsSync(legacy) || fs.existsSync(current)) return
  const had = (['claude', 'codex'] as const).filter((p) => hooksInstalled(projectPath, p))
  try {
    fs.renameSync(legacy, current)
    for (const f of fs.readdirSync(current)) if (f.startsWith('cc-visualizer-') && f.endsWith('-relay.cjs')) fs.rmSync(path.join(current, f), { force: true })
  } catch {
    return // folder in use (an editor, a running relay): try again on the next start
  }
  for (const p of had) installHooks(projectPath, port, p)
}
