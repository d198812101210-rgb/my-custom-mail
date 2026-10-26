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
    nitro(),
    viteReact(),
    tailwindcss(),
  ],
})
