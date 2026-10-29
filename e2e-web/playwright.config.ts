// The browser UI tests (npm run test:ui): the page in Chromium against the Vite dev server, in the page's browser
// mode (no Tauri; History in memory). `?fixture=<name>` opens a result of src/lib/results/fixtures (src/lib/dev/
// fixture.ts, dev only). The desktop app's own end-to-end tests are e2e/ (WebdriverIO, tauri-driver, Linux only).
import { defineConfig, devices } from '@playwright/test'

const port = 5179

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: './report' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}/`,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: '..',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
