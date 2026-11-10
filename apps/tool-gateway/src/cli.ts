#!/usr/bin/env node
/** Run the tool gateway with a demo GitHub/GitLab connector that never performs a real external write. */
import { startToolGatewayServer } from './server.ts'
import { GitHubConnector } from './github.ts'
import { HttpCredentialProvider, StaticCredentialProvider } from './credentials.ts'

const port = process.env.SIRIUSX_TOOL_GATEWAY_PORT === undefined ? 4330 : Number(process.env.SIRIUSX_TOOL_GATEWAY_PORT)
const db = process.env.SIRIUSX_TOOL_GATEWAY_DB ?? '/tmp/siriusx-tool-gateway.sqlite'
const host = process.env.SIRIUSX_TOOL_GATEWAY_HOST ?? '127.0.0.1'
const server = await startToolGatewayServer({
  dbPath: db,
  port,
  host,
  ...(process.env.SIRIUSX_CREDENTIAL_URL === undefined
    ? { credentials: { github: process.env.GITHUB_TOKEN ?? 'not-configured', gitlab: process.env.GITLAB_TOKEN ?? 'not-configured' } }
    : { credentialProvider: new HttpCredentialProvider({ url: process.env.SIRIUSX_CREDENTIAL_URL, token: process.env.SIRIUSX_CREDENTIAL_TOKEN ?? '' }) }),
  connectors: {
    github: process.env.SIRIUSX_GITHUB_REAL === '1'
      ? new GitHubConnector(process.env.SIRIUSX_GITHUB_API_BASE === undefined ? {} : { apiBase: process.env.SIRIUSX_GITHUB_API_BASE })
      : { execute: async (request, credential) => ({ result: { system: 'github', action: request.actionClass, target: request.target, credentialPresent: credential !== undefined && credential !== 'not-configured' } }) },
    gitlab: { execute: async (request, credential) => ({ result: { system: 'gitlab', action: request.actionClass, target: request.target, credentialPresent: credential !== undefined && credential !== 'not-configured' } }) },
  },
})
console.log(JSON.stringify({ ready: true, url: server.url }, undefined, 2))
const stop = async (): Promise<void> => { await server.close(); process.exit(0) }
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
await new Promise<void>(() => {})
