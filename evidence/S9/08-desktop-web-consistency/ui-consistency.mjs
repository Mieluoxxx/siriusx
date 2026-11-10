import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
const token = process.env.TOKEN
const ticketId = process.env.TICKET_ID
const dshUrl = process.env.DSH_URL
const gatewayUrl = 'http://127.0.0.1:8080'
async function load(page, url, direct) {
  if (direct) await page.addInitScript(({ token }) => { localStorage.setItem('siriusx.controlToken', token); localStorage.setItem('siriusx.controlApi', 'http://127.0.0.1:4320') }, { token })
  else await page.addInitScript(() => { localStorage.setItem('siriusx.gatewayAuth', '1') })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const cont = page.getByRole('button', { name: 'Continue' }); if (await cont.count()) await cont.click(); await page.waitForTimeout(800)
  const team = page.locator('button[aria-label="Team"]'); if (await team.count()) await team.first().click(); await page.waitForTimeout(2000)
  return await page.locator('body').innerText()
}
const directContext = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const directPage = await directContext.newPage()
const direct = await load(directPage, dshUrl, true)
const gatewayContext = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const login = await gatewayContext.request.post(`${gatewayUrl}/auth/session`, { data: { token } })
if (login.status() !== 204) throw new Error(`gateway login failed: ${login.status()}`)
const gatewayPage = await gatewayContext.newPage()
const web = await load(gatewayPage, gatewayUrl, false)
const result = {
  ticketId,
  directHasTicket: direct.includes(ticketId.slice(0, 12)),
  webHasTicket: web.includes(ticketId.slice(0, 12)),
  directHasReport: direct.includes('tenant-local Bot runtime finished'),
  webHasReport: web.includes('tenant-local Bot runtime finished'),
  direct: direct.slice(0, 900),
  web: web.slice(0, 900),
}
console.log(JSON.stringify(result, null, 2))
await directPage.screenshot({ path: '/tmp/s9-consistency-desktop.png', fullPage: true })
await gatewayPage.screenshot({ path: '/tmp/s9-consistency-web.png', fullPage: true })
await browser.close()
if (!result.directHasTicket || !result.webHasTicket || !result.directHasReport || !result.webHasReport) process.exit(1)
