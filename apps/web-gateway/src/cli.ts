#!/usr/bin/env node
import { startWebGateway } from './index.ts'

const args = process.argv.slice(2)
const flags = new Map<string, string>()
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]
  const value = args[index + 1]
  if (key === undefined || value === undefined || !key.startsWith('--')) {
    console.error('usage: web-gateway --control-plane http://127.0.0.1:4320 --dsh-web http://127.0.0.1:PORT/?token=... [--port 8080]')
    process.exit(2)
  }
  flags.set(key.slice(2), value)
}
const controlPlaneUrl = flags.get('control-plane')
const dshWebUrl = flags.get('dsh-web')
if (controlPlaneUrl === undefined || dshWebUrl === undefined) {
  console.error('control-plane and dsh-web are required')
  process.exit(2)
}
const oidcIssuer = process.env.SIRIUSX_OIDC_ISSUER
const oidcClientId = process.env.SIRIUSX_OIDC_CLIENT_ID
const oidcClientSecret = process.env.SIRIUSX_OIDC_CLIENT_SECRET
const oidcRedirectUri = process.env.SIRIUSX_OIDC_REDIRECT_URI
const oidcTenant = process.env.SIRIUSX_OIDC_TENANT_ID
const oidc = oidcIssuer === undefined || oidcClientId === undefined || oidcClientSecret === undefined || oidcRedirectUri === undefined || oidcTenant === undefined ? undefined : {
  issuer: oidcIssuer, clientId: oidcClientId, clientSecret: oidcClientSecret, redirectUri: oidcRedirectUri, tenantId: oidcTenant,
  ...(process.env.SIRIUSX_OIDC_ROLE === 'admin' ? { role: 'admin' as const } : {}),
  ...(process.env.SIRIUSX_OIDC_ID_TOKEN_ALG === 'HS256' ? { idTokenAlg: 'HS256' as const } : {}),
}
const gateway = await startWebGateway({
  controlPlaneUrl, dshWebUrl,
  port: flags.get('port') === undefined ? 8080 : Number(flags.get('port')),
  host: flags.get('host') ?? process.env.SIRIUSX_WEB_HOST ?? '127.0.0.1',
  ...(process.env.SIRIUSX_SSO_SERVICE_TOKEN === undefined ? {} : { controlPlaneServiceToken: process.env.SIRIUSX_SSO_SERVICE_TOKEN }),
  ...(process.env.SIRIUSX_WEB_TRUST_PROXY === '1' ? { trustProxy: true } : {}),
  ...(oidc === undefined ? {} : { oidc }),
})
console.log(JSON.stringify({ ready: true, url: gateway.url }, undefined, 2))
const stop = async (): Promise<void> => { await gateway.close(); process.exit(0) }
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
await new Promise<void>(() => {})
