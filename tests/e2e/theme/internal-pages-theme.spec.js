// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const LIGHT_RGB = 'rgb(247, 248, 249)'; // #f7f8f9
const DARK_RGB = 'rgb(18, 19, 22)';     // #121316

const internalPages = [
  { name: 'Downloads (Reference)', file: 'renderer/dist/downloads.html' },
  { name: 'History Page', file: 'renderer/dist/history.html' },
  { name: 'Bookmark Page', file: 'renderer/dist/bookmark.html' },
  { name: 'Settings Page', file: 'renderer/dist/settings.html' },
  { name: 'Extensions Page', file: 'renderer/dist/extensions.html' },
  { name: 'New Tab Page', file: 'renderer/dist/newtab.html' },
];

test.describe('InviSurf Internal Pages (invisurf://) Theme & Background Colors', () => {
  for (const p of internalPages) {
    const fileUrl = 'file://' + path.resolve(__dirname, '../../..', p.file);

    test.describe(`${p.name}`, () => {
      test(`renders neutral light background (#f7f8f9) in light mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(fileUrl);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(LIGHT_RGB);
      });

      test(`renders neutral black background (#121316) in dark mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(fileUrl);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(DARK_RGB);
      });

      test(`enforces neutral light (#f7f8f9) when forced light ([data-forced-appearance="light"])`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(fileUrl);
        await page.evaluate(() => document.documentElement.setAttribute('data-forced-appearance', 'light'));
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(LIGHT_RGB);
      });

      test(`enforces neutral dark (#121316) when forced dark ([data-forced-appearance="dark"])`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(fileUrl);
        await page.evaluate(() => document.documentElement.setAttribute('data-forced-appearance', 'dark'));
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(DARK_RGB);
      });
    });
  }
});
