// Screenshots of the app for docs/screens (not part of the e2e run: the name has no `.spec.`).
//   e2e/run.sh e2e/screens.shot.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const dir = resolve(fileURLToPath(new URL('../docs/screens', import.meta.url)))

describe('screens', () => {
  it('01-shell', async () => {
    await $('header').waitForDisplayed({ timeout: 20000 })
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, '01-shell.png'), Buffer.from(await browser.takeScreenshot(), 'base64'))
  })
})
