import assert from 'node:assert/strict'
import { enterpriseHostEnvironment, loadEnterpriseConfig } from '/root/siriusx/deepseek-harness/apps/desktop/src/enterprise.ts'
import { needsWelcome } from '/root/siriusx/deepseek-harness/apps/desktop/src/welcome-api.ts'

const personal = loadEnterpriseConfig('/nonexistent', {})
assert.equal(personal.enabled, false)
const enterprise = loadEnterpriseConfig('/nonexistent', {
  SIRIUSX_ENTERPRISE: '1',
  SIRIUSX_SSO_ISSUER: 'https://idp.example',
  SIRIUSX_SSO_CLIENT_ID: 'siriusx-desktop',
  SIRIUSX_SSO_JWKS_URI: 'https://idp.example/jwks',
  SIRIUSX_MODEL_GATEWAY_URL: 'https://models.example',
})
assert.equal(enterprise.enabled, true)
const env = enterpriseHostEnvironment(enterprise, { PATH: '/usr/bin' })
assert.equal(env.SIRIUSX_ENTERPRISE, '1')
assert.equal(env.SIRIUSX_SSO_ISSUER, 'https://idp.example')
assert.equal(env.SIRIUSX_SSO_CLIENT_ID, 'siriusx-desktop')
assert.equal(env.SIRIUSX_MODEL_GATEWAY_URL, 'https://models.example')
assert.equal(needsWelcome({ loggedIn: false, hasApiKey: true }, true), true)
assert.equal(needsWelcome({ loggedIn: false, hasApiKey: true }, false), false)
assert.equal(needsWelcome({ loggedIn: true, hasApiKey: false }, true), false)
console.log(JSON.stringify({ personal, enterprise, hostEnv: env, enterpriseRequiresLogin: true }, null, 2))
