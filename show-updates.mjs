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

// Add demo transactions
await win.locator('.bf-amount-input').fill('500')
await win.locator('.bf-note-input').fill('Q2 performance bonus')
await win.locator('.bf-add-btn').click()
await win.waitForTimeout(1000)

await win.locator('.bf-type-select').selectOption('fine')
await win.locator('.bf-amount-input').fill('75')
await win.locator('.bf-note-input').fill('Late arrival - 3 occurrences')
await win.locator('.bf-add-btn').click()
await win.waitForTimeout(1000)

// Scroll to bf-list for before screenshot
await win.evaluate(() => document.querySelector('.bf-list')?.scrollIntoView({ behavior: 'instant', block: 'start' }))
await win.waitForTimeout(400)
await win.screenshot({ path: 'show-01-bf-list.png' })

// Click fine row (first) to expand
await win.locator('.bf-row-summary').first().click()
await win.waitForTimeout(600) // wait for smooth scroll
await win.screenshot({ path: 'show-02-bf-expanded.png' })

// Delete expanded row: click "Delete entry" then "Yes, delete"
await win.locator('.dept-delete-icon-btn').first().click()
await win.waitForTimeout(300)
await win.locator('.dept-delete-confirm-btn').first().click()
await win.waitForTimeout(800)

// Expand remaining row and delete
await win.locator('.bf-row-summary').first().click()
await win.waitForTimeout(400)
await win.locator('.dept-delete-icon-btn').first().click()
await win.waitForTimeout(300)
await win.locator('.dept-delete-confirm-btn').first().click()
await win.waitForTimeout(800)

console.log('Done — screenshots saved, demo entries deleted.')
await app.close()
