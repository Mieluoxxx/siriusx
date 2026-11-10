/** Playwright: open the DSH Team panel and create a ticket through the UI. */
import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const url = process.env.DSH_URL
const repo = process.env.REPO
if (url === undefined || repo === undefined) throw new Error('DSH_URL and REPO are required')
const browser = await chromium.launch({
  headless: true,
  executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(5_000)
const cont = page.getByRole('button', { name: 'Continue' })
if (await cont.count()) await cont.click()
await page.getByText('Team', { exact: true }).last().click()
await page.waitForTimeout(1_000)
await page.getByPlaceholder('Local repository path (absolute)').fill(repo)
await page.getByPlaceholder('What should the bot do?').fill('Implement the ticket from the SiriusX team panel.')
await page.getByRole('button', { name: 'Dispatch ticket' }).click()
await page.waitForTimeout(5_000)
const body = await page.locator('body').innerText()
console.log(JSON.stringify({ panel: await page.locator('[data-testid="siriusx-team-panel"]').count(), body: body.slice(0, 2500), errors }, undefined, 2))
await page.screenshot({ path: process.env.UI_SCREENSHOT ?? '/tmp/s4-team-panel-ticket.png', fullPage: true })
await browser.close()
