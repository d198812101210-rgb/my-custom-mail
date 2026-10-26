import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_PATHS } from '../src/server/auth/public-paths'
import { STATIC_SECURITY_HEADERS } from '../src/server/security-headers'
import { buildCsp, harden } from '../src/server/security.server'

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : []
  })
}
const srcFiles = files('src', /\.(ts|tsx)$/).filter(
  (f) => !f.endsWith('routeTree.gen.ts'),
)
const read = (f: string) => readFileSync(f, 'utf8')

describe('source audit', () => {
  it('never builds SQL from strings or evaluates code', () => {
    for (const f of srcFiles) {
      const code = read(f)
      expect(code, f).not.toMatch(/sql\.raw\(/)
      expect(code, f).not.toMatch(/\beval\(|new Function\(/)
      expect(code, f).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=/,
      )
    }
  })

  it('only logs through console.error, and only where reviewed', () => {
    const allowed = new Set([
      'src/routes/api/webhooks/resend.ts',
      'src/server/mail.fn.ts',
      'src/server/compose.fn.ts',
      'src/server/push.server.ts',
    ])
    for (const f of srcFiles) {
      const uses = read(f).match(/console\.\w+/g) ?? []
      if (uses.length === 0) continue
      expect(allowed.has(relative('.', f)), `${f} uses console`).toBe(true)
      expect(
        uses.every((u) => u === 'console.error'),
        f,
      ).toBe(true)
    }
  })

  it('reads process.env only in the places that validate or need NODE_ENV', () => {
    const allowed = new Set([
      'src/env.server.ts', // the validated source of truth
      'src/db/client.ts', // NODE_ENV: reuse the connection across dev reloads
      'src/start.ts', // NODE_ENV: CSP only in production
    ])
    for (const f of srcFiles) {
      if (!/process\.env/.test(read(f))) continue
      expect(allowed.has(relative('.', f)), `${f} reads process.env`).toBe(true)
    }
  })

  it('has exactly the intended public routes', () => {
    expect([...PUBLIC_PATHS].sort()).toEqual([
      '/api/auth/request',
      '/api/auth/verify',
      '/api/webhooks/resend',
      '/login',
    ])
  })

  it('has no API route that is public without being on the public list', () => {
    // Every file under src/routes/api maps to a path; only reviewed ones may exist.
    const routes = files('src/routes/api', /\.ts$/).map(
      (f) => '/' + relative('src/routes', f).replace(/\.ts$/, ''),
    )
    const protectedRoutes = new Set(['/api/attachments/$id'])
    for (const r of routes) {
      expect(
        PUBLIC_PATHS.has(r) || protectedRoutes.has(r),
        `unreviewed API route ${r}`,
      ).toBe(true)
    }
    // And protected routes must not have slipped onto the public list.
    for (const r of protectedRoutes) expect(PUBLIC_PATHS.has(r)).toBe(false)
  })

  it('validates the input of every server function that takes input', () => {
    const noInput = new Set([
      'logout',
      'logoutEverywhere',
      'unreadCountsFn',
      'pushConfigFn',
      'testPushFn',
    ])
    for (const f of srcFiles.filter((p) => p.endsWith('.fn.ts'))) {
      const code = read(f)
      const decls = code.split(/export const /).slice(1)
      for (const d of decls) {
        if (!d.includes('createServerFn')) continue
        const name = d.slice(0, d.indexOf(' '))
        if (noInput.has(name)) continue
        expect(
          d.includes('.validator('),
          `${f}: ${name} has no validator`,
        ).toBe(true)
      }
    }
  })

  it('does not import server-only modules from client code', () => {
    const clientDirs = ['src/components', 'src/lib']
    for (const f of clientDirs.flatMap((d) => files(d, /\.(ts|tsx)$/))) {
      expect(read(f), f).not.toMatch(/\.server['"]|#\/db\/|#\/env/)
    }
  })
})

describe('content security policy', () => {
  const csp = buildCsp({
    nonce: 'abc123',
    supabaseOrigin: 'https://x.supabase.co',
  })
  const directive = (name: string) =>
    csp
      .split('; ')
      .find((d) => d.startsWith(`${name} `))
      ?.slice(name.length + 1)

  it('allows scripts only from self and the request nonce', () => {
    expect(directive('script-src')).toBe("'self' 'nonce-abc123'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('forbids framing, plugins and base tag changes', () => {
    expect(directive('frame-ancestors')).toBe("'none'")
    expect(directive('object-src')).toBe("'none'")
    expect(directive('base-uri')).toBe("'none'")
    expect(directive('default-src')).toBe("'self'")
  })

  it('only lets the browser talk to itself and Supabase Storage', () => {
    expect(directive('connect-src')).toBe("'self' https://x.supabase.co")
  })
})

describe('harden', () => {
  const opts = {
    nonce: 'n',
    supabaseOrigin: 'https://x.supabase.co',
    production: true,
  }

  it('adds CSP to html and security headers and no-store to everything', async () => {
    const res = harden(
      new Response('<p>hi</p>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'a=b; HttpOnly',
        },
      }),
      opts,
    )
    expect(res.headers.get('content-security-policy')).toContain("'nonce-n'")
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS))
      expect(res.headers.get(k)).toBe(v)
    expect(res.headers.get('set-cookie')).toBe('a=b; HttpOnly')
    expect(await res.text()).toBe('<p>hi</p>')
  })

  it('keeps status and does not put a page CSP on JSON', () => {
    const res = harden(
      Response.json({ error: 'unauthorized' }, { status: 401 }),
      opts,
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('works on redirects and omits the CSP outside production', () => {
    const redirect = harden(
      new Response(null, { status: 302, headers: { Location: '/login' } }),
      opts,
    )
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/login')
    const dev = harden(
      new Response('x', { headers: { 'content-type': 'text/html' } }),
      {
        ...opts,
        production: false,
      },
    )
    expect(dev.headers.get('content-security-policy')).toBeNull()
  })

  it('has the headers the brief asks for', () => {
    expect(STATIC_SECURITY_HEADERS['x-content-type-options']).toBe('nosniff')
    expect(STATIC_SECURITY_HEADERS['referrer-policy']).toBeTruthy()
    expect(STATIC_SECURITY_HEADERS['strict-transport-security']).toMatch(
      /max-age=\d{7,}/,
    )
  })
})
