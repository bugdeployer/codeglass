// Command-line options for the `codeglass` command.
import { spawn } from 'node:child_process'
import { env, packageVersion } from './paths.ts'

export type CliOptions = { port: number; host: string; open: boolean; projects: string[] }

const HELP = `Codeglass: a live map of your codebase for Claude Code and Codex

Usage
  codeglass [project folders...] [options]

Options
  -p, --port <number>   Port to serve on (default 4777, or $CODEGLASS_PORT)
      --host <address>  Address to listen on (default 127.0.0.1: this machine only)
      --no-open         Do not open the browser
  -v, --version         Print the version
  -h, --help            Show this help

Examples
  codeglass                     Start and pick a folder in the browser
  codeglass .                   Start with the current folder open
  codeglass ../api --port 5000
`

export function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { port: Number(env('PORT') ?? 4777), host: env('HOST') ?? '127.0.0.1', open: true, projects: [] }
  const fail = (message: string): never => {
    console.error(`${message}\n\nRun codeglass --help for usage.`)
    process.exit(1)
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => argv[++i] ?? fail(`${arg} needs a value`)
    if (arg === '-h' || arg === '--help') {
      console.log(HELP)
      process.exit(0)
    } else if (arg === '-v' || arg === '--version') {
      console.log(packageVersion())
      process.exit(0)
    } else if (arg === '-p' || arg === '--port') out.port = Number(value())
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice(7))
    else if (arg === '--host') out.host = value()
    else if (arg.startsWith('--host=')) out.host = arg.slice(7)
    else if (arg === '--no-open') out.open = false
    else if (arg === '--open') out.open = true
    else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`)
    else out.projects.push(arg)
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) fail('Port must be a whole number between 1 and 65535')
  return out
}

/** open the default browser; failure is harmless (the URL is printed too) */
export function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {}
}
