import { expect, test } from '@playwright/test'

const HOUR = 60 * 60 * 1000
const ITEM = '[data-item-id="editable-main"]'
const THEME = {
  '--borderColor-default': '#123456',
  '--control-borderColor-emphasis': '#234567',
  '--bgColor-default': '#345678',
  '--bgColor-muted': '#456789',
  '--fgColor-default': '#56789a',
  '--fgColor-muted': '#6789ab',
  '--focus-outlineColor': '#789abc',
  '--fontStack-system': 'monospace',
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(ITEM)).toBeVisible()
})

for (const colorScheme of ['light', 'dark']) {
  test(`detail links honor the host accent under a ${colorScheme} OS`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.locator(ITEM).focus()
    const link = page.locator('.elastic-timeline__link')
    const fallback = colorScheme === 'light' ? 'rgb(15, 98, 254)' : 'rgb(138, 180, 255)'
    await expect(link).toHaveCSS('color', fallback)
    await page.locator('#timeline').evaluate((host) => {
      host.style.setProperty('--bgColor-default', '#ffffff')
      host.style.setProperty('--bgColor-muted', '#f6f8fa')
      host.style.setProperty('--fgColor-accent', '#0969da')
    })
    await expect(page.getByTestId('timeline-viewport')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.elastic-timeline__details')).toHaveCSS('background-color', 'rgb(246, 248, 250)')
    await expect(link).toHaveCSS('color', 'rgb(9, 105, 218)')
    await page.locator('#timeline').evaluate((host) => host.removeAttribute('style'))
    await expect(link).toHaveCSS('color', fallback)
  })

  test(`host theme wins over ${colorScheme} OS defaults and standalone fallbacks remain`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    const root = page.locator('.elastic-timeline')
    const viewport = page.getByTestId('timeline-viewport')
    await expect(viewport).toHaveCSS('background-color', colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(15, 23, 33)')
    await expect(root).toHaveCSS('font-family', /Inter/)
    await page.locator('#timeline').evaluate((host, theme) => {
      for (const [name, value] of Object.entries(theme)) host.style.setProperty(name, value)
    }, THEME)
    expect(await root.evaluate((element) => {
      const style = getComputedStyle(element)
      return ['border', 'border-strong', 'bg', 'bg-soft', 'text', 'muted', 'focus', 'guide']
        .map((token) => style.getPropertyValue(`--et-${token}`).trim())
    })).toEqual(['#123456', '#234567', '#345678', '#456789', '#56789a', '#6789ab', '#789abc', '#56789a'])
    await expect(root).toHaveCSS('font-family', 'monospace')
    await expect(viewport).toHaveCSS('background-color', 'rgb(52, 86, 120)')
    await page.locator('#timeline').evaluate((host) => host.removeAttribute('style'))
    await expect(viewport).toHaveCSS('background-color', colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(15, 23, 33)')
  })
}

for (const shadow of [false, true]) {
  test(`updates preserve item focus and scroll${shadow ? ' inside a closed shadow root' : ''}`, async ({ page }) => {
    const result = await page.evaluate(async ({ shadow, hour }) => {
      const { createElasticTimeline } = await import('/src/timeline/editor.js')
      const host = document.createElement('div')
      document.body.append(host)
      const mount = document.createElement('div')
      const scope = shadow ? host.attachShadow({ mode: 'closed' }) : host
      scope.append(mount)
      const timeline = createElasticTimeline(mount, { items: window.__DEMO_ITEMS__, now: window.__DEMO_NOW__ })
      const viewport = mount.querySelector('[data-testid="timeline-viewport"]')
      viewport.style.cssText = 'width: 200px; overflow: auto'
      mount.querySelector('[data-testid="timeline-canvas"]').style.minWidth = '2000px'
      const activeId = () => (mount.getRootNode().activeElement)?.dataset.itemId
      mount.querySelector('[data-item-id="editable-main"]').focus()
      viewport.scrollLeft = 80
      timeline.update({ items: window.__DEMO_ITEMS__.slice().reverse(), now: window.__DEMO_NOW__ + hour })
      const afterUpdate = { id: activeId(), scroll: viewport.scrollLeft }
      const outside = document.createElement('button')
      scope.append(outside)
      outside.focus()
      timeline.update({ now: window.__DEMO_NOW__ })
      const outsidePreserved = mount.getRootNode().activeElement === outside
      mount.querySelector('[data-item-id="editable-main"]').focus()
      timeline.update({ items: [] })
      const removedFocused = Boolean(activeId())
      timeline.destroy()
      host.remove()
      return { afterUpdate, outsidePreserved, removedFocused }
    }, { shadow, hour: HOUR })
    expect(result).toEqual({ afterUpdate: { id: 'editable-main', scroll: 80 }, outsidePreserved: true, removedFocused: false })
  })
}

test('Escape from a detail action returns focus to the selected block', async ({ page }) => {
  await page.evaluate(() => {
    window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__.filter((item) => item.id === 'editable-main') })
    window.__HOST_ESCAPES__ = []
    document.querySelector('#timeline').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.__HOST_ESCAPES__.push(event.defaultPrevented)
    })
  })
  const item = page.locator(ITEM)
  await item.focus()
  await page.keyboard.press('Enter')
  await expect(item).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Tab')
  await expect(page.locator('.elastic-timeline__link')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('timeline-start-tracking')).toBeFocused()
  const scrollBefore = await page.getByTestId('timeline-viewport').evaluate((element) => element.scrollLeft)
  await page.keyboard.press('Escape')
  await expect(item).toBeFocused()
  await expect(item).toHaveAttribute('data-selected', 'false')
  expect(await page.getByTestId('timeline-viewport').evaluate((element) => element.scrollLeft)).toBe(scrollBefore)
  expect(await page.evaluate(() => window.__HOST_ESCAPES__)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(item).toBeFocused()
  expect(await page.evaluate(() => window.__HOST_ESCAPES__)).toEqual([false])
})

