import https from 'https'

const PROJECT = 'dbukihrdqbjzohbcngqr'
// Paste the NEW project's service_role key here (Project Settings → API → service_role).
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'PASTE_NEW_SERVICE_ROLE_KEY'

const SQL = `
ALTER TABLE work_sessions
  ADD COLUMN IF NOT EXISTS restroom_hour_index integer NOT NULL DEFAULT 0;
`

function post(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
      (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, body: data }) }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const result = await post(
  `${PROJECT}.supabase.co`,
  '/pg-meta/v1/query',
  { query: SQL },
  { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
)

if (result.status >= 200 && result.status < 300) {
  console.log('✓ Migration applied successfully.')
} else {
  console.error(`✗ Failed (HTTP ${result.status}):`, JSON.stringify(result.body, null, 2))
  console.log('\nRun this manually in Supabase SQL Editor:\n')
  console.log(SQL)
}
