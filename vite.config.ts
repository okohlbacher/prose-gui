/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Tauri serves the build from its own protocol, and `tauri dev` loads the dev server
  clearScreen: false,
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  server: { port: 1420, strictPort: true },
  // one bundle, loaded from disk by the app (the modification and chemistry tables are in it)
  build: { chunkSizeWarningLimit: 2000 },
  // the unit tests (e2e/ has the WebdriverIO specs of the app)
  test: { include: ['src/**/*.test.ts'] },
})
