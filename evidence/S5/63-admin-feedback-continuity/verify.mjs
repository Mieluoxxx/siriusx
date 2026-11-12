import { chromium } from '/root/siriusx/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[]; page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errors.push(m.text())}); page.on('pageerror',e=>errors.push(String(e)))
await page.goto('http://192.168.14.39:8090/',{waitUntil:'domcontentloaded'})
// bad token -> inline error
await page.getByLabel('Platform token').fill('wrong-token')
await page.getByRole('button',{name:'Connect'}).click()
await page.waitForTimeout(500)
const authError=await page.locator('#auth-error').evaluate(n=>({hidden:n.hidden,text:n.textContent}))
// good token
await page.getByLabel('Platform token').fill('platform-local-2026')
await page.getByRole('button',{name:'Connect'}).click()
await page.waitForTimeout(800)
// notification panel
await page.getByRole('button',{name:/Notifications/}).click()
await page.waitForTimeout(150)
const notificationOpen=await page.locator('#notification-panel').evaluate(n=>n.matches(':popover-open'))
await page.keyboard.press('Escape')
// toast: suspend + undo
await page.getByRole('button',{name:'Tenants'}).first().click(); await page.waitForTimeout(250)
const indicator=await page.locator('.nav-indicator').evaluate(n=>getComputedStyle(n).width)
await page.getByRole('button',{name:'Suspend'}).click(); await page.waitForTimeout(600)
const toastVisible=await page.locator('.toast:popover-open').count()
const toastText=await page.locator('.toast').first().innerText()
await page.getByRole('button',{name:'Undo'}).click(); await page.waitForTimeout(700)
const restored=await page.locator('body').innerText()
// open tenant then delete -> cancel confirm
await page.getByRole('button',{name:'Open'}).last().click(); await page.waitForTimeout(500)
const dialogOpen=await page.locator('#tenant-dialog').evaluate(n=>n.open)
await page.locator('#detail-upstreams').getByRole('button',{name:'Delete'}).click(); await page.waitForTimeout(150)
const confirmOpen=await page.locator('.confirm-dialog').evaluate(n=>n.open)
await page.locator('.confirm-dialog').getByRole('button',{name:'Cancel'}).click(); await page.waitForTimeout(200)
const confirmClosed=await page.locator('.confirm-dialog').count()
// dialog close escalation
await page.getByRole('dialog').getByRole('button',{name:'Close'}).click(); await page.waitForTimeout(650)
const dialogClosed=await page.locator('#tenant-dialog').evaluate(n=>!n.open)
await page.screenshot({path:'/tmp/admin-feedback-final.png',fullPage:true})
await browser.close()
const result={authError,notificationOpen,indicator,toastVisible,toastText,restored:restored.includes('active'),dialogOpen,confirmOpen,confirmClosed,dialogClosed,errors}
console.log(JSON.stringify(result,null,2))
if(authError.hidden||!authError.text.includes('platform admin token required')||!notificationOpen||toastVisible!==1||!toastText.includes('Tenant suspended')||!restored.includes('active')||!dialogOpen||!confirmOpen||confirmClosed!==0||!dialogClosed||errors.length)process.exit(1)
