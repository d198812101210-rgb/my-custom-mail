import { describeError } from '../log'
import { existingResendIds, ingestReceivedEmail } from './ingest'
import type { IngestDeps } from './ingest'

export interface SyncResult {
  scanned: number
  imported: number
  failed: number
}

const PAGE_SIZE = 100
const MAX_PAGES = 10

/**
 * Pulls received emails from Resend and imports the ones we do not have
 * (backfill after downtime, or recovery after a failed webhook).
 *
 * By default it stops at the first page where everything is already stored.
 * `full` walks up to MAX_PAGES pages regardless.
 */
export async function syncReceivedEmails(
  deps: IngestDeps,
  opts: { full?: boolean; log?: (line: string) => void } = {},
): Promise<SyncResult> {
  const log = opts.log ?? (() => undefined)
  const result: SyncResult = { scanned: 0, imported: 0, failed: 0 }
  let after: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const { ids, hasMore } = await deps.mail.listReceived({
      limit: PAGE_SIZE,
      after,
    })
    result.scanned += ids.length
    const have = await existingResendIds(deps.db, ids)
    const missing = ids.filter((id) => !have.has(id))

    for (const id of missing) {
      try {
        if ((await ingestReceivedEmail(deps, id)) === 'imported')
          result.imported++
      } catch (e) {
        result.failed++
        log(`sync: failed to import an email: ${describeError(e)}`)
      }
    }

    const last = ids.at(-1)
    if (!hasMore || last === undefined) break
    if (missing.length === 0 && !opts.full) break
    after = last
  }
  return result
}
