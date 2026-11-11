import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
const root = await mkdtemp(join(tmpdir(), 'siriusx-feed-root-'))
const outside = await mkdtemp(join(tmpdir(), 'siriusx-feed-outside-'))
await mkdir(join(root, 'stable'), { recursive: true })
await writeFile(join(root, 'stable', 'latest.yml'), 'version: 1.0.0\n')
await writeFile(join(outside, 'secret.txt'), 'outside-secret')
await symlink(outside, join(root, 'leak'))
const port = 18090
const child = spawn(process.execPath, ['deploy/release/update-feed/server.mjs'], { cwd: '/root/siriusx', env: { ...process.env, ROOT: root, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
const ready = async () => { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return } catch {} await new Promise(r => setTimeout(r, 50)) } throw new Error('feed not ready') }
try {
  await ready()
  const normal = await fetch(`http://127.0.0.1:${port}/stable/latest.yml`)
  const traversal = await fetch(`http://127.0.0.1:${port}/leak/secret.txt`)
  const encoded = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`)
  const result = { normal: normal.status, traversal: traversal.status, encoded: encoded.status }
  console.log(JSON.stringify(result, null, 2))
  if (result.normal !== 200 || result.traversal !== 403 || ![403, 404].includes(result.encoded)) process.exitCode = 1
} finally { child.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
