describe('smoke', () => {
  it('the window shows the ProSE top bar', async () => {
    const header = await $('header')
    await header.waitForDisplayed({ timeout: 20000 })
    await expect(header).toHaveText(expect.stringContaining('ProSE'))
    const nav = await $('nav[aria-label="Main"]')
    for (const label of ['New search', 'Results', 'History']) {
      await expect(nav.$(`a=${label}`)).toBeDisplayed()
    }
  })
})
