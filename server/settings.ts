import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, env } from './paths.ts'
import type { VisualizerSettings } from '../shared/settings.ts'

const file = path.join(DATA_DIR, 'settings.json')
export const defaults: VisualizerSettings = {
  provider: env('PROVIDER') === 'codex' ? 'codex' : 'claude',
  claude: {
    fullModel: env('FULL_MODEL') ?? 'sonnet',
    updateModel: env('UPDATE_MODEL') ?? 'sonnet',
    fullBudget: Number(env('FULL_BUDGET') ?? 1.5),
    updateBudget: Number(env('UPDATE_BUDGET') ?? 0.25),
    cliPath: env('CLAUDE') ?? '',
    detail: 'quick',
  },
  codex: { fullModel: env('CODEX_MODEL') ?? '', updateModel: env('CODEX_UPDATE_MODEL') ?? '', cliPath: env('CODEX') ?? '', detail: 'quick' },
  fullTimeout: Number(env('FULL_TIMEOUT') ?? 240),
  updateTimeout: Number(env('UPDATE_TIMEOUT') ?? 90),
  maxToolCalls: Number(env('MAX_TOOL_CALLS') ?? 45),
  liveDelay: 15,
  showLegends: true,
  reduceMotion: false,
  sidebarWidth: 256,
}

export function validateSettings(input: unknown): VisualizerSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings')
  const s = input as Record<string, any>
  if (!['claude', 'codex'].includes(s.provider)) throw new Error('Choose Claude or Codex')
  const number = (v: unknown, min: number, max: number, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be between ${min} and ${max}`)
    return v
  }
  const string = (v: unknown, name: string) => {
    if (typeof v !== 'string' || v.length > 1024 || /[\r\n\0]/.test(v)) throw new Error(`Invalid ${name}`)
    return v.trim()
  }
  const boolean = (v: unknown) => { if (typeof v !== 'boolean') throw new Error('Invalid display setting'); return v }
  if (!s.claude || !s.codex) throw new Error('Missing provider settings')
  for (const provider of ['claude', 'codex']) if (s[provider].detail !== undefined && !['quick', 'detailed'].includes(s[provider].detail)) throw new Error('Choose quick or detailed mapping')
  const claude = { detail: s.claude.detail ?? 'quick', fullModel: string(s.claude.fullModel, 'Claude model'), updateModel: string(s.claude.updateModel, 'Claude update model'), cliPath: string(s.claude.cliPath, 'Claude CLI path'), fullBudget: number(s.claude.fullBudget, 0.01, 100, 'Full budget'), updateBudget: number(s.claude.updateBudget, 0.01, 100, 'Update budget') }
  if (!claude.fullModel || !claude.updateModel) throw new Error('Claude models are required')
  return {
    provider: s.provider, claude,
    codex: { fullModel: string(s.codex.fullModel, 'Codex model'), updateModel: string(s.codex.updateModel, 'Codex update model'), cliPath: string(s.codex.cliPath, 'Codex CLI path'), detail: s.codex.detail ?? 'quick' },
    fullTimeout: number(s.fullTimeout, 15, 3600, 'Full timeout'), updateTimeout: number(s.updateTimeout, 15, 3600, 'Update timeout'),
    maxToolCalls: number(s.maxToolCalls, 1, 500, 'Tool limit'), liveDelay: number(s.liveDelay, 3, 300, 'Live delay'),
    sidebarWidth: number(s.sidebarWidth, 200, 360, 'Sidebar width'), showLegends: boolean(s.showLegends), reduceMotion: boolean(s.reduceMotion),
  }
}
let current = structuredClone(defaults)
try { current = validateSettings(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch {}
export const getSettings = () => structuredClone(current)
export function saveSettings(input: unknown) {
  const next = validateSettings(input)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2))
  fs.renameSync(file + '.tmp', file)
  current = next
  return getSettings()
}
