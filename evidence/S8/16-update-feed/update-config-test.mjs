import { resolveSiriusxUpdateConfig } from '../../../deepseek-harness/apps/desktop/scripts/siriusx-update-config.mjs'
const stable = resolveSiriusxUpdateConfig({ SIRIUSX_UPDATE_URL: 'https://updates.siriusx.example/desktop/' }, 'darwin', 'arm64')
const nightly = resolveSiriusxUpdateConfig({ SIRIUSX_UPDATE_URL: 'https://updates.siriusx.example/desktop', SIRIUSX_UPDATE_CHANNEL: 'nightly' }, 'win32', 'x64')
let rejected = false
try { resolveSiriusxUpdateConfig({ SIRIUSX_UPDATE_URL: 'http://updates.example' }, 'darwin', 'arm64') } catch { rejected = true }
console.log(JSON.stringify({ stable, nightly, rejected }, null, 2))
if (!stable || !nightly || !rejected) process.exit(1)
