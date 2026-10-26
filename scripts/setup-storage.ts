import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const BUCKET = 'mail-attachments'
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.',
  )
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data: existing, error: getError } =
  await supabase.storage.getBucket(BUCKET)
if (existing) {
  if (existing.public) {
    // Never leave attachments publicly readable.
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      public: false,
    })
    if (error) throw error
    console.log(
      `Bucket "${BUCKET}" existed and was public: switched to private.`,
    )
  } else {
    console.log(`Bucket "${BUCKET}" already exists and is private.`)
  }
} else {
  if (!/not found/i.test(getError.message)) throw getError
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  })
  if (error) throw error
  console.log(`Created private bucket "${BUCKET}".`)
}
