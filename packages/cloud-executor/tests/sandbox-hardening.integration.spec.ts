import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { DockerSandboxProvider } from '../src/index.ts'

const enabled = process.env.SIRIUSX_DOCKER_TEST === '1'

describe.skipIf(!enabled)('sandbox hardening', () => {
  it('applies resource limits and does not inherit connector credentials', async () => {
    const provider = new DockerSandboxProvider({
      image: 'teams-bridge:0.2.0',
      memoryLimit: '256m',
      cpuLimit: '0.5',
      pidsLimit: 64,
    })
    process.env.GITHUB_TOKEN = 'must-not-reach-sandbox'
    const sandbox = await provider.create({ tenantId: 'tenant-hardening', workdirKey: 'hardening', network: 'none', image: 'teams-bridge:0.2.0' })
    try {
      const inspect = execFileSync('docker', ['inspect', '--format', '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}', sandbox.id], { encoding: 'utf8' }).trim()
      expect(inspect).toBe('268435456 500000000 64')
      const env = await sandbox.exec('env')
      expect(env.stdout).not.toContain('must-not-reach-sandbox')
      const net = await sandbox.exec('node -e "fetch(\'http://1.1.1.1\').then(()=>process.exit(0)).catch(()=>process.exit(7))"')
      expect(net.exitCode).not.toBe(0)
      expect(await provider.reapOrphans(0)).toBe(1)
      const gone = await sandbox.exec('true')
      expect(gone.exitCode).not.toBe(0)
    } finally {
      await sandbox.destroy()
      await provider.removeVolumes('tenant-hardening', 'hardening')
    }
  }, 120_000)
})
