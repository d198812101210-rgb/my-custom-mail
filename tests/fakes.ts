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
