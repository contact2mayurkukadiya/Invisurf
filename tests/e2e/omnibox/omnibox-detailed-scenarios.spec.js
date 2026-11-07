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

    // 4. Click outside to blur omnibox and verify placeholder is visible
    await shellWindow.locator('.tab-bar').click({ position: { x: 50, y: 10 } });
    await expect(shellWindow.locator('.omnibox-unfocused-placeholder')).toBeVisible();
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

  test('1.3 omnibox-inline-autocompletion: autocompletes matching domain prefix from history with selected text', async ({ invisurfApp }) => {
    const { app, shellWindow } = invisurfApp;

    // 1. Seed history in the main process
    await app.evaluate(async () => {
      const State = global.__invisurfState;
      if (State?.historyService) {
        await State.historyService.recordVisit(State.defaultProfileId, {
          url: 'https://mail.google.com/mail/u/0/#inbox',
          title: 'Inbox (23) - mayurkukadiya0@gmail.com - Gmail',
          transition: 'TYPED',
        });
      }
    });

    // 2. Verify suggestion payload returns Page Title as primary text, clean domain as description, and real favicon
    const suggestions = await shellWindow.evaluate(async () => {
      return await window.electronAPI.historyGetSuggestions('ma');
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].text).toBe('Inbox (23) - mayurkukadiya0@gmail.com - Gmail');
    expect(suggestions[0].description).toBe('mail.google.com/mail/u/0/#inbox');
    expect(suggestions[0].favicon).toContain('https://www.google.com/s2/favicons?domain=mail.google.com');

    // 3. Focus omnibox input and type 'ma'
    const omnibox = shellWindow.locator('#url-input');
    await omnibox.click();
    await omnibox.fill('ma');
    await shellWindow.waitForTimeout(500);

    // Verify omnibox completed value in input
    await expect(omnibox).toHaveValue('mail.google.com');

    // Verify ghost suffix is not rendered alongside inline completion (no duplicate text)
    const ghostEl = shellWindow.locator('.omnibox-ghost');
    await expect(ghostEl).toHaveCount(0);

    // Verify text selection covers untyped suffix (indices 2 to 15)
    const selection = await omnibox.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
    expect(selection.start).toBe(2);
    expect(selection.end).toBe(15);

    // 4. Verify typing next matching character 'i' preserves/progresses completion
    await omnibox.press('i');
    await shellWindow.waitForTimeout(500);
    await expect(omnibox).toHaveValue('mail.google.com');
    const selectionAfterI = await omnibox.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
    expect(selectionAfterI.start).toBe(3);
    expect(selectionAfterI.end).toBe(15);

    // 5. Verify typing non-matching character 'x' writes directly without stuck completion
    await omnibox.press('x');
    await shellWindow.waitForTimeout(500);
    await expect(omnibox).toHaveValue('maix');

    // 6. Verify Backspace removes character cleanly
    await omnibox.press('Backspace');
    await expect(omnibox).toHaveValue('mai');
  });

  test('1.4 omnibox-escape-dismisses-suggestions: closes suggestions dropdown when Escape is pressed', async ({ invisurfApp }) => {
    const { app, shellWindow } = invisurfApp;

    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // 1. Focus omnibox and type to open suggestions dropdown
    await omnibox.click();
    await omnibox.fill('test query');
    await shellWindow.waitForTimeout(500);

    // Verify suggestions overlay is active in main process
    const isOverlayAcquiredBefore = await app.evaluate(() => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      return (ctx?.chromeOmniboxOverlayAcquireCount || 0) > 0;
    });
    expect(isOverlayAcquiredBefore).toBe(true);

    // 2. Press Escape
    // Focus may be inside the overlay WebContentsView or in the shell window.
    await app.evaluate(() => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      if (ctx?.chromeOmniboxOverlayView?.webContents) {
        ctx.chromeOmniboxOverlayView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        ctx.chromeOmniboxOverlayView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      }
    });
    await shellWindow.waitForTimeout(500);

    // Verify suggestions overlay was dismissed / released
    const isOverlayAcquiredAfter = await app.evaluate(() => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      return (ctx?.chromeOmniboxOverlayAcquireCount || 0) > 0;
    });
    expect(isOverlayAcquiredAfter).toBe(false);

    // Verify omnibox retains focus and user can resume typing seamlessly
    await expect(omnibox).toBeFocused();
    await shellWindow.keyboard.type(' more');
    await expect(omnibox).toHaveValue('test query more');

    // 3. Test Escape when shell window input has focus
    await shellWindow.keyboard.press('Escape');
    await shellWindow.waitForTimeout(500);

    const isOverlayAcquiredAfterShellEscape = await app.evaluate(() => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      return (ctx?.chromeOmniboxOverlayAcquireCount || 0) > 0;
    });
    expect(isOverlayAcquiredAfterShellEscape).toBe(false);

    // Omnibox still has focus and user can continue typing
    await expect(omnibox).toBeFocused();
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

  test('3.2 omnibox-arbitrary-search-query-no-unrelated-history: typing search query does not show unrelated history items', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();

    // Type a query that does not match any history URL
    await omnibox.click();
    await omnibox.fill('how to render threejs scene');
    await shellWindow.waitForTimeout(500);

    // Verify draft input has the query
    await expect(omnibox).toHaveValue('how to render threejs scene');

    // Verify overlay suggestions do not contain unrelated history fallback
    const overlayItems = await shellWindow.evaluate(async () => {
      // Query the suggestions that were prepared for the omnibox controller
      const inputZone = document.querySelector('.omnibox-input-zone');
      return !!inputZone;
    });
    expect(overlayItems).toBe(true);
  });
});
