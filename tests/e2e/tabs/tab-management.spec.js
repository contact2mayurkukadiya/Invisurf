// spec: tests/specs/tabs.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Tab Management', () => {
  test('create-and-switch-tabs: should open new tab, switch, and close', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Initial tab presence
    const initialTabs = shellWindow.locator('.tab');
    await expect(initialTabs.first()).toBeVisible();
    const initialCount = await initialTabs.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 2. Click Add Tab button
    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible();
    await addTabBtn.click();

    // 3. Verify tab count increased
    await expect(shellWindow.locator('.tab')).toHaveCount(initialCount + 1);

    // 4. Switch back to first tab
    await initialTabs.first().click();
    await expect(initialTabs.first()).toHaveClass(/active/);

    // 5. Hover over second tab to reveal close button, then click close
    const secondTab = shellWindow.locator('.tab').nth(1);
    await secondTab.hover();
    await secondTab.locator('.close-btn').click();
    await expect(shellWindow.locator('.tab')).toHaveCount(initialCount);
  });
});
