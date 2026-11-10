/** Open the DSH Web UI and call the executor-local Host route while it is open. */
import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const url = process.env.DSH_URL
const repo = process.env.EXECUTOR_REPO
if (url === undefined || repo === undefined) throw new Error('DSH_URL and EXECUTOR_REPO are required')
const browser = await chromium.launch({
  headless: true,
  executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(5_000)
const bodyText = (await page.locator('body').innerText()).slice(0, 500)
await page.screenshot({ path: process.env.UI_SCREENSHOT ?? '/tmp/siriusx-s3-ui.png', fullPage: true })
const result = await page.evaluate(async ({ repo }) => {
  const response = await fetch('/__siriusx/executor/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo, prompt: 'Run while the DSH Web UI is open.' }),
  })
  return { status: response.status, body: await response.text() }
}, { repo })
console.log(JSON.stringify({ url: page.url(), title: await page.title(), bodyText, errors, result }, undefined, 2))
await browser.close()
