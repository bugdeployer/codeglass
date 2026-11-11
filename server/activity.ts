import path from 'node:path'
import fs from 'node:fs'
import { parse } from '@babel/parser'
import { ACTIVITY_ACTIONS, type ActivityAction } from '../shared/contracts.ts'
import type { Registry, ActivityEvent } from './projects.ts'

const pending = new WeakMap<Registry, Map<string, { project: ReturnType<Registry['owner']>; path: string; action: ActivityAction; at: number }[]>>()

// Parse literals only, never evaluate hook-supplied JavaScript. This also supports
// single quotes and static template literals in functions.exec wrappers.
export function patchTexts(text: string) {
  const result = [text]
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && (node.callee?.name === 'apply_patch' || node.callee?.property?.name === 'apply_patch')) {
      const arg = node.arguments[0]
      if (arg?.type === 'StringLiteral') result.push(arg.value)
      if (arg?.type === 'TemplateLiteral' && !arg.expressions.length) result.push(arg.quasis[0].value.cooked ?? '')
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'loc' && key !== 'tokens' && key !== 'comments') {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  try { visit(parse(text, { sourceType: 'module', allowAwaitOutsideFunction: true, errorRecovery: true })) } catch {}
  return result
}

export function ingestActivity(registry: Registry, body: any, provider: 'claude' | 'codex') {
  const cwd = typeof body.cwd === 'string' ? body.cwd : ''
  const project = cwd ? registry.owner(cwd) : undefined
  if (project?.mapper.ownsSession(body.session_id ?? body.sessionId)) return { ok: true, matched: false }
  let input = body.tool_input ?? {}
  if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = { patch: input } } }
  if (!input || typeof input !== 'object') input = {}
  const tool = String(body.tool_name ?? body.kind ?? 'tool')
  const event = body.hook_event_name ?? (body.phase === 'post' ? 'PostToolUse' : 'PreToolUse')
  const base = { source: provider, sessionId: String(body.session_id ?? body.sessionId ?? 'unknown'), callId: String(body.tool_use_id ?? body.call_id ?? body.callId ?? tool) }
  let calls = pending.get(registry)
  if (!calls) pending.set(registry, calls = new Map())
  for (const [key, files] of calls) if (files.every(f => Date.now() - f.at > 120_000)) calls.delete(key)
  const sessionKey = `${provider}:${base.sessionId}:`, callKey = sessionKey + base.callId
  if (['Stop', 'StopFailure', 'Interrupt', 'SessionEnd'].includes(event)) {
    const targets = new Set(project ? [project] : [])
    for (const [key, files] of calls) if (key.startsWith(sessionKey)) { for (const f of files) if(f.project) targets.add(f.project); calls.delete(key) }
    // Sessions can edit several registered projects outside their cwd.
    for (const p of registry.projects?.values() ?? []) if (p.history.some(e => e.source === provider && e.sessionId === base.sessionId)) targets.add(p)
    for (const p of targets) p.push({ ...base, kind: 'stop' })
    return { ok: true, matched: targets.size > 0 }
  }
  if (!['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event)) { project?.push({ ...base, kind: event === 'SessionStart' ? 'session' : 'prompt' }); return { ok: true, matched: !!project } }
  const explicit = body.action ?? input.activity
  const fallback: ActivityAction = /refactor/i.test(tool) ? 'refactoring' : /edit|patch/i.test(tool) ? 'editing' : /write|create/i.test(tool) ? 'building' : /read|grep|glob|search/i.test(tool) ? 'reading' : 'working'
  const action: ActivityAction = ACTIVITY_ACTIONS.includes(explicit) ? explicit : fallback
  const paths = new Map<string, ActivityAction>()
  const direct = body.path ?? input.file_path ?? input.path ?? input.notebook_path
  if (typeof direct === 'string') {
    const absolute = path.isAbsolute(direct) ? direct : cwd ? path.resolve(cwd, direct) : ''
    paths.set(direct, /^(?:Write|create_file)$/i.test(tool) && absolute && fs.existsSync(absolute) ? 'editing' : action)
  }
  const patch = String(input.patch ?? input.command ?? input.cmd ?? input.code ?? input.input ?? '')
  // Code-mode wrappers may carry a JSON-quoted apply_patch argument. Decode the
  // literal only; never execute the wrapper or any code received from a hook.
  // Only patch tools or wrappers containing an actual apply_patch call count.
  const texts = patchTexts(patch)
  for (const text of /apply_patch|patch/i.test(tool) ? texts : texts.slice(1)) for (const match of text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)\r?$/gm)) paths.set(match[2].trim(), match[1] === 'Add' ? 'building' : match[1] === 'Delete' ? 'deleting' : 'editing')
  const files = [...paths].flatMap(([file, operation]) => {
    if (!path.isAbsolute(file) && !cwd) return []
    const abs = path.resolve(typeof input.workdir === 'string' ? input.workdir : cwd, file)
    const owner = registry.owner(abs)
    // Registry.owner is authoritative; cwd ownership is never used for foreign files.
    const target = owner
    const relative = target ? path.relative(target.meta.path, abs).split(path.sep).join('/') : ''
    const canonical = process.platform === 'win32' ? target?.analysis?.files.find(f => f.path.toLowerCase() === relative.toLowerCase())?.path ?? relative : relative
    return target && !target.mapper.ownsSession(base.sessionId) ? [{ project: target, path: canonical, action: operation, at: Date.now() }] : []
  })
  const remembered = calls.get(callKey)
  const affected = event === 'PreToolUse' ? files : remembered ?? files
  if (event === 'PreToolUse' && files.length) calls.set(callKey, files)
  else if (event !== 'PreToolUse') calls.delete(callKey)
  const push = (target: NonNullable<typeof project>, rel?: string, operation = action) => {
    const response = body.tool_response
    const failed = event === 'PostToolUseFailure' || body.error != null || response?.isError === true || response?.is_error === true || (typeof response?.exit_code === 'number' && response.exit_code !== 0) || (typeof response === 'string' && /^(?:Error:|Failed to|apply_patch verification failed|Exit code:\s*[1-9]\d*)/m.test(response))
    const activity: Omit<ActivityEvent, 'id' | 'ts'> = { ...base, kind: tool, phase: event === 'PreToolUse' ? 'pre' : 'post', failed, path: rel, action: operation, detail: typeof body.detail === 'string' ? body.detail.slice(0, 200) : undefined }
    target.push(activity)
  }
  for (const file of affected) if(file.project) push(file.project, file.path, file.action)
  if (!paths.size && !affected.length && project) push(project)
  return { ok: true, matched: !!affected.length || (!paths.size && !!project) }
}
