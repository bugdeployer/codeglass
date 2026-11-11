// Where Codeglass keeps its own state and finds its built UI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** `env('PORT')` reads CODEGLASS_PORT, then the pre-rename CC_VIZ_PORT / VIZ_PORT */
export function env(name: string): string | undefined {
  return process.env[`CODEGLASS_${name}`] ?? process.env[`CC_VIZ_${name}`] ?? (name === 'PORT' || name === 'HOST' ? process.env[`VIZ_${name}`] : undefined)
}

/** package root: one level above `server/` in source, two above `dist/server/` when built */
const here = import.meta.dirname
export const PACKAGE_ROOT = path.basename(path.dirname(here)) === 'dist' ? path.resolve(here, '..', '..') : path.resolve(here, '..')

/** registered projects and settings live in the user's home folder, so they survive upgrades and `npx` runs */
const custom = env('HOME')
export const DATA_DIR = custom ? path.resolve(custom) : path.join(os.homedir(), '.codeglass')

/** per-project folder holding the saved map and the hook relays (it git-ignores itself) */
export const PROJECT_DIR = '.codeglass'
/** the same folder before the rename; read once and moved */
export const LEGACY_PROJECT_DIR = '.cc-viz'

/** the built web UI (absent while developing with the Vite dev server) */
export const WEB_DIR = path.join(PACKAGE_ROOT, 'dist', 'web')

export const packageVersion = (): string => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// one-time move of state kept under the pre-release names (~/.cc-visualizer, or data/ inside a checkout)
if (!custom && !fs.existsSync(DATA_DIR)) {
  for (const old of [path.join(os.homedir(), '.cc-visualizer'), path.join(PACKAGE_ROOT, 'data')]) {
    if (!fs.existsSync(path.join(old, 'projects.json'))) continue
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      for (const f of ['projects.json', 'settings.json']) if (fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(DATA_DIR, f))
    } catch {}
    break
  }
}
