// Help: its seven pages, a deep link, the search of the questions, "What to do ›" from a finding, the animations.
import { expect, openFixture, test } from './fixtures'

const pages = [
  ['troubleshooting', 'Troubleshooting'],
  ['results', 'Reading the results'],
  ['fdr', 'Decoys and the FDR'],
  ['settings', 'The settings'],
  ['formats', 'File formats'],
  ['basics', 'How a search works'],
  ['learn', 'Videos and links'],
] as const

test('the seven pages of Help', async ({ page }) => {
  await page.goto('/#/help')
  const nav = page.locator('[data-testid^="help-page-"]')
  await expect(nav).toHaveText(pages.map(([, label]) => label))
  for (const [id] of pages) {
    await page.getByTestId(`help-page-${id}`).click()
    await expect(page).toHaveURL(new RegExp(`#/help/${id}$`))
    await expect(page.getByTestId(`help-page-${id}`)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('help-page').getByRole('heading', { level: 2 }).first()).toBeVisible()
  }
})

test('a deep link opens its page: #/help/troubleshooting', async ({ page }) => {
  await page.goto('/#/help/fdr')
  await expect(page.getByTestId('help-page-fdr')).toHaveAttribute('aria-current', 'page')
  await page.goto('/#/help/troubleshooting')
  await expect(page.getByTestId('help-page-troubleshooting')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('faq-search')).toBeVisible()
})

test('the search of the questions', async ({ page }) => {
  await page.goto('/#/help/troubleshooting')
  const entries = page.locator('details.faq')
  const all = await entries.count()
  expect(all).toBeGreaterThan(10)
  await page.getByTestId('faq-search').fill('profile')
  const visible = entries.filter({ visible: true })
  await expect(visible.first()).toBeVisible()
  const shown = await visible.count()
  expect(shown).toBeLessThan(all)
  for (const e of await visible.all()) await expect(e).toHaveAttribute('open', '')
  await expect(visible.filter({ hasText: 'MS2 spectra flagged as profile' })).toHaveCount(1)
  await page.getByTestId('faq-search').fill('zzzz no such words')
  await expect(page.getByText('No entry matches.')).toBeVisible()
})

test('"What to do ›" beside a finding opens its entry in Troubleshooting', async ({ page }) => {
  await openFixture(page)
  await page.getByRole('tab', { name: 'Overview' }).click()
  const link = page.getByTestId('faq-link').first()
  await expect(link).toHaveText('What to do ›')
  await link.click()
  await expect(page).toHaveURL(/#\/help\/troubleshooting$/)
  const entry = page.locator('details.faq[open]').filter({ hasText: 'My mass errors are off-centre' })
  await expect(entry).toHaveCount(1)
  await expect(entry).toBeInViewport()
  await expect(entry.locator('summary')).toBeFocused()
})

test('the animations play and pause', async ({ page }) => {
  await page.goto('/#/help/basics')
  const controls = page.getByRole('group', { name: /animation controls$/ })
  await expect(controls).toHaveCount(2)
  const fragmentation = page.getByRole('group', { name: 'Fragmentation: animation controls' })
  const toggle = fragmentation.getByRole('button', { name: /^(Play|Pause)$/ })
  await expect(toggle).toHaveText('Pause')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveText('Play')
  const step = fragmentation.getByText(/^Step \d+ of \d+$/)
  const at = await step.textContent()
  await page.waitForTimeout(2000)
  await expect(step).toHaveText(at!)
  await fragmentation.getByRole('button', { name: 'Next step' }).click()
  await expect(step).not.toHaveText(at!)
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('the animations start paused', async ({ page }) => {
    await page.goto('/#/help/basics')
    for (const name of ['Fragmentation', 'Matching']) {
      const group = page.getByRole('group', { name: `${name}: animation controls` })
      const toggle = group.getByRole('button', { name: /^(Play|Pause)$/ })
      await expect(toggle).toHaveText('Play')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      const step = group.getByText(/^Step \d+ of \d+$/)
      const at = await step.textContent()
      await page.waitForTimeout(2200)
      await expect(step).toHaveText(at!)
    }
  })
})
