import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve('src/shared'),
  '@plugins': resolve('plugins')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two preloads: the browser chrome UI, and web content views.
        // They have completely different privileges — never merge them.
        input: {
          chrome: resolve('src/preload/chrome.ts'),
          content: resolve('src/preload/content.ts')
        }
      }
    },
    resolve: { alias }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // Two renderers: the browser chrome, and the omnibox dropdown — which
        // must be its own native view to draw over the page. See
        // main/windows/overlay.ts.
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          splitter: resolve('src/renderer/splitter.html')
        }
      }
    },
    resolve: {
      alias: { ...alias, '@renderer': resolve('src/renderer/src') }
    }
  }
})
