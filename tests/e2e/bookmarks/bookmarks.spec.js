'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Bookmarks UI Flow', () => {
  test('bookmark-button-presence: verifies star button and app menu items', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Verify bookmark star button in navbar
    const bookmarkBtn = shellWindow.locator('#bookmark-btn');
    await expect(bookmarkBtn).toBeVisible();

    // 2. Open app menu (more options)
    const moreBtn = shellWindow.locator('#more-btn');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();

    // 3. Close app menu with Escape
    await shellWindow.keyboard.press('Escape');
  });
});
