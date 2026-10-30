// Light and dark: every main screen renders in both without console errors (the fixture checks it), and a full-page
// screenshot of each goes to e2e-web/screenshots/ (gitignored) for the design review.
import { expect, openFixture, test } from './fixtures'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('./screenshots/', import.meta.url))

const screens: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: 'new-search', open: async (p) => (await p.goto('/#/search'), await expect(p.getByTestId('settings-summary')).toBeVisible()) },
  {
    name: 'new-search-advanced',
    open: async (p) => {
      await p.goto('/#/search')
      await p.getByRole('button', { name: 'Advanced settings' }).click()
      await expect(p.getByTestId('advanced-settings')).toBeVisible()
    },
  },
  {
    name: 'new-search-project',
    open: async (p) => {
      await p.goto('/#/search')
      const chooser = p.waitForEvent('filechooser')
      await p.getByTestId('open-setup').click()
      const setup = {
        format: 'prose-setup', schema: 1, name: 'exp',
        inputs: [{ path: '/data/run_1.mzML', name: 'run_1.mzML', size: 1000, condition: 'a' }],
        database: { path: '/db/ecoli.fasta', name: 'ecoli.fasta', size: 5000, proteome: null },
        presetId: 'orbitrap-hcd-tryptic', parameters: {}, ui: { view: 'search', showSettings: false, advanced: false },
      }
      await (await chooser).setFiles({ name: 'exp.prose-setup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(setup)) })
      await expect(p.getByTestId('project-name')).toHaveText('Project: exp')
    },
  },
  {
    // File › New Search with unsaved project changes (a desktop menu item: opened here through the module)
    name: 'dialog-new-project',
    open: async (p) => {
      await p.goto('/#/search')
      await expect(p.getByTestId('settings-summary')).toBeVisible()
      await p.evaluate(async (path) => {
        // (the dev server's module: the page's own instance)
        const m = await import(/* @vite-ignore */ path)
        m.project.name = 'exp'
        m.project.confirmNew = true
      }, '/src/lib/project/project.svelte.ts')
      await expect(p.getByTestId('new-setup-guard')).toBeVisible()
    },
  },
  {
    name: 'dialog-all-parameters',
    open: async (p) => {
      await p.goto('/#/search')
      await p.getByRole('button', { name: /^All \d+ parameters/ }).click()
      await expect(p.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'dialog-shortcuts',
    open: async (p) => {
      await p.goto('/#/search')
      await expect(p.getByTestId('settings-summary')).toBeVisible()
      await p.keyboard.press('?')
      await expect(p.getByRole('dialog')).toBeVisible()
    },
  },
  // (Results scrolls inside the window: a taller window shows all of Overview and QC)
  { name: 'results-overview', open: async (p) => (await p.setViewportSize({ width: 1400, height: 1500 }), await openFixture(p), await p.getByRole('tab', { name: 'Overview' }).click(), await expect(p.getByTestId('search-facts')).toBeVisible()) },
  { name: 'results-proteins', open: async (p) => (await openFixture(p), await p.getByRole('tab', { name: /^Proteins/ }).click()) },
  {
    name: 'results-protein-panel',
    open: async (p) => {
      await openFixture(p)
      await p.getByRole('tab', { name: /^Proteins/ }).click()
      await p.getByTestId('results-table').locator('tbody tr').first().click()
      await expect(p.getByTestId('protein-panel')).toBeVisible()
    },
  },
  { name: 'results-peptides', open: async (p) => (await openFixture(p), await p.getByRole('tab', { name: /^Peptides/ }).click()) },
  { name: 'results-psms', open: async (p) => (await openFixture(p), await p.getByRole('tab', { name: /^PSMs/ }).click()) },
  {
    name: 'results-spectrum',
    open: async (p) => {
      await openFixture(p)
      await p.getByRole('tab', { name: /^PSMs/ }).click()
      await p.getByTestId('results-table').locator('tbody tr').first().click()
      await expect(p.getByTestId('spectrum')).toBeVisible()
    },
  },
  { name: 'results-samples', open: async (p) => (await openFixture(p), await p.getByRole('tab', { name: 'Samples' }).click()) },
  { name: 'results-qc', open: async (p) => (await p.setViewportSize({ width: 1400, height: 1300 }), await openFixture(p), await p.getByRole('tab', { name: 'QC' }).click(), await expect(p.getByTestId('qc-content')).toBeVisible()) },
  { name: 'history', open: async (p) => (await openFixture(p), await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click(), await expect(p.getByTestId('history-row')).toBeVisible()) },
  { name: 'history-unavailable', open: async (p) => (await p.goto('/#/history'), await expect(p.getByTestId('history-unavailable')).toBeVisible()) },
  ...['troubleshooting', 'results', 'fdr', 'settings', 'formats', 'basics', 'learn'].map((page) => ({
    name: `help-${page}`,
    open: async (p: Page) => (await p.goto(`/#/help/${page}`), await expect(p.getByTestId(`help-page-${page}`)).toHaveAttribute('aria-current', 'page')),
  })),
]

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    // (reduced motion: the animations of Help hold still for the screenshots)
    test.use({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const s of screens) {
      test(s.name, async ({ page }) => {
        await s.open(page)
        await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
        // (the colour as painted: the theme's colours are oklch())
        const [background, luminance] = await page.evaluate(() => {
          const colour = getComputedStyle(document.body).backgroundColor
          const ctx = document.createElement('canvas').getContext('2d')!
          ctx.fillStyle = colour
          ctx.fillRect(0, 0, 1, 1)
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
          return [colour, (r + g + b) / 3] as const
        })
        if (scheme === 'dark') expect(luminance, `body background ${background}`).toBeLessThan(80)
        else expect(luminance, `body background ${background}`).toBeGreaterThan(180)
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${dir}${s.name}-${scheme}.png`, fullPage: true, animations: 'disabled' })
      })
    }
  })
}

test('the theme menu switches to dark and back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/#/search')
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  await page.getByTestId('theme-menu').click()
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  // (the menu of radio items stays open after a choice)
  await page.keyboard.press('Escape')
  await page.getByTestId('theme-menu').click()
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  // kept: a reload stays light although the system is dark
  await page.keyboard.press('Escape')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByTestId('settings-summary')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
})
