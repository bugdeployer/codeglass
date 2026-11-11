// Runs every *.test.ts file in this folder, one process each, and fails if any of them fails.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dir = import.meta.dirname
const only = process.argv.slice(2)
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts') && (!only.length || only.some((o) => f.startsWith(o))))
let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(dir, f)], { stdio: 'inherit' })
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}`)
  if (r.status !== 0) failed++
}
if (failed) {
  console.error(`\n${failed} of ${files.length} test files failed`)
  process.exit(1)
}
console.log(`\n${files.length} test files passed`)
