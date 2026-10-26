/**
 * Builds the document shown inside the sandboxed iframe. `bodyHtml` must already
 * be sanitized by the server. The CSP is the second line of defence: nothing but
 * inline styles and data: images loads, so remote images (tracking pixels), remote
 * CSS, fonts, frames, forms and scripts are all blocked until the user opts in to images.
 */
export function mailFrameCsp(loadImages: boolean): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    loadImages ? 'img-src data: https:' : 'img-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

export function buildSrcDoc(bodyHtml: string, loadImages: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${mailFrameCsp(loadImages)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0}body{padding:12px;background:#fff;color:#111;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#1a56db}</style>
</head><body>${bodyHtml}</body></html>`
}

/** Sandbox flags: scripts are never allowed. */
export const MAIL_FRAME_SANDBOX =
  'allow-same-origin allow-popups allow-popups-to-escape-sandbox'
