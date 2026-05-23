import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://oewfgyiuyeetsxebowaa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2ZneWl1eWVldHN4ZWJvd2FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MzUxNzMsImV4cCI6MjA5NTExMTE3M30.zafXG-ApBQcBfiPwdZ9MS0179znzpxBJ0mJpdxEMnHE'
)
