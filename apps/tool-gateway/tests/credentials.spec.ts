import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { HttpCredentialProvider } from '../src/credentials.ts'
import { ToolGateway } from '../src/index.ts'
import type { ActionRequest, ToolContext } from '../src/index.ts'

describe('connector credential manager', () => {
  it('resolves and caches a Vault-style secret without exposing it in audit', async () => {
    let calls = 0
    const manager = createServer((request, response) => {
      calls++
      if (request.url === '/github') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ value: 'vault-github-token' }))
      } else {
        response.writeHead(404).end()
      }
    })
    await new Promise<void>((resolve, reject) => { manager.once('error', reject); manager.listen(0, '127.0.0.1', () => resolve()) })
    const address = manager.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const provider = new HttpCredentialProvider({ url: `http://127.0.0.1:${port}`, token: 'service-token' })
    expect(await provider.get('github')).toBe('vault-github-token')
    expect(await provider.get('github')).toBe('vault-github-token')
    expect(calls).toBe(1)
    expect(await provider.get('missing')).toBeUndefined()
    const seen = vi.fn(async (_request: ActionRequest, credential: string | undefined) => ({ result: { credentialPresent: credential === 'vault-github-token' } }))
    const gateway = new ToolGateway({ dbPath: ':memory:', connectors: { github: { execute: seen } }, credentialProvider: provider })
    const context: ToolContext = { tenantId: 'tenant-a', userId: 'u', operatorId: 'app:u', role: 'admin', botId: 'b', ticketId: 't' }
    const request: ActionRequest = { tenantId: 'tenant-a', botId: 'b', ticketId: 't', operatorId: 'app:u', system: 'github', actionClass: 'read', target: 'a/b', mandate: { actions: [] } }
    await gateway.propose(request, context)
    expect(seen).toHaveBeenCalledWith(request, 'vault-github-token')
    expect(JSON.stringify(gateway.auditForTicket('t'))).not.toContain('vault-github-token')
    gateway.close()
    await new Promise<void>((resolve, reject) => manager.close(error => { error === undefined ? resolve() : reject(error) }))
  })
})
