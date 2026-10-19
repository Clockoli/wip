import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const tooltipScript = fileURLToPath(new URL('../src/ui/instant-tooltips.js', import.meta.url));

async function install(page, selector = null) {
  await page.addScriptTag({ path: tooltipScript });
  await page.evaluate(value => {
    globalThis.ClockoliInstantTooltips.attach(document, value ? { selector: value } : {});
  }, selector);
}

async function isVisible(page) {
  return page.locator('#clockoli-instant-tooltip').evaluate(node => getComputedStyle(node).display !== 'none');
}

test('HTML and dynamically updated title tooltips appear on hover with no delay', async ({ page }) => {
  await page.setContent('<button id="refresh" title="Refresh" style="margin:40px">Refresh</button>');
  await install(page);
  const refresh = page.locator('#refresh');
  await expect(refresh).not.toHaveAttribute('title');
  await expect(refresh).toHaveAttribute('data-clockoli-tooltip', 'Refresh');

  await refresh.hover();
  expect(await isVisible(page)).toBe(true); // No timer or wait for the browser's native tooltip.
  await page.mouse.move(0, 0);
  expect(await isVisible(page)).toBe(false);

  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'dynamic';
    button.textContent = 'Dynamic';
    button.title = 'First value';
    document.body.append(button);
  });
  const dynamic = page.locator('#dynamic');
  await expect(dynamic).toHaveAttribute('data-clockoli-tooltip', 'First value');
  await dynamic.hover();
  expect(await isVisible(page)).toBe(true);

  await page.evaluate(() => { document.getElementById('dynamic').title = 'Updated value'; });
  await expect(dynamic).toHaveAttribute('data-clockoli-tooltip', 'Updated value');
  await expect(dynamic).not.toHaveAttribute('title');
  await page.mouse.move(0, 0);
  expect(await isVisible(page)).toBe(false);
  expect(await page.locator('#clockoli-instant-tooltip').count()).toBe(1);
});

test('a closed Shadow DOM uses the same immediate tooltip without clipping', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await install(page);
  const coordinates = await page.evaluate(() => {
    const host = document.getElementById('root');
    host.style.cssText = 'position:absolute;top:60px;left:60px';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<button title="Shadow tooltip" style="width:130px;height:45px">Hover here</button>';
    globalThis.shadowButton = shadow.querySelector('button');
    globalThis.ClockoliInstantTooltips.attach(shadow);
    const bounds = globalThis.shadowButton.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await page.mouse.move(coordinates.x, coordinates.y);
  expect(await isVisible(page)).toBe(true);
  expect(await page.evaluate(() => globalThis.shadowButton.getAttribute('data-clockoli-tooltip'))).toBe('Shadow tooltip');
  expect(await page.evaluate(() => globalThis.shadowButton.hasAttribute('title'))).toBe(false);
  await page.mouse.move(0, 0);
  expect(await isVisible(page)).toBe(false);
});

test('SVG chart titles use the same hover tooltip instead of the delayed SVG title', async ({ page }) => {
  await page.setContent('<svg width="210" height="110"><rect id="bar" x="15" y="15" width="100" height="65" tabindex="0" fill="#3979ac"><title>Monday\n3 tasks</title></rect></svg>');
  await install(page);
  await expect(page.locator('svg title')).toHaveCount(0);
  await expect(page.locator('#bar')).toHaveAttribute('data-clockoli-tooltip', 'Monday\n3 tasks');
  await page.locator('#bar').hover();
  expect(await isVisible(page)).toBe(true);
  await page.mouse.move(200, 100);
  expect(await isVisible(page)).toBe(false);
  await page.locator('#bar').focus();
  expect(await isVisible(page)).toBe(true);
});

test('scoped tooltips do not replace third-party page tooltips', async ({ page }) => {
  await page.setContent('<button id="external" title="Website tooltip">Website</button><button id="clockoli" data-clockoli-ui="clockify-detailed-report" title="Clockoli tooltip">Clockoli</button>');
  await install(page, '[data-clockoli-ui="clockify-detailed-report"]');
  await page.locator('#external').hover();
  expect(await page.locator('#external').getAttribute('title')).toBe('Website tooltip');
  expect(await page.locator('#clockoli-instant-tooltip').count()).toBe(0);
  await page.locator('#clockoli').hover();
  expect(await isVisible(page)).toBe(true);
  await expect(page.locator('#clockoli')).not.toHaveAttribute('title');
});
