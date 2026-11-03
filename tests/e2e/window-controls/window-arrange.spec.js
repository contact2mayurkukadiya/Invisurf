'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Window Arrangement Feature', () => {
  test('window-arrange-toggle: verifies toolbar button, opens and closes arrangement overlay', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const arrangeBtn = shellWindow.locator('#window-arrange-btn');
    await expect(arrangeBtn).toBeVisible({ timeout: 10000 });
    await expect(arrangeBtn).toHaveAttribute('aria-label', 'Arrange Window');

    // Click arrange button to open menu
    await arrangeBtn.click();
    await expect(arrangeBtn).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    await arrangeBtn.click();
    await expect(arrangeBtn).toHaveAttribute('aria-expanded', 'false');
  });
});

