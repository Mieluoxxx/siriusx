import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DockerSandboxProvider } from '../src/index.ts'

const enabled = process.env.SIRIUSX_DOCKER_TEST === '1'
const execFileAsync = promisify(execFile)
const proxyDir = join(dirname(fileURLToPath(import.meta.url)), '../../../deploy/egress-proxy')
const suffix = `${process.pid}-${Date.now()}`
const internal = `siriusx-allow-int-${suffix}`
const egress = `siriusx-allow-eg-${suffix}`
const proxyName = `siriusx-allow-proxy-${suffix}`
const targetName = `siriusx-allow-target-${suffix}`
const docker = (args: readonly string[]) => execFileAsync('docker', [...args], { timeout: 60_000 })

describe.skipIf(!enabled)('egress allowlist proxy', () => {
  it('allows only the proxy target and blocks direct egress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-allowlist-'))
    try {
      await writeFile(join(root, 'target.mjs'), `import http from 'node:http'\nhttp.createServer((_req, res) => res.end('allowed-target\\n')).listen(9100, '0.0.0.0')\n`)
      await docker(['network', 'create', '--internal', internal])
      await docker(['network', 'create', egress])
      await docker(['run', '-d', '--name', targetName, '--network', egress, '-v', `${join(root, 'target.mjs')}:/target.mjs:ro`, 'teams-bridge:0.2.0', 'node', '/target.mjs'])
      await docker(['run', '-d', '--name', proxyName, '--network', internal, '-e', 'PORT=3128', '-e', `ALLOWED_HOSTS=${targetName}`, '-v', `${proxyDir}:/proxy:ro`, 'teams-bridge:0.2.0', 'node', '/proxy/server.mjs'])
      await docker(['network', 'connect', egress, proxyName])
      await new Promise(resolve => setTimeout(resolve, 800))
      const provider = new DockerSandboxProvider({
        image: 'arena-sandbox:oc-1.18.15-py',
        allowlistNetwork: internal,
        proxyUrl: `http://${proxyName}:3128`,
      })
      const sandbox = await provider.create({ tenantId: 'tenant-allow', workdirKey: 'allow', network: 'allowlist', image: 'arena-sandbox:oc-1.18.15-py' })
      try {
        const allowed = await sandbox.exec(`curl -sS http://${targetName}:9100/`)
        expect(allowed.exitCode).toBe(0)
        expect(allowed.stdout.trim()).toBe('allowed-target')
        const denied = await sandbox.exec('curl -sS http://1.1.1.1/')
        expect(denied.stdout).toContain('not allowed')
        const direct = await sandbox.exec('curl -sS --noproxy "*" http://1.1.1.1/')
        expect(direct.exitCode).not.toBe(0)
      } finally {
        await sandbox.destroy()
        await provider.removeVolumes('tenant-allow', 'allow')
      }
    } finally {
      await docker(['rm', '-f', proxyName, targetName]).catch(() => undefined)
      await docker(['network', 'rm', internal, egress]).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
