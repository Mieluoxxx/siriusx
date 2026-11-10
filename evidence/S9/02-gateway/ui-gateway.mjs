import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] })
const unauth = await browser.newContext()
const unauthPage = await unauth.newPage()
await unauthPage.goto(process.env.GATEWAY_URL, { waitUntil: 'domcontentloaded' })
const unauthResult = { url: unauthPage.url(), body: (await unauthPage.locator('body').innerText()).slice(0, 200) }
await unauth.close()

async function open(token, ticketWord, shot) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const auth = await context.request.post(`${process.env.GATEWAY_URL}/auth/session`, { data: { token } })
  if (auth.status() !== 204) throw new Error(`login failed: ${auth.status()}`)
  await context.addInitScript(() => { try { localStorage.setItem('siriusx.gatewayAuth', '1') } catch {} })
  const page = await context.newPage()
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) }); page.on('pageerror', e => errors.push(String(e)))
  const response = await page.goto(process.env.GATEWAY_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const cont = page.getByRole('button', { name: 'Continue' }); if (await cont.count()) await cont.click(); await page.waitForTimeout(800)
  const team = page.locator('button[aria-label="Team"]'); if (await team.count()) await team.first().click(); await page.waitForTimeout(1500)
  const body = await page.locator('body').innerText()
  const nativeNewSessionVisible = await page.locator('[aria-label="New session"]').first().isVisible().catch(() => false)
  const localPathVisible = await page.getByPlaceholder('Local repository path (absolute)').count() > 0
  const title = await page.title().catch(() => '')
  if (shot !== undefined) await page.screenshot({ path: shot, fullPage: true })
  await context.close()
  return { status: response?.status(), title, ticketWord, nativeNewSessionVisible, localPathVisible, body: body.slice(0, 900), errors }
}

const acme = await open(process.env.TOKEN_A, '1 ticket', process.env.SHOT)
const beta = await open(process.env.TOKEN_B, '0 ticket')
console.log(JSON.stringify({ unauthResult, acme, beta }, null, 2))
await browser.close()
