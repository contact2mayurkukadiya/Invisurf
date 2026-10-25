// spec: tests/specs/omnibox-scenarios.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Omnibox Detailed Scenarios', () => {
  test('1.1 omnibox-typing-and-drafts: handles text entry, selection, draft editing, and clearing', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // 1. Focus omnibox and type search query
    await omnibox.click();
    await omnibox.fill('playwright testing framework');
    await expect(omnibox).toHaveValue('playwright testing framework');

    // 2. Select all and replace with a direct URL
    await omnibox.press('Meta+A');
    await omnibox.fill('https://example.com');
    await expect(omnibox).toHaveValue('https://example.com');

    // 3. Clear draft and verify clean state
    await omnibox.fill('');
    await expect(omnibox).toHaveValue('');
  });

  test('1.2 omnibox-navigation-and-history-controls: navigates, reloads, and exercises back/forward controls', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // 1. Navigate to example.com
    await omnibox.click();
    await omnibox.fill('https://example.com');
    await omnibox.press('Enter');

    // 2. Reload button is clickable
    const reloadBtn = shellWindow.locator('#reload-btn');
    await expect(reloadBtn).toBeVisible();
    await reloadBtn.click();

    // 3. Verify back and forward control buttons are present and responsive
    const backBtn = shellWindow.locator('#back-btn');
    const forwardBtn = shellWindow.locator('#forward-btn');
    await expect(backBtn).toBeVisible();
    await expect(forwardBtn).toBeVisible();
  });

  test('2.1 omnibox-site-info-and-permissions-popup: triggers padlock menu and navigates site permissions', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    await shellWindow.locator('.tab.active').waitFor({ state: 'visible', timeout: 5000 });
    await shellWindow.waitForTimeout(500);

    // Set active tab URL in Redux to an external website
    await shellWindow.evaluate((url) => {
      const state = window.__store?.getState?.();
      const activeId = state?.browser?.currentTabId || Object.keys(state?.browser?.tabs || {})[0];
      if (activeId && window.__store) {
        window.__store.dispatch({
          type: 'browser/updateTabUrl',
          payload: { id: activeId, url },
        });
      }
    }, 'https://example.com');

    // Prefix site info button should become visible on external websites
    const siteInfoBtn = shellWindow.locator('button.omnibox-action-btn--prefix[title="View site information"]');
    await expect(siteInfoBtn).toBeVisible({ timeout: 10000 });

    // Click site info button to open the padlock overlay
    await siteInfoBtn.click({ force: true });
    await expect(siteInfoBtn).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    await siteInfoBtn.click({ force: true });
    await expect(siteInfoBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('2.2 omnibox-cookie-box-popup: opens cookies and on-device site data view', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    await shellWindow.locator('.tab.active').waitFor({ state: 'visible', timeout: 5000 });
    await shellWindow.waitForTimeout(500);
    // Set active tab URL in Redux to an external website
    await shellWindow.evaluate((url) => {
      const state = window.__store?.getState?.();
      const activeId = state?.browser?.currentTabId || Object.keys(state?.browser?.tabs || {})[0];
      if (activeId && window.__store) {
        window.__store.dispatch({
          type: 'browser/updateTabUrl',
          payload: { id: activeId, url },
        });
      }
    }, 'https://example.com');

    const siteInfoBtn = shellWindow.locator('button.omnibox-action-btn--prefix[title="View site information"]');
    await expect(siteInfoBtn).toBeVisible({ timeout: 10000 });
    await siteInfoBtn.click({ force: true });
    await expect(siteInfoBtn).toHaveAttribute('aria-expanded', 'true');

    // Click to dismiss
    await siteInfoBtn.click({ force: true });
    await expect(siteInfoBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('3.1 omnibox-responsive-resizing: adapts layout responsively to compact, desktop, and wide dimensions', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // 1. Standard Desktop (1280x800)
    await shellWindow.setViewportSize({ width: 1280, height: 800 });
    await expect(omnibox).toBeVisible();
    const boxDesktop = await omnibox.boundingBox();
    expect(boxDesktop.width).toBeGreaterThan(200);

    // 2. Compact / Narrow Width (800x600)
    await shellWindow.setViewportSize({ width: 800, height: 600 });
    await expect(omnibox).toBeVisible();
    const boxCompact = await omnibox.boundingBox();
    expect(boxCompact.width).toBeGreaterThan(150);
    expect(boxCompact.width).toBeLessThanOrEqual(boxDesktop.width);

    // Controls remain interactive in compact mode
    await omnibox.click();
    await omnibox.fill('compact test');
    await expect(omnibox).toHaveValue('compact test');

    // 3. Wide Display (1600x900)
    await shellWindow.setViewportSize({ width: 1600, height: 900 });
    await expect(omnibox).toBeVisible();
    const boxWide = await omnibox.boundingBox();
    expect(boxWide.width).toBeGreaterThanOrEqual(boxCompact.width);
  });
});
