import type { BlobIO, Mailer, OutgoingPayload } from '../src/server/mail/send'
import type {
  AttachmentMeta,
  BlobStore,
  MailSource,
  ReceivedEmail,
} from '../src/server/mail/types'

export const OWN_DOMAIN = 'tanakadev.digital'

export function makeEmail(
  overrides: Partial<ReceivedEmail> & { id: string },
): ReceivedEmail {
  return {
    from: 'Alice <alice@example.com>',
    to: ['test@tanakadev.digital'],
    cc: [],
    bcc: [],
    receivedFor: ['test@tanakadev.digital'],
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi',
    headers: {},
    messageId: `<${overrides.id}@example.com>`,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  }
}

export class FakeMail implements MailSource {
  emails = new Map<string, ReceivedEmail>()
  attachments = new Map<string, AttachmentMeta[]>()
  files = new Map<string, Uint8Array>()
  getCalls = 0
  failNextGet = false
  failDownloads = false

  add(email: ReceivedEmail, atts: AttachmentMeta[] = []) {
    this.emails.set(email.id, email)
    this.attachments.set(email.id, atts)
    for (const a of atts)
      this.files.set(a.downloadUrl, new TextEncoder().encode(`file:${a.id}`))
  }

  getReceived(id: string): Promise<ReceivedEmail> {
    this.getCalls++
    if (this.failNextGet) {
      this.failNextGet = false
      return Promise.reject(new Error('resend is down'))
    }
    const e = this.emails.get(id)
    return e ? Promise.resolve(e) : Promise.reject(new Error('not found'))
  }

  listAttachments(id: string): Promise<AttachmentMeta[]> {
    return Promise.resolve(this.attachments.get(id) ?? [])
  }

  download(url: string): Promise<Uint8Array> {
    if (this.failDownloads) return Promise.reject(new Error('expired'))
    const f = this.files.get(url)
    return f ? Promise.resolve(f) : Promise.reject(new Error('missing file'))
  }

  listReceived({ limit, after }: { limit: number; after?: string }) {
    const ids = [...this.emails.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => e.id)
    const start = after === undefined ? 0 : ids.indexOf(after) + 1
    const page = ids.slice(start, start + limit)
    return Promise.resolve({ ids: page, hasMore: start + limit < ids.length })
  }
}

export class FakeStore implements BlobStore {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  puts = 0
  put(path: string, bytes: Uint8Array, contentType: string) {
    this.puts++
    this.objects.set(path, { bytes, contentType })
    return Promise.resolve()
  }
}

export const attachment = (
  id: string,
  over: Partial<AttachmentMeta> = {},
): AttachmentMeta => ({
  id,
  filename: `${id}.pdf`,
  size: 12,
  contentType: 'application/pdf',
  disposition: 'attachment',
  contentId: null,
  downloadUrl: `https://files.example/${id}`,
  ...over,
})

export class FakeMailer implements Mailer {
  sent: OutgoingPayload[] = []
  byKey = new Map<string, string>()
  fail = false
  send(payload: OutgoingPayload, opts: { idempotencyKey: string }) {
    if (this.fail) return Promise.reject(new Error('provider down'))
    const known = this.byKey.get(opts.idempotencyKey)
    if (known) return Promise.resolve({ id: known }) // idempotent: not sent again
    const id = `sent_${this.byKey.size + 1}`
    this.byKey.set(opts.idempotencyKey, id)
    this.sent.push(payload)
    return Promise.resolve({ id })
  }
}

export class FakeBlobs implements BlobIO {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  failNextPut = false
  put(path: string, bytes: Uint8Array, contentType: string) {
    if (this.failNextPut) {
      this.failNextPut = false
      return Promise.reject(new Error('storage down'))
    }
    this.objects.set(path, { bytes, contentType })
    return Promise.resolve()
  }
  download(path: string) {
    const o = this.objects.get(path)
    return o ? Promise.resolve(o.bytes) : Promise.reject(new Error('missing'))
  }
  remove(paths: string[]) {
    for (const p of paths) this.objects.delete(p)
    return Promise.resolve()
  }
  seed(path: string, text: string, contentType = 'application/octet-stream') {
    this.objects.set(path, {
      bytes: new TextEncoder().encode(text),
      contentType,
    })
  }
}
