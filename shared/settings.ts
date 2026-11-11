export type Provider = 'claude' | 'codex'
export type VisualizerSettings = {
  provider: Provider
  claude: { fullModel: string; updateModel: string; fullBudget: number; updateBudget: number; cliPath: string; detail: 'quick' | 'detailed' }
  codex: { fullModel: string; updateModel: string; cliPath: string; detail: 'quick' | 'detailed' }
  fullTimeout: number
  updateTimeout: number
  maxToolCalls: number
  liveDelay: number
  showLegends: boolean
  reduceMotion: boolean
  sidebarWidth: number
}
export type CliInfo = { path: string; version: string }
export const providerName = (provider: Provider) => provider === 'codex' ? 'Codex' : 'Claude'
