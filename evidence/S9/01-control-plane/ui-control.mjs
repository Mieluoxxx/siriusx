import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const url=process.env.DSH_URL
const browser=await chromium.launch({ headless:true, executablePath:'/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args:['--no-sandbox'] })
async function open(token, label) {
  const context=await browser.newContext({ viewport:{width:1400,height:900} })
  await context.addInitScript(({token}) => {
    try { localStorage.setItem('siriusx.controlToken', token); localStorage.setItem('siriusx.controlApi','http://127.0.0.1:4320') } catch {}
  }, {token})
  const page=await context.newPage()
  const errors=[]; page.on('console',m=>{if(m.type()==='error') errors.push(m.text())}); page.on('pageerror',e=>errors.push(String(e)))
  const controlRequests=[]
  page.on('request',request=>{ if(request.url().includes('127.0.0.1:4320')) controlRequests.push(`${request.method()} ${request.url()}`) })
  await page.goto(url,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(5000)
  const cont=page.getByRole('button',{name:'Continue'}); if(await cont.count()) await cont.click()
  await page.waitForTimeout(800)
  const team=page.locator('button[aria-label="Team"]'); if(await team.count()) await team.first().click()
  await page.waitForTimeout(1200)
  if (label === 'acme') {
    await page.getByPlaceholder('Local repository path (absolute)').fill(process.env.REPO)
    await page.getByPlaceholder('What should the bot do?').fill('web control-plane ticket')
    await page.getByRole('button',{name:'Dispatch ticket'}).click()
    await page.waitForTimeout(5000)
    await page.screenshot({path:'/tmp/s9-web-control-acme.png', fullPage:true})
  } else {
    await page.screenshot({path:'/tmp/s9-web-control-beta.png', fullPage:true})
  }
  const body=await page.locator('body').innerText()
  await context.close()
  return { label, body: body.slice(0,1200), errors, controlRequests: controlRequests.slice(0,12) }
}
console.log(JSON.stringify({ acme: await open(process.env.TOKEN_A,'acme'), beta: await open(process.env.TOKEN_B,'beta') }, null, 2))
await browser.close()
