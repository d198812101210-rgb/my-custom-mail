/** Provider-neutral shapes, so ingestion can be tested without Resend or Supabase. */
export interface ReceivedEmail {
  id: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  receivedFor: string[]
  subject: string
  html: string | null
  text: string | null
  headers: Record<string, string> | null
  messageId: string | null
  createdAt: Date
}

export interface AttachmentMeta {
  id: string
  filename: string | null
  size: number
  contentType: string
  disposition: string | null
  contentId: string | null
  downloadUrl: string
}

export interface MailSource {
  getReceived: (id: string) => Promise<ReceivedEmail>
  listAttachments: (emailId: string) => Promise<AttachmentMeta[]>
  download: (url: string) => Promise<Uint8Array>
  /** Newest first. `after` is the id of the last item of the previous page. */
  listReceived: (opts: {
    limit: number
    after?: string
  }) => Promise<{ ids: string[]; hasMore: boolean }>
}

export interface BlobStore {
  put: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>
}
