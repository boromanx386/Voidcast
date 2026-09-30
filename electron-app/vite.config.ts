import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json'

/**
 * Production CSP. This is the policy that ships: no `unsafe-eval`, no `unsafe-inline`
 * for scripts, no object/base/form embedding. `connect-src` stays deliberately open —
 * the renderer talks directly to user-configured providers (OpenRouter, Ollama, Runware,
 * DeepSeek, NVIDIA, the local tools server, LAN web), so enumerating hosts would break
 * chat/image/TTS whenever a base URL changes. `style-src` keeps `unsafe-inline` for the
 * inline <style> block in index.html and React inline styles.
 *
 * NOTE: `frame-ancestors` is intentionally omitted — a <meta>-delivered CSP cannot carry
 * it (browsers ignore it there); it is only honoured as a real HTTP header.
 */
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

/**
 * Dev widens the strict policy by exactly one token: React-refresh injects an inline
 * preamble, so the dev server needs `'unsafe-inline'`. Vite 5's native-ESM dev server
 * needs no `eval`, so `'unsafe-eval'` stays out even in development.
 */
const CSP_DEV = CSP_PROD.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
)

/**
 * Swap the CSP meta for a loosened one on the dev server only. The build keeps the strict
 * policy already present in index.html, so production never carries `unsafe-eval`.
 */
function cspMeta(isServe: boolean): Plugin {
  return {
    name: 'voidcast-csp-meta',
    transformIndexHtml(html) {
      if (!isServe) return html
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[\s\S]*?>/i,
        `<meta http-equiv="Content-Security-Policy" content="${CSP_DEV}" />`,
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src')
      },
    },
    plugins: [
      react(),
      cspMeta(isServe),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: 'electron/main/index.ts',
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(/* For `.vscode/.debug.script.mjs` */'[startup] Electron App')
            } else {
              args.startup()
            }
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: Object.keys('dependencies' in pkg ? pkg.dependencies : {}),
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: 'electron/preload/index.ts',
          vite: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: Object.keys('dependencies' in pkg ? pkg.dependencies : {}),
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
    ],
    server: process.env.VSCODE_DEBUG && (() => {
      const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
      return {
        host: url.hostname,
        port: +url.port,
      }
    })(),
    clearScreen: false,
  }
})
