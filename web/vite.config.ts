/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const webDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(webDir, 'src')

// The Basis Universal transcoder that three's KTX2Loader runs in its workers (GPU-compressed map
// textures, src/features/match-replay/scene3d/ktx2Textures3d.ts). It is served by the app, never a
// CDN, under the build's own assets/ folder with fixed names (the loader asks for them by name);
// tools/package.ps1 stages that folder's files into the release.
const basisDir = path.resolve(webDir, 'node_modules/three/examples/jsm/libs/basis')
const BASIS_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm']

function basisTranscoder(): Plugin {
  return {
    name: 'it3d-basis-transcoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const file = BASIS_FILES.find((f) => url === `${server.config.base}assets/${f}`)
        if (!file) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(fs.readFileSync(path.join(basisDir, file)))
      })
    },
    generateBundle() {
      for (const f of BASIS_FILES) {
        this.emitFile({ type: 'asset', fileName: `assets/${f}`, source: fs.readFileSync(path.join(basisDir, f)) })
      }
    },
  }
}

// The server the dev proxy forwards to; IT3D_API_TARGET points a second dev server at another one.
const apiTarget = process.env.IT3D_API_TARGET ?? 'http://127.0.0.1:8177'

export default defineConfig({
  plugins: [react(), tailwindcss(), basisTranscoder()],
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
        target: apiTarget,
        changeOrigin: true,
      },
      // Game-derived assets the server builds into the data folder (weapon icons).
      '/static': {
        target: apiTarget,
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
