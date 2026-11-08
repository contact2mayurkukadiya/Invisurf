'use strict';

const { test, expect } = require('../fixtures/electronApp');
const path = require('path');

test.describe('NTP Omnibox Instant Focus on New Tab', () => {
  test('focuses omnibox by default on new tab so user can immediately type', async ({ invisurfApp }) => {
    const { app: electronApp, shellWindow } = invisurfApp;

    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible();

    // ── Tab 1 (+ button): Instant focus on new tab ─────────────────────────
    await addTabBtn.click();
    await expect(omnibox).toBeFocused({ timeout: 5000 });
    await expect(omnibox).toHaveValue('');

    // User can immediately type after creating tab
    await omnibox.fill('https://github.com');
    await expect(omnibox).toHaveValue('https://github.com');

    // ── Tab 2 (+ button): Subsequent new tabs are also focused instantly ───
    await addTabBtn.click();
    await expect(omnibox).toBeFocused({ timeout: 5000 });
    await expect(omnibox).toHaveValue('');

    await omnibox.fill('https://news.ycombinator.com');
    await expect(omnibox).toHaveValue('https://news.ycombinator.com');

    // ── Tab 3 (Shortcut trigger): Instant focus via shortcut ───────────────
    await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const fileMenu = menu?.items.find((it) => it.label === 'File');
      const newTabItem = fileMenu?.submenu?.items.find((it) => it.label === 'New Tab');
      if (newTabItem) {
        newTabItem.click();
      }
    });

    await expect(omnibox).toBeFocused({ timeout: 5000 });
    await expect(omnibox).toHaveValue('');

    await omnibox.fill('https://en.wikipedia.org');
    await expect(omnibox).toHaveValue('https://en.wikipedia.org');

    // ── Visual Verification: Capture screenshot proof ─────────────────────
    const screenshotPath = path.resolve(process.cwd(), 'test-results/ntp-omnibox-focus.png');
    await shellWindow.screenshot({ path: screenshotPath });
  });
});
