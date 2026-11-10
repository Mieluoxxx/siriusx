import { loadEnterpriseConfig, enterpriseHostEnvironment } from '/root/siriusx/deepseek-harness/apps/desktop/src/enterprise.ts'
const config = loadEnterpriseConfig('/tmp/s8-plugin-bundle/plugin-bundle', { SIRIUSX_BUNDLED_PLUGINS_DIR: 'plugins' })
const env = enterpriseHostEnvironment(config, {})
console.log(JSON.stringify({ config, bundled: env.SIRIUSX_BUNDLED_PLUGINS_DIR }, null, 2))