test('Escape consumes selection once, including from the viewport, then bubbles unhandled', async ({ page }) => {
  const result = await page.evaluate(() => {
    const host = document.querySelector('#timeline')
    const bubbled = []
    host.addEventListener('keydown', (event) => bubbled.push(event.defaultPrevented))
    const dispatch = (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    let item = host.querySelector('[data-item-id="editable-main"]')
    item.focus()
    dispatch(item, 'Enter')
    bubbled.length = 0
    const selected = dispatch(item, 'Escape')
    item = host.querySelector('[data-item-id="editable-main"]')
    const focused = document.activeElement === item
    const unselected = dispatch(item, 'Escape')
    dispatch(item, 'Enter')
    bubbled.length = 0
    const viewport = host.querySelector('[data-testid="timeline-viewport"]')
    viewport.focus()
    const viewportSelected = dispatch(viewport, 'Escape')
    const viewportUnselected = dispatch(viewport, 'Escape')
    return { selected, focused, unselected, viewportSelected, viewportUnselected, bubbled }
  })
  expect(result).toEqual({ selected: true, focused: true, unselected: false, viewportSelected: true, viewportUnselected: false, bubbled: [false] })
})

for (const kind of ['move', 'resize-left', 'resize-right']) {
  test(`Escape consumes ${kind} cancellation before the host overlay`, async ({ page }) => {
    await page.evaluate(() => {
      window.__HOST_ESCAPES__ = []
      document.querySelector('#timeline').addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.__HOST_ESCAPES__.push(event.defaultPrevented)
      })
    })
    const item = page.locator(ITEM)
    const target = kind === 'move' ? item : item.getByTestId(kind)
    const before = await item.evaluate((element) => ({ left: element.offsetLeft, width: element.offsetWidth }))
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 3 })
    if (kind === 'resize-right') await page.getByTestId('timeline-viewport').focus()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await item.evaluate((element) => ({ left: element.offsetLeft, width: element.offsetWidth }))).toEqual(before)
    expect(await page.evaluate(() => window.__HOST_ESCAPES__)).toEqual([])
    expect(await page.evaluate(() => window.__DEMO_EVENTS__.filter((entry) => entry === 'cancel:editable-main'))).toHaveLength(1)
    expect(await page.evaluate(() => window.__DEMO_EVENTS__.filter((entry) => entry.startsWith('commit:')))).toEqual([])
  })
}

test('reduced motion disables all component animations and preserves the running border', async ({ page }) => {
  await page.addStyleTag({ content: '.elastic-timeline__connector { animation: elastic-timeline-pulse 1s infinite; }' })
  const running = page.locator('[data-item-id="running"]')
  await expect(running).not.toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(running).toHaveCSS('border-top-style', 'dashed')
  expect(await page.locator('.elastic-timeline').evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0)
})

test('same-row overlap flags and callback metadata refresh without changing rows or input', async ({ page }) => {
  await page.evaluate((hour) => {
    const now = window.__DEMO_NOW__
    window.__OVERLAP_ITEMS__ = [
      { id: 'a', title: 'A', startedAt: now - 3 * hour, endedAt: now - hour },
      { id: 'b', title: 'B', startedAt: now - 2 * hour, endedAt: now - hour },
      { id: 'touch', title: 'Touch', startedAt: now - hour, endedAt: now },
      { id: 'other', title: 'Other', rowId: 'other', startedAt: now - 2 * hour, endedAt: now },
    ].map(Object.freeze)
    window.__CALLBACK_ITEMS__ = []
    window.__TIMELINE__.update({
      items: window.__OVERLAP_ITEMS__, rows: [],
      onSelect: (item) => window.__CALLBACK_ITEMS__.push(item),
      onStart: (item) => window.__CALLBACK_ITEMS__.push(item),
    })
  }, HOUR)
  const a = page.locator('[data-item-id="a"]')
  const b = page.locator('[data-item-id="b"]')
  await expect(a).toHaveAttribute('data-overlap', 'true')
  await expect(b).toHaveAttribute('data-overlap', 'true')
  await expect(page.locator('[data-item-id="touch"]')).not.toHaveAttribute('data-overlap', 'true')
  await expect(page.locator('[data-item-id="other"]')).not.toHaveAttribute('data-overlap', 'true')
  expect((await a.boundingBox()).y).toBe((await b.boundingBox()).y)
  await a.focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('timeline-start-tracking').click()
  expect(await page.evaluate(() => window.__CALLBACK_ITEMS__.map(({ id, overlaps }) => ({ id, overlaps })))).toEqual([
    { id: 'a', overlaps: ['b'] }, { id: 'a', overlaps: ['b'] },
  ])
  expect(await page.evaluate(() => window.__OVERLAP_ITEMS__.some((item) => Object.hasOwn(item, 'overlaps')))).toBe(false)
  await page.evaluate(() => window.__TIMELINE__.update({ items: window.__OVERLAP_ITEMS__.filter((item) => item.id !== 'b') }))
  await expect(a).not.toHaveAttribute('data-overlap', 'true')
  await a.focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.__CALLBACK_ITEMS__.at(-1).overlaps)).toEqual([])
})
