const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('../helpers/test');
const { openConsole } = require('../helpers/console');

// What a person would notice at a glance: things spilling out of their box, a panel hiding content,
// unreadable text, unlabeled fields.

for (const width of [1440, 1100, 820, 390]) {
  test.describe(`at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('nothing spills out of its card or off the page', async ({ page }) => {
      await openConsole(page);
      const report = await page.evaluate(() => {
        const spill = [];
        for (const el of document.querySelectorAll('section.card *')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const c = el.closest('section.card').getBoundingClientRect();
          if (r.right > c.right + 1 || r.left < c.left - 1) spill.push(`${el.tagName.toLowerCase()}${el.name ? `[${el.name}]` : ''} (${Math.round(r.right - c.right)}px past the card)`);
        }
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, spill: spill.slice(0, 10) };
      });

      expect(report).toEqual({ page: 0, spill: [] });
    });

    test('the results panel never hides the end of the page, nor slides under the top bar', async ({ page }) => {
      await openConsole(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(100);

      const box = await page.evaluate(() => {
        const rect = (s) => document.querySelector(s).getBoundingClientRect();
        return { header: rect('body > header'), log: rect('aside.log'), lastButton: rect('#dlForm button'), viewport: window.innerHeight };
      });

      expect(box.log.top).toBeGreaterThanOrEqual(box.header.bottom - 1); // not under the top bar
      expect(box.log.bottom).toBeLessThanOrEqual(box.viewport + 1); // not past the window
      // the last form is reachable: above the drawer when the panel is pinned to the bottom, else inside the window
      const floor = width <= 1100 ? box.log.top : box.viewport;
      expect(box.lastButton.bottom).toBeLessThanOrEqual(floor + 1);
    });
  });
}

test.describe('accessibility basics', () => {
  test('every field has a label', async ({ page }) => {
    await openConsole(page);

    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.type !== 'hidden' && !el.labels.length && !el.getAttribute('aria-label'))
        .map((el) => el.name || el.id || el.tagName)
    );

    expect(unlabeled).toEqual([]);
  });

  test('the page has a title, one main heading and a language', async ({ page }) => {
    await openConsole(page);

    await expect(page).toHaveTitle('Auth API test console');
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
  });
});

for (const colorScheme of ['light', 'dark']) {
  test(`text is readable in ${colorScheme} mode (WCAG AA contrast)`, async ({ page }) => {
    await openConsole(page, { colorScheme });

    const failures = await page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g).map(Number);
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const backgroundOf = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
          if (a > 0.5) return [r, g, b];
        }
        return [255, 255, 255];
      };

      const found = [];
      for (const el of document.querySelectorAll('body *')) {
        if (['SCRIPT', 'STYLE', 'OPTION', 'PRE'].includes(el.tagName) || el.closest('pre')) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (!rect.width || !rect.height || style.visibility === 'hidden') continue;
        if (el.closest('button:disabled')) continue;

        const [fr, fg, fb] = parse(style.color);
        const a = luminance([fr, fg, fb]);
        const b = luminance(backgroundOf(el));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        const needed = large ? 3 : 4.5;
        if (ratio < needed) found.push(`"${el.textContent.trim().slice(0, 36)}" ${ratio.toFixed(2)} < ${needed} (${el.tagName.toLowerCase()}${el.className ? `.${el.className}` : ''}, ${size}px)`);
      }
      return found.slice(0, 15);
    });

    expect(failures).toEqual([]);
  });
}

test.describe('opened straight from disk', () => {
  test('the page warns that every request will fail, and the warning is hidden on http', async ({ page }) => {
    await page.goto(pathToFileURL(path.join(__dirname, '..', '..', 'console', 'index.html')).href);
    await expect(page.locator('#fileWarning')).toBeVisible();
    await expect(page.locator('#fileWarning')).toContainText('opened as a file');
    await expect(page.locator('#fileWarning')).toContainText('npm run console');

    await openConsole(page);
    await expect(page.locator('#fileWarning')).toBeHidden();
  });
});
