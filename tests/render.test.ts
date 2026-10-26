import { describe, expect, it } from 'vitest'
import {
  renderMessageBody,
  sanitizeMailHtml,
  textToHtml,
} from '../src/server/mail/render'

const clean = (html: string) => sanitizeMailHtml(html).html

describe('sanitizeMailHtml', () => {
  it('removes script elements and their content', () => {
    const out = clean('<p>hi</p><script>alert(1)</script>')
    expect(out).toBe('<p>hi</p>')
  })

  it.each([
    [
      'inline event handler',
      '<img src="data:image/png;base64,AAAA" onerror="alert(1)">',
    ],
    ['onclick', '<p onclick="alert(1)">x</p>'],
    ['svg onload', '<svg onload="alert(1)"><circle/></svg>'],
    ['body onload', '<body onload="alert(1)">x</body>'],
  ])('strips %s', (_name, html) => {
    expect(clean(html).toLowerCase()).not.toMatch(/\bon\w+\s*=/)
    expect(clean(html).toLowerCase()).not.toContain('<svg')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('drops dangerous href %j', (href) => {
    const out = clean(`<a href="${href}">x</a>`)
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('vbscript:')
    expect(out.toLowerCase()).not.toContain('data:text')
  })

  it.each([
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'link',
    'meta',
    'base',
    'frame',
    'applet',
  ])('removes <%s>', (tag) => {
    const out = clean(
      `<${tag} src="https://evil.example" href="https://evil.example" action="https://evil.example"></${tag}>ok`,
    )
    expect(out).not.toContain(`<${tag}`)
    expect(out).toContain('ok')
  })

  it('removes meta refresh', () => {
    expect(
      clean(
        '<meta http-equiv="refresh" content="0;url=https://evil.example">x',
      ),
    ).not.toContain('meta')
  })

  it('forces links to open in a new context without referrer', () => {
    const out = clean('<a href="https://example.com/x" target="_self">go</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('noopener')
    expect(out).toContain('noreferrer')
  })

  it('does not allow protocol-relative image urls', () => {
    expect(clean('<img src="//evil.example/p.gif">')).not.toContain(
      'evil.example',
    )
  })

  it('drops document wrappers and the title text', () => {
    const out = clean(
      '<html><head><title>SECRET TITLE</title></head><body><p>hi</p></body></html>',
    )
    expect(out).toBe('<p>hi</p>')
  })

  it('keeps data: images but not data: links', () => {
    expect(clean('<img src="data:image/png;base64,AAAA">')).toContain(
      'data:image/png',
    )
  })

  it('keeps formatting that newsletters rely on', () => {
    const out = clean(
      '<style>.a{color:red}</style><table width="100%" cellpadding="0"><tr><td style="padding:4px" bgcolor="#fff">x</td></tr></table>',
    )
    expect(out).toContain('<style>')
    expect(out).toContain('.a{color:red}')
    expect(out).toContain('padding:4px')
    expect(out).toContain('<table')
  })

  it('flags remote images, remote backgrounds and remote css urls', () => {
    expect(
      sanitizeMailHtml('<img src="https://t.example/p.gif">').hasRemoteContent,
    ).toBe(true)
    expect(
      sanitizeMailHtml('<td background="https://t.example/b.png">x</td>')
        .hasRemoteContent,
    ).toBe(true)
    expect(
      sanitizeMailHtml(
        '<div style="background:url(https://t.example/b.png)">x</div>',
      ).hasRemoteContent,
    ).toBe(true)
    expect(
      sanitizeMailHtml('<img src="data:image/png;base64,AAAA">')
        .hasRemoteContent,
    ).toBe(false)
    expect(sanitizeMailHtml('<p>text only</p>').hasRemoteContent).toBe(false)
  })
})

describe('plain text', () => {
  it('escapes markup so text can never become elements', () => {
    const out = textToHtml('<script>alert(1)</script> & "q"').html
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&amp;')
  })

  it('prefers html, falls back to text', () => {
    expect(
      renderMessageBody({ htmlBody: '<b>x</b>', textBody: 'plain' }).html,
    ).toContain('<b>x</b>')
    expect(
      renderMessageBody({ htmlBody: '  ', textBody: 'plain' }).html,
    ).toContain('plain')
    expect(
      renderMessageBody({ htmlBody: null, textBody: null }).html,
    ).toContain('<pre')
  })
})
