import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

const app = await electron.launch({
  executablePath: path.join(__dirname, 'node_modules/electron/dist/electron.exe'),
  args: [path.join(__dirname, 'out/main/index.js')],
  timeout: 30000,
})

await new Promise(r => setTimeout(r, 5000))
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await new Promise(r => setTimeout(r, 2000))

// Check if we're on auth screen or already logged in
const isAuth = await page.$('.auth-submit')

if (isAuth) {
  await page.fill('input[type="email"]', 'shekhbazbe@gmail.com')
  await page.fill('input[type="password"]', 'Shahboz200520')
  await page.click('.auth-submit')
  await new Promise(r => setTimeout(r, 4000))
}

// 1. Admin table
await page.screenshot({ path: path.join(SHOTS, '1-admin-table.png') })
console.log('shot: admin table')

// 2. Salary Report
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.nav-tab')].find(t => t.textContent.includes('Salary'))
  tab?.click()
})
await new Promise(r => setTimeout(r, 1500))
await page.screenshot({ path: path.join(SHOTS, '2-salary-report.png') })
console.log('shot: salary report')

// 3. Admin Panel departments
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.nav-tab')].find(t => t.textContent.includes('Admin'))
  tab?.click()
})
await new Promise(r => setTimeout(r, 1000))
await page.screenshot({ path: path.join(SHOTS, '3-admin-panel-depts.png') })
console.log('shot: admin panel departments')

// 4. Click a department
await page.evaluate(() => document.querySelector('.dept-list-row-clickable')?.click())
await new Promise(r => setTimeout(r, 1000))
await page.screenshot({ path: path.join(SHOTS, '4-dept-detail.png') })
console.log('shot: department detail')

await app.close()
console.log('done —', SHOTS)
