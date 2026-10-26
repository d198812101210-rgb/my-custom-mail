import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // CSRF is enforced for every mutating request (server functions included)
    // by the Origin check in src/start.ts, so Start's default warning does not apply.
    tanstackStart({ serverFns: { disableCsrfMiddlewareWarning: true } }),
    nitro({
      routeRules: {
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
