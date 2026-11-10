#!/usr/bin/env node
/** Run the tool gateway with a demo GitHub/GitLab connector that never performs a real external write. */
import { startToolGatewayServer } from './server.ts'

const port = process.env.SIRIUSX_TOOL_GATEWAY_PORT === undefined ? 4330 : Number(process.env.SIRIUSX_TOOL_GATEWAY_PORT)
const db = process.env.SIRIUSX_TOOL_GATEWAY_DB ?? '/tmp/siriusx-tool-gateway.sqlite'
const server = await startToolGatewayServer({
  dbPath: db,
  port,
  credentials: {
    github: process.env.GITHUB_TOKEN ?? 'not-configured',
    gitlab: process.env.GITLAB_TOKEN ?? 'not-configured',
  },
  connectors: {
    github: { execute: async (request, credential) => ({ result: { system: 'github', action: request.actionClass, target: request.target, credentialPresent: credential !== undefined && credential !== 'not-configured' } }) },
    gitlab: { execute: async (request, credential) => ({ result: { system: 'gitlab', action: request.actionClass, target: request.target, credentialPresent: credential !== undefined && credential !== 'not-configured' } }) },
  },
})
console.log(JSON.stringify({ ready: true, url: server.url }, undefined, 2))
const stop = async (): Promise<void> => { await server.close(); process.exit(0) }
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
await new Promise<void>(() => {})
