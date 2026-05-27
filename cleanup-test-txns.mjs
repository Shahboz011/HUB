// Delete ALL transactions on the first employee (test data only — real employees won't be touched)
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = await electron.launch({ args: [path.join(__dirname, 'out/main/index.js')] })
const win = await app.firstWindow()
await win.waitForSelector('.auth-screen, .app-header', { timeout: 15000 })

if (await win.locator('.auth-email-input').isVisible()) {
  await win.locator('.auth-email-input').fill('shekhbazbe@gmail.com')
  await win.locator('.auth-password-input').fill('Shahboz200520')
  await win.locator('.auth-submit-btn').click()
  await win.waitForSelector('.app-header', { timeout: 15000 })
}

await win.waitForSelector('.view-hist-btn', { timeout: 20000 })
await win.waitForTimeout(1000)
await win.locator('.view-hist-btn').first().click()
await win.waitForSelector('.att-wrap', { timeout: 8000 })
await win.waitForTimeout(800)

let deleted = 0
for (let i = 0; i < 20; i++) {
  const summary = win.locator('.bf-row-summary').first()
  if (!await summary.isVisible().catch(() => false)) break
  await summary.click()
  await win.waitForTimeout(300)
  const deleteIcon = win.locator('.dept-delete-icon-btn').first()
  if (!await deleteIcon.isVisible().catch(() => false)) break
  await deleteIcon.click()
  await win.waitForTimeout(200)
  const confirmBtn = win.locator('.dept-delete-confirm-btn').first()
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click()
    await win.waitForTimeout(600)
    deleted++
  } else break
}

console.log(`Cleaned up ${deleted} test transaction(s).`)
await app.close()
