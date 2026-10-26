import sanitizeHtml from 'sanitize-html'

/**
 * Mail HTML is hostile input. This is the first of two layers: a server-side
 * allowlist sanitizer. The second is the sandboxed, CSP-locked iframe the client
 * renders it in. The result is never inserted into the app's own DOM.
 */
const TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'big',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'wbr',
]

const GLOBAL_ATTRS = [
  'style',
  'class',
  'id',
  'dir',
  'lang',
  'align',
  'valign',
  'bgcolor',
  'color',
]

export interface RenderedMail {
  /** Sanitized HTML fragment, safe only inside the sandboxed iframe. */
  html: string
  /** True when it references remote images, so the UI offers "Load images". */
  hasRemoteContent: boolean
}

export function sanitizeMailHtml(html: string): RenderedMail {
  const clean = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: {
      '*': GLOBAL_ATTRS,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'border'],
      table: [
        'width',
        'height',
        'border',
        'cellpadding',
        'cellspacing',
        'background',
      ],
      td: ['width', 'height', 'colspan', 'rowspan', 'background', 'nowrap'],
      th: ['width', 'height', 'colspan', 'rowspan', 'background', 'nowrap'],
      tr: ['background'],
      font: ['face', 'size'],
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
      ol: ['start', 'type'],
      li: ['value'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // Drop the text of these entirely (a <title> would otherwise show up as body text).
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'title'],
    // <style> content is not sanitized by the library; it is neutralized by the
    // iframe CSP (no remote CSS, fonts or images unless the user opts in).
    allowVulnerableTags: true,
    transformTags: {
      a: (tag, attribs) => ({
        tagName: tag,
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      }),
    },
  })
  const hasRemoteContent =
    /<img[^>]+src\s*=\s*["']?https?:/i.test(clean) ||
    /\bbackground\s*=\s*["']?https?:/i.test(clean) ||
    /url\(\s*["']?https?:/i.test(clean)
  return { html: clean, hasRemoteContent }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Plain-text mail goes through the same iframe, escaped. */
export function textToHtml(text: string): RenderedMail {
  return {
    html: `<pre style="white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0">${escapeHtml(text)}</pre>`,
    hasRemoteContent: false,
  }
}

export function renderMessageBody(m: {
  htmlBody: string | null
  textBody: string | null
}): RenderedMail {
  if (m.htmlBody?.trim()) return sanitizeMailHtml(m.htmlBody)
  return textToHtml(m.textBody ?? '')
}

/**
 * Original HTML placed inside an outgoing reply/forward. Stricter than display:
 * no <style> and no images at all, so a tracking pixel in the original is never
 * re-sent to our recipients.
 */
export function quoteHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: TAGS.filter((t) => t !== 'style' && t !== 'img'),
    allowedAttributes: {
      '*': ['style', 'dir', 'lang', 'align'],
      a: ['href'],
      table: ['width', 'border', 'cellpadding', 'cellspacing'],
      td: ['width', 'colspan', 'rowspan'],
      th: ['width', 'colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title'],
  })
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** Visible text of an HTML mail, for quoting when there is no text part. */
export function htmlToPlainText(html: string): string {
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title'],
  })
  return stripped
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
