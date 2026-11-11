import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CliInfo, Provider, VisualizerSettings } from '../../shared/settings'

type Preferences = {
  settings: VisualizerSettings | null
  defaults: VisualizerSettings | null
  providers: Record<Provider, CliInfo | null>
  error: string | null
  reload: () => Promise<void>
  save: (settings: VisualizerSettings) => Promise<void>
}
const Context = createContext<Preferences | null>(null)
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<VisualizerSettings | null>(null)
  const [defaults, setDefaults] = useState<VisualizerSettings | null>(null)
  const [providers, setProviders] = useState<Preferences['providers']>({ claude: null, codex: null })
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/settings')
      if (!response.ok) throw new Error('Could not load settings')
      const data = await response.json()
      setSettings(data.settings); setDefaults(data.defaults); setProviders(data.providers); setError(null)
    } catch (error) { setError((error as Error).message) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(settings?.reduceMotion ?? false)
    const onFocus = () => { void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [settings?.reduceMotion, reload])
  const save = async (next: VisualizerSettings) => {
    const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Could not save settings')
    setSettings(data.settings)
    await reload()
  }
  return <Context.Provider value={{ settings, defaults, providers, error, reload, save }}>{children}</Context.Provider>
}
export function usePreferences() {
  const context = useContext(Context)
  if (!context) throw new Error('Preferences provider missing')
  return context
}
