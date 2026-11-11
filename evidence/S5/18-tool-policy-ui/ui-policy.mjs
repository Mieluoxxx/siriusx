import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await context.addInitScript(({ token }) => {
  try { localStorage.setItem('siriusx.controlToken', token); localStorage.setItem('siriusx.controlApi', 'http://127.0.0.1:4326') } catch {}
}, { token: process.env.TOKEN })
const page = await context.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
await page.goto(process.env.DSH_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
const cont = page.getByRole('button', { name: 'Continue' }); if (await cont.count()) await cont.click()
await page.waitForTimeout(700)
const team = page.locator('button[aria-label="Team"]'); if (await team.count()) await team.first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'admin' }).click()
await page.waitForTimeout(700)
await page.getByPlaceholder('Action class').fill('send_email')
await page.getByRole('button', { name: 'Set policy' }).click()
await page.waitForTimeout(600)
const after = await page.locator('body').innerText()
await page.screenshot({ path: '/root/siriusx/evidence/S5/18-tool-policy-ui/policy.png', fullPage: true })
await context.close(); await browser.close()
const result = { set: after.includes('send_email') && after.includes('approval'), audit: after.includes('Audit summary'), errors }
console.log(JSON.stringify(result, null, 2))
if (!result.set || !result.audit || errors.length > 0) process.exit(1)
