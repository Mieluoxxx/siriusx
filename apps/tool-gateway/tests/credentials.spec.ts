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
    expect(JSON.stringify(await gateway.auditForTicket('t'))).not.toContain('vault-github-token')
    gateway.close()
    await new Promise<void>((resolve, reject) => manager.close(error => { error === undefined ? resolve() : reject(error) }))
  })
  it('reads Vault KV v2 data.data.value and caches it', async () => {
    const manager = createServer((request, response) => {
      if (request.url === '/v1/secret/data/github') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { data: { value: 'kv2-token' } } }))
      } else {
        response.writeHead(404).end()
      }
    })
    await new Promise<void>((resolve, reject) => { manager.once('error', reject); manager.listen(0, '127.0.0.1', () => resolve()) })
    const address = manager.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const provider = new HttpCredentialProvider({ url: `http://127.0.0.1:${port}/v1/secret/data`, token: 'service-token' })
    try {
      expect(await provider.get('github')).toBe('kv2-token')
      expect(await provider.get('github')).toBe('kv2-token')
    } finally {
      await new Promise<void>((resolve, reject) => manager.close(error => { error === undefined ? resolve() : reject(error) }))
    }
  })

  it('refreshes a rotating credential after its cache TTL', async () => {
    let calls = 0
    const manager = createServer((request, response) => {
      calls++
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ value: `token-${calls}` }))
    })
    await new Promise<void>((resolve, reject) => { manager.once('error', reject); manager.listen(0, '127.0.0.1', () => resolve()) })
    const address = manager.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const provider = new HttpCredentialProvider({ url: `http://127.0.0.1:${port}`, token: 'service-token', cacheTtlMs: 5 })
    try {
      expect(await provider.get('github')).toBe('token-1')
      await new Promise(resolve => setTimeout(resolve, 15))
      expect(await provider.get('github')).toBe('token-2')
      expect(calls).toBe(2)
    } finally {
      await new Promise<void>((resolve, reject) => manager.close(error => { error === undefined ? resolve() : reject(error) }))
    }
  })

  it('fails closed when the credential manager returns an error', async () => {
    const manager = createServer((_request, response) => { response.writeHead(500).end('down') })
    await new Promise<void>((resolve, reject) => { manager.once('error', reject); manager.listen(0, '127.0.0.1', () => resolve()) })
    const address = manager.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const provider = new HttpCredentialProvider({ url: `http://127.0.0.1:${port}`, token: 'service-token' })
    try {
      await expect(provider.get('github')).rejects.toThrow('HTTP 500')
    } finally {
      await new Promise<void>((resolve, reject) => manager.close(error => { error === undefined ? resolve() : reject(error) }))
    }
  })

})
