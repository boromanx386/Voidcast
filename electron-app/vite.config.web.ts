import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Standalone web build served by FastAPI from `tts-server/web-ui` (phone / LAN browser). */
export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_TARGET': JSON.stringify('web'),
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  plugins: [react()],
  base: '/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: '../tts-server/web-ui',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.web.html'),
    },
  },
})
