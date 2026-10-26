import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ThreadList } from '#/components/ThreadList'
import { listThreadsFn } from '#/server/threads.fn'

const FOLDERS = ['inbox', 'archive', 'sent', 'trash'] as const
type FolderParam = (typeof FOLDERS)[number]

const EMPTY: Record<FolderParam, string> = {
  inbox: 'Inbox zero. Nothing here.',
  archive: 'Nothing archived.',
  sent: 'Nothing sent yet.',
  trash: 'Trash is empty.',
}

function parseFolder(value: string): FolderParam {
  const found = FOLDERS.find((f) => f === value)
  if (!found) throw notFound()
  return found
}

export const Route = createFileRoute('/_app/$folder')({
  loader: async ({ params }) => {
    const folder = parseFolder(params.folder)
    return { folder, page: await listThreadsFn({ data: { folder } }) }
  },
  component: FolderPage,
})

function FolderPage() {
  const { folder, page } = Route.useLoaderData()
  // Not via route `head`: using loader data there breaks type inference for this route.
  useEffect(() => {
    document.title = `${folder} · Mailbox`
  }, [folder])
  return (
    <main>
      <h2 className="px-4 pt-3 text-sm font-medium text-dim capitalize">
        {folder}
      </h2>
      <ThreadList
        key={folder}
        initial={page}
        scope={{ folder }}
        empty={EMPTY[folder]}
      />
    </main>
  )
}
