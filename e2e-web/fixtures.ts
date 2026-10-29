// The tests' page: every console error and uncaught exception of the page fails the test that saw it.
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`))
      await use(errors)
      expect(errors, 'console errors of the page').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

/** Opens the bundled fixture result `name` in Results (the dev hook `?fixture=`). */
export async function openFixture(page: Page, name = 'example'): Promise<void> {
  await page.goto(`/?fixture=${name}#/results`)
  await expect(page.getByTestId('results-tabs')).toBeVisible()
}

/** The modifier of the app's shortcuts: ⌘ on macOS, Ctrl elsewhere (Shortcuts.svelte). */
export const MOD = 'ControlOrMeta'
