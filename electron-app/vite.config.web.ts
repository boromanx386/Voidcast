import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's inline-CSS (html-proxy) cache keys are case-sensitive, but Windows
// paths are not: a launcher cwd like `q:\...` leaves root lowercase while
// resolved ids come back realpath-canonical (`Q:\...`), and the inline <style>
// lookup misses. Pin root and entry to the real on-disk casing.
const ROOT = fs.realpathSync.native(__dirname)

/** Standalone web build served by FastAPI from `tts-server/web-ui` (phone / LAN browser). */
export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_TARGET': JSON.stringify('web'),
  },
  root: ROOT,
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  plugins: [react()],
  base: '/',
  publicDir: 'public',
  build: {
    outDir: '../tts-server/web-ui',
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(ROOT, 'index.web.html'),
    },
  },
})
