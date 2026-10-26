// Dummy values so modules that read env at import time can load under test.
Object.assign(process.env, {
  RESEND_API_KEY: 're_test',
  RESEND_WEBHOOK_SECRET: 'whsec_test',
  DATABASE_URL: 'postgresql://user:pass@localhost:6543/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  OWNER_EMAIL: 'owner@example.com',
  MAIL_FROM: 'Me <me@tanakadev.digital>',
  AUTH_FROM: 'Login <login@tanakadev.digital>',
  APP_URL: 'http://localhost:3000',
})
