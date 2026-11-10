#!/usr/bin/env node
/** Control-plane provisioning CLI and single-box server launcher. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ControlPlane } from './index.ts'
import { startControlPlaneServer } from './server.ts'
import { startModelGateway } from './model-gateway.ts'

function usage(): never {
  console.error(`usage:
  control-plane tenant create --name <name> --issuer <url> --admin-email <email> [--tenant-id <id>]
  control-plane tenant list
  control-plane user add --tenant <id> --email <email> [--role admin|member]
  control-plane token issue --tenant <id> --user <id> --role admin|member
  control-plane serve [--port 4320] [--db <file>] [--data-dir <dir>]`)
  process.exit(2)
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!
    if (!key.startsWith('--')) usage()
    const value = args[++index]
    if (value === undefined) usage()
    flags.set(key.slice(2), value)
  }
  return flags
}

const [command, subcommand, ...tail] = process.argv.slice(2)
const rest = command === 'serve' ? [subcommand, ...tail].filter((value): value is string => value !== undefined) : tail
const flags = parseFlags(rest)
const dbPath = flags.get('db') ?? process.env.SIRIUSX_DB ?? '/tmp/siriusx-control.sqlite'
const dataDir = flags.get('data-dir') ?? process.env.SIRIUSX_DATA_DIR ?? '/tmp/siriusx-data'
mkdirSync(dataDir, { recursive: true })
const control = new ControlPlane({
  dbPath,
  dataDir,
  ...(process.env.SIRIUSX_SESSION_SECRET === undefined ? {} : { sessionSecret: process.env.SIRIUSX_SESSION_SECRET }),
})

try {
  if (command === 'tenant' && subcommand === 'create') {
    const name = flags.get('name')
    const issuer = flags.get('issuer')
    const adminEmail = flags.get('admin-email')
    if (name === undefined || issuer === undefined || adminEmail === undefined) usage()
    const tenantId = flags.get('tenant-id')
    const tenant = control.provisionTenant(tenantId === undefined
      ? { name, idpIssuer: issuer, adminEmail }
      : { name, idpIssuer: issuer, adminEmail, tenantId })
    const admin = control.findUserByEmail(tenant.id, adminEmail)
    console.log(JSON.stringify({ tenant, adminUserId: admin?.id }, undefined, 2))
  } else if (command === 'tenant' && subcommand === 'list') {
    console.log(JSON.stringify({ tenants: control.listTenants() }, undefined, 2))
  } else if (command === 'user' && subcommand === 'add') {
    const tenantId = flags.get('tenant')
    const email = flags.get('email')
    if (tenantId === undefined || email === undefined) usage()
    const role = flags.get('role') === 'admin' ? 'admin' : 'member'
    console.log(JSON.stringify({ userId: control.addUser({ tenantId, email, role }).userId }, undefined, 2))
  } else if (command === 'token' && subcommand === 'issue') {
    const tenantId = flags.get('tenant')
    const userId = flags.get('user')
    const role = flags.get('role') === 'admin' ? 'admin' : 'member'
    if (tenantId === undefined || userId === undefined) usage()
    console.log(control.issueSession({ tenantId, userId, role }))
  } else if (command === 'serve') {
    control.close()
    const server = await startControlPlaneServer({
      dbPath,
      dataDir,
      port: flags.get('port') === undefined ? 4320 : Number(flags.get('port')),
      ...(process.env.SIRIUSX_SESSION_SECRET === undefined ? {} : { sessionSecret: process.env.SIRIUSX_SESSION_SECRET }),
    })
    const gateway = flags.get('gateway-port') === undefined ? undefined : await startModelGateway({
      control: server.control,
      port: Number(flags.get('gateway-port')),
      ...(process.env.SIRIUSX_UPSTREAM_MODEL_URL === undefined ? {} : { upstreamUrl: process.env.SIRIUSX_UPSTREAM_MODEL_URL }),
      ...(process.env.SIRIUSX_UPSTREAM_MODEL_KEY === undefined ? {} : { upstreamKey: process.env.SIRIUSX_UPSTREAM_MODEL_KEY }),
    })
    console.log(JSON.stringify({ ready: true, controlPlaneUrl: server.url, ...(gateway === undefined ? {} : { modelGatewayUrl: gateway.url }) }, undefined, 2))
    const stop = async (): Promise<void> => { await gateway?.close(); await server.close(); process.exit(0) }
    process.once('SIGINT', () => { void stop() })
    process.once('SIGTERM', () => { void stop() })
    await new Promise<void>(() => {})
  } else {
    usage()
  }
} finally {
  control.close()
}
