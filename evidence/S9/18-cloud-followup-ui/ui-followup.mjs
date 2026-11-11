import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await context.addInitScript(({ token }) => {
  try { localStorage.setItem('siriusx.controlToken', token); localStorage.setItem('siriusx.controlApi', 'http://127.0.0.1:4323') } catch {}
}, { token: process.env.TOKEN })
const page = await context.newPage()
const errors = []; const requests = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
page.on('request', request => { if (request.url().includes('/input')) requests.push(`${request.method()} ${request.url()}`) })
await page.goto(process.env.DSH_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
const cont = page.getByRole('button', { name: 'Continue' }); if (await cont.count()) await cont.click()
await page.waitForTimeout(700)
const team = page.locator('button[aria-label="Team"]'); if (await team.count()) await team.first().click()
await page.waitForTimeout(1500)
// open the cloud ticket in the list
const ticket = page.getByRole('button', { name: new RegExp(process.env.TICKET.slice(0, 13)) }).first()
if (await ticket.count()) await ticket.click()
await page.waitForTimeout(500)
await page.getByPlaceholder('Follow-up / interrupt text').fill('continue from the browser')
await page.getByRole('button', { name: 'Send' }).click()
await page.waitForTimeout(5000)
const body = await page.locator('body').innerText()
await page.screenshot({ path: '/root/siriusx/evidence/S9/18-cloud-followup-ui/followup.png', fullPage: true })
await context.close(); await browser.close()
const result = { sent: requests.some(request => request.startsWith('POST ')), reportReady: body.includes('person/review'), body: body.slice(0, 1400), requests, errors }
console.log(JSON.stringify(result, null, 2))
if (!result.sent || errors.length > 0) process.exit(1)
