import { useMemo, useRef, useState } from 'react'
import { MAIL_FRAME_SANDBOX, buildSrcDoc } from '#/lib/mail-frame'

/**
 * Renders a message body. The HTML was sanitized on the server and is shown only
 * inside this sandboxed iframe (no allow-scripts) with a restrictive CSP, so it
 * never touches the app's own DOM.
 */
export function MailFrame({
  html,
  loadImages,
}: {
  html: string
  loadImages: boolean
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)
  const srcDoc = useMemo(
    () => buildSrcDoc(html, loadImages),
    [html, loadImages],
  )

  function fit() {
    const doc = ref.current?.contentDocument
    if (!doc) return
    setHeight(Math.max(60, doc.documentElement.scrollHeight))
  }

  return (
    <iframe
      ref={ref}
      title="Message body"
      sandbox={MAIL_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={fit}
      style={{ height }}
      className="w-full rounded border-0 bg-white"
    />
  )
}
