/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    port: 5183,
    strictPort: true,
    // The standalone Go server (`infinite-theater-3d serve`) owns the data: matches,
    // replay documents and map meshes. Proxying keeps the app on relative `/api/...`
    // URLs so the same build works unchanged once `serve --web` serves this bundle
    // itself (no proxy needed then — same origin).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8177',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.ts'],
  },
})
