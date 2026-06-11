// One-shot runner: applies every supabase/migrations/*.sql to the project
// via the Supabase Management API (executes as the postgres role).
//
// Usage (PowerShell):
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; node run-full-migration.mjs
import https from 'https'
import fs from 'fs'
import path from 'path'

const PROJECT = 'dbukihrdqbjzohbcngqr'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) {
  console.error('Set SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...) first.')
  process.exit(1)
}

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

function runQuery(sql) {
  const payload = JSON.stringify({ query: sql })
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.supabase.com',
        path: `/v1/projects/${PROJECT}/database/query`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${TOKEN}`,
        },
      },
      res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          let body
          try { body = JSON.parse(data) } catch { body = data }
          resolve({ status: res.statusCode, body })
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  process.stdout.write(`→ ${file} … `)
  const { status, body } = await runQuery(sql)
  if (status >= 200 && status < 300) {
    console.log('OK')
  } else {
    console.log(`FAILED (HTTP ${status})`)
    console.error(JSON.stringify(body, null, 2))
    process.exit(1)
  }
}
console.log('\n✓ All migrations applied.')
