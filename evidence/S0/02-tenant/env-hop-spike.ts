/**
 * S0 spike: the Desktop main process already preserves arbitrary launch
 * environment entries when it spawns the private Host. This is the smallest
 * trusted context channel if SSO is implemented in the Electron shell rather
 * than inside the Host.
 */
import assert from 'node:assert/strict'
import { desktopNodeEnvironment } from '/root/siriusx/deepseek-harness/apps/desktop/src/node-environment.ts'

const env = desktopNodeEnvironment('/opt/electron', undefined, {
  PATH: '/usr/bin',
  SIRIUSX_TENANT_ID: 'tenant-acme',
  SIRIUSX_SUBJECT_ID: 'user-42',
})

assert.equal(env.SIRIUSX_TENANT_ID, 'tenant-acme')
assert.equal(env.SIRIUSX_SUBJECT_ID, 'user-42')
assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
assert.equal(env.PATH, '/usr/bin')

console.log(JSON.stringify({
  result: 'pass',
  tenant: env.SIRIUSX_TENANT_ID,
  subject: env.SIRIUSX_SUBJECT_ID,
  electronRunAsNode: env.ELECTRON_RUN_AS_NODE,
}, null, 2))
