import { createClient } from '@supabase/supabase-js'
import { env, STORAGE_BUCKET } from '#/env.server'
import { resend } from './resend.server'
import type { BlobIO, Mailer } from './send'
import type {
  AttachmentMeta,
  BlobStore,
  MailSource,
  ReceivedEmail,
} from './types'

function fail(
  what: string,
  error: { name?: string; message?: string } | null,
): never {
  // Name only: the message can carry request details.
  throw new Error(`${what}: ${error?.name ?? 'unknown_error'}`)
}

export const resendSource: MailSource = {
  async getReceived(id): Promise<ReceivedEmail> {
    const { data, error } = await resend.emails.receiving.get(id)
    if (error) fail('resend receiving.get', error)
    return {
      id: data.id,
      from: data.from,
      to: data.to,
      cc: data.cc ?? [],
      bcc: data.bcc ?? [],
      receivedFor: data.received_for,
      subject: data.subject,
      html: data.html,
      text: data.text,
      headers: data.headers,
      messageId: data.message_id,
      createdAt: new Date(data.created_at),
    }
  },

  async listAttachments(emailId): Promise<AttachmentMeta[]> {
    const out: AttachmentMeta[] = []
    let after: string | undefined
    for (let page = 0; page < 20; page++) {
      const { data, error } = await resend.emails.receiving.attachments.list({
        emailId,
        limit: 100,
        after,
      })
      if (error) fail('resend attachments.list', error)
      for (const a of data.data) {
        out.push({
          id: a.id,
          filename: a.filename ?? null,
          size: a.size,
          contentType: a.content_type,
          disposition: a.content_disposition,
          contentId: a.content_id ?? null,
          downloadUrl: a.download_url,
        })
      }
      const last = data.data.at(-1)
      if (!data.has_more || !last) break
      after = last.id
    }
    return out
  },

  async download(url) {
    if (new URL(url).protocol !== 'https:')
      throw new Error('attachment url is not https')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`attachment download: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  },

  async listReceived({ limit, after }) {
    const { data, error } = await resend.emails.receiving.list({ limit, after })
    if (error) fail('resend receiving.list', error)
    return { ids: data.data.map((e) => e.id), hasMore: data.has_more }
  },
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

export const storage = supabase.storage.from(STORAGE_BUCKET)

export const supabaseStore: BlobStore = {
  async put(path, bytes, contentType) {
    const { error } = await storage.upload(path, bytes, {
      contentType,
      upsert: true,
    })
    if (error) fail('storage upload', error)
  },
}

export const resendMailer: Mailer = {
  async send(p, { idempotencyKey }) {
    const { data, error } = await resend.emails.send(
      {
        from: p.from,
        to: p.to,
        cc: p.cc.length > 0 ? p.cc : undefined,
        bcc: p.bcc.length > 0 ? p.bcc : undefined,
        subject: p.subject,
        text: p.text,
        html: p.html,
        headers: p.headers,
        attachments: p.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: Buffer.from(a.content),
        })),
      },
      { idempotencyKey },
    )
    if (error) fail('resend send', error)
    return { id: data.id }
  },
}

export const supabaseBlobs: BlobIO = {
  async download(path) {
    const { data, error } = await storage.download(path)
    if (error) fail('storage download', error)
    return new Uint8Array(await data.arrayBuffer())
  },
  put: supabaseStore.put,
  async remove(paths) {
    if (paths.length === 0) return
    const { error } = await storage.remove(paths)
    if (error) fail('storage remove', error)
  },
}
