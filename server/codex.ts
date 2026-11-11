import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import type { CliInfo } from '../shared/settings.ts'

const cache = new Map<string, { at: number; cli: CliInfo | null }>()
export async function findCodex(override = ''): Promise<CliInfo | null> {
  const cached = cache.get(override)
  if (cached && Date.now() - cached.at < 30_000) return cached.cli
  const candidates: string[] = override ? [override] : []
  if (!override && process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    try {
      const bins = fs.readdirSync(base).map((dir) => path.join(base, dir, 'codex.exe')).filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      candidates.push(...bins)
    } catch {}
  }
  if (!override) candidates.push(process.platform === 'win32' ? 'codex.exe' : 'codex')
  for (const bin of candidates) {
    const version = await new Promise<string | null>((resolve) => execFile(bin, ['--version'], { timeout: 5000, windowsHide: true }, (error, out) => resolve(error ? null : String(out).trim())))
    if (version && /codex/i.test(version)) {
      const cli = { path: bin, version }
      cache.set(override, { at: Date.now(), cli })
      return cli
    }
  }
  cache.set(override, { at: Date.now(), cli: null })
  return null
}

// Codex structured output requires every property to be required and disallows extra properties.
export function strictSchema(value: any): any {
  if (Array.isArray(value)) return value.map(strictSchema)
  if (!value || typeof value !== 'object') return value
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strictSchema(v)]))
  if (out.type === 'object') {
    out.additionalProperties = false
    out.required = Object.keys(out.properties ?? {})
  }
  return out
}

export async function runCodex(options: {
  cli: CliInfo; root: string; model: string; prompt: string; schema: object; timeout: number; maxTools: number; allowTools?: boolean
  onProgress: (message: string) => void
  onChild: (child: ReturnType<typeof spawn> | undefined) => void
  isCancelled: () => boolean
}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeglass-codex-'))
  try {
    const schema = path.join(temp, 'schema.json')
    const output = path.join(temp, 'result.json')
    fs.writeFileSync(schema, JSON.stringify(strictSchema(options.schema)))
    const args = ['-a', 'never', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never', '-c', 'model_reasoning_effort="low"', ...(options.allowTools === false ? ['--disable', 'shell_tool', '--disable', 'unified_exec'] : []), '--output-schema', schema, '--output-last-message', output, ...(options.model ? ['--model', options.model] : []), '-']
    options.onProgress(options.allowTools === false ? 'Analyzing scanned source · building architecture' : 'Reading project files')
    let usage: Record<string, number> = {}
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.cli.path, args, { cwd: options.root, windowsHide: true, env: { ...process.env, CODEGLASS_MAPPER: '1', CC_VIZ_MAPPER: '1' } })
      options.onChild(child)
      let buffer = '', errorText = '', failure = '', tools = 0
      const stop = (reason: string) => { failure ||= reason; child.kill() }
      const timer = setTimeout(() => stop(`Codex exceeded the ${options.timeout}s time limit`), options.timeout * 1000)
      const parse = (line: string) => {
        let event: any
        try { event = JSON.parse(line) } catch { return }
        if (event.type === 'turn.completed') usage = event.usage ?? {}
        if (event.type === 'turn.failed' || event.type === 'error') failure = event.error?.message ?? event.message ?? 'Codex mapping failed'
        const item = event.item
        if (event.type === 'item.started' && item?.type === 'command_execution') {
          if (++tools > options.maxTools) return stop(`Codex exceeded the ${options.maxTools} tool call limit`)
          options.onProgress(String(item.command ?? 'Reading project files').slice(0, 220))
        }
      }
      child.stdout.on('data', (data) => {
        buffer += data
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) { parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
      })
      child.stderr.on('data', (data) => { errorText = (errorText + data).slice(-4000) })
      child.stdin.on('error', () => {})
      child.once('error', (error) => { clearTimeout(timer); options.onChild(undefined); reject(error) })
      child.once('close', (code) => {
        clearTimeout(timer)
        options.onChild(undefined)
        if (buffer.trim()) parse(buffer)
        if (options.isCancelled()) return reject(new Error('Mapping cancelled'))
        if (failure || code !== 0) return reject(new Error(failure || errorText.trim().slice(-600) || `Codex exited with code ${code}`))
        resolve()
      })
      child.stdin.end(options.prompt)
    })
    return { structured_output: JSON.parse(fs.readFileSync(output, 'utf8')), usage, total_cost_usd: undefined }
  } finally {
    // Only this run's directory, created directly under the system temp directory.
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
