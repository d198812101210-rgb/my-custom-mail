import { z } from 'zod'

const mailbox = z
  .string()
  .min(3)
  .regex(
    /^(?:[^<>]*<)?[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>?$/,
    'must be an email address or "Name <address>"',
  )

const schema = z.object({
  RESEND_API_KEY: z.string().min(1),
  // Optional so the first deploy can happen before the webhook exists.
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OWNER_EMAIL: z
    .email()
    .refine((v) => !v.toLowerCase().endsWith('@tanakadev.digital'), {
      message: 'must be an external address, not on tanakadev.digital',
    }),
  MAIL_FROM: mailbox,
  AUTH_FROM: mailbox,
  APP_URL: z.url(),
})

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (e.g. `RESEND_WEBHOOK_SECRET=` in .env) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  )
  const result = schema.safeParse(cleaned)
  if (!result.success) {
    // Names and messages only: never echo values, they may be secrets.
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid environment: ${problems}`)
  }
  return result.data
}

export const env: Env = parseEnv(process.env)

export const STORAGE_BUCKET = 'mail-attachments'
