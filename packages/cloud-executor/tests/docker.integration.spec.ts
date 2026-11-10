import { describe, expect, it } from 'vitest'
import { DockerSandboxProvider } from '../src/index.ts'

const enabled = process.env.SIRIUSX_DOCKER_TEST === '1'

describe.skipIf(!enabled)('docker sandbox integration', () => {
  it('isolates workdirs, persists volumes across sandbox destruction and blocks network', async () => {
    const provider = new DockerSandboxProvider({ image: 'teams-bridge:0.2.0' })
    expect(await provider.available()).toBe(true)
    const tenantId = `tenant-${Date.now()}`
    const first = await provider.create({ tenantId, workdirKey: 'one', network: 'none', image: 'teams-bridge:0.2.0' })
    const second = await provider.create({ tenantId, workdirKey: 'two', network: 'none', image: 'teams-bridge:0.2.0' })
    try {
      expect((await first.exec('printf hello > app.txt && cat app.txt')).stdout).toBe('hello')
      const other = await second.exec('cat app.txt')
      expect(other.exitCode).not.toBe(0)
      const network = await first.exec('node -e "fetch(\'http://127.0.0.1:4320/health\').then(()=>process.exit(0)).catch(()=>process.exit(7))"')
      expect(network.exitCode).toBe(7)
    } finally {
      await first.destroy()
      await second.destroy()
      const again = await provider.create({ tenantId, workdirKey: 'one', network: 'none', image: 'teams-bridge:0.2.0' })
      try {
        expect((await again.exec('cat app.txt')).stdout).toBe('hello')
      } finally {
        await again.destroy()
        await provider.removeVolumes(tenantId, 'one')
        await provider.removeVolumes(tenantId, 'two')
      }
    }
  }, 120_000)
})
