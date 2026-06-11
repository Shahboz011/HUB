import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://dbukihrdqbjzohbcngqr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidWtpaHJkcWJqem9oYmNuZ3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNzc5MDMsImV4cCI6MjA5Njc1MzkwM30.KC0OT6DnUu74EpMoNO1BWmtTLj7Z3ipNgJr4DJSTtj8'
)
