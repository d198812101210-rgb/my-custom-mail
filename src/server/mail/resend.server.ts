import { Resend } from 'resend'
import { env } from '#/env.server'

export const resend = new Resend(env.RESEND_API_KEY)

export async function sendLoginCode(code: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.AUTH_FROM,
    to: env.OWNER_EMAIL,
    subject: 'Your Mailbox login code',
    text: `Your login code is ${code}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this message.`,
    html: `<p>Your login code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:monospace">${code}</p><p>It expires in 10 minutes. If you did not ask for it, ignore this message.</p>`,
  })
  // The error object never contains the code; log only its name.
  if (error) throw new Error(`Resend send failed: ${error.name}`)
}
