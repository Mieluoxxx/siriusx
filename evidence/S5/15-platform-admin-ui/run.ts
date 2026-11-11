import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-platform-admin-'))
const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'platform-admin', platformAdminToken: 'platform-secret' })
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors: string[] = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${server.url}/admin`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('X-SiriusX-Platform-Token').fill('platform-secret')
  await page.getByRole('button', { name: 'Load' }).click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder('Display name').fill('Model UI')
  await page.getByPlaceholder('Provider', { exact: true }).fill('openai')
  await page.getByPlaceholder('Provider model id').fill('gpt-ui')
  await page.getByRole('button', { name: 'Add model' }).click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder('Name', { exact: true }).fill('Platform Tenant')
  await page.getByPlaceholder('IdP issuer').fill('https://idp.platform.example')
  await page.getByPlaceholder('Admin email').fill('admin@platform.example')
  await page.getByPlaceholder('Tenant id (optional)').fill('tenant-platform')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Users' }).first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Set default' }).first().click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder('Max users').fill('2')
  await page.getByRole('button', { name: 'Save quota' }).click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder('User email').fill('member@platform.example')
  await page.getByRole('button', { name: 'Add user' }).click()
  await page.waitForTimeout(500)
  const body = await page.locator('body').innerText()
  await page.screenshot({ path: '/root/siriusx/evidence/S5/15-platform-admin-ui/admin.png', fullPage: true })
  const result = { tenant: body.includes('tenant-platform'), usage: body.includes('Platform Tenant'), quota: body.includes('Quota') && body.includes('Save quota'), model: body.includes('Model UI') && body.includes('Bound models'), user: body.includes('member@platform.example'), errors }
  console.log(JSON.stringify(result, null, 2))
  if (!result.tenant || !result.usage || !result.quota || !result.model || !result.user || errors.length > 0) process.exitCode = 1
} finally {
  await browser.close(); await server.close(); await rm(root, { recursive: true, force: true })
}
