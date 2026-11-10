import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addInitScript(({ token }) => { try { localStorage.setItem('siriusx.controlToken', token); localStorage.setItem('siriusx.controlApi', 'http://127.0.0.1:4320') } catch {} }, { token: process.env.TOKEN })
const page = await context.newPage()
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) }); page.on('pageerror', e => errors.push(String(e)))
await page.goto(process.env.DSH_URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000)
const cont = page.getByRole('button', { name: 'Continue' }); if (await cont.count()) await cont.click(); await page.waitForTimeout(700)
const open = page.locator('button[aria-label="Open sidebar"]'); if (await open.count()) await open.last().click(); await page.waitForTimeout(500)
const team = page.locator('button[aria-label="Team"]'); if (await team.count()) await team.first().click(); await page.waitForTimeout(800)
await page.locator('select').selectOption({ label: `Device: ${process.env.DEVICE_NAME}` })
await page.getByPlaceholder('Local repository path (absolute)').fill(process.env.REPO)
await page.getByPlaceholder('What should the bot do?').fill('first device task')
await page.getByRole('button', { name: 'Dispatch ticket' }).click()
await page.waitForTimeout(5000)
const before = await page.locator('body').innerText()
await page.getByPlaceholder('Follow-up / interrupt text').fill('follow up from mobile viewport')
await page.getByRole('button', { name: 'Send' }).click()
await page.waitForTimeout(5000)
const after = await page.locator('body').innerText()
console.log(JSON.stringify({
  before: before.slice(0, 1200),
  after: after.slice(0, 1600),
  preparingEvents: (after.match(/"state":"preparing"/g) ?? []).length,
  errors,
}, null, 2))
await page.screenshot({ path: '/tmp/s10-device-followup.png', fullPage: false })
await browser.close()
