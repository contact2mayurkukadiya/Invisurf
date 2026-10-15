// spec: tests/specs/navigation.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Omnibox Navigation Controls', () => {
  test('omnibox-url-navigation: should navigate and trigger controls', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // 1. Verify title and omnibox input visibility
    await expect(shellWindow).toHaveTitle(/InviSurf/i);
    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // 2. Type URL into omnibox
    await omnibox.click();
    await omnibox.fill('https://example.com');
    await expect(omnibox).toHaveValue('https://example.com');

    // 3. Submit navigation
    await omnibox.press('Enter');

    // 4. Verify reload button is interactive
    const reloadBtn = shellWindow.locator('#reload-btn');
    await expect(reloadBtn).toBeVisible();
    await reloadBtn.click();

    // 5. Verify back and forward buttons exist
    const backBtn = shellWindow.locator('#back-btn');
    const forwardBtn = shellWindow.locator('#forward-btn');
    await expect(backBtn).toBeVisible();
    await expect(forwardBtn).toBeVisible();
  });
});
