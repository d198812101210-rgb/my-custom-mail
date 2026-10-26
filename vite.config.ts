import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { STATIC_SECURITY_HEADERS } from './src/server/security-headers'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // CSRF is enforced for every mutating request (server functions included)
    // by the Origin check in src/start.ts, so Start's default warning does not apply.
    tanstackStart({ serverFns: { disableCsrfMiddlewareWarning: true } }),
    nitro({
      routeRules: {
        // Headers for static files too; dynamic responses also get the CSP in src/start.ts.
        '/**': { headers: STATIC_SECURITY_HEADERS },
        // A cached service worker would delay every update by up to a day.
        '/sw.js': {
          headers: {
            'cache-control': 'no-cache, max-age=0, must-revalidate',
            'service-worker-allowed': '/',
          },
        },
        '/manifest.webmanifest': {
          headers: {
            'content-type': 'application/manifest+json',
            'cache-control': 'public, max-age=0, must-revalidate',
          },
        },
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
})
