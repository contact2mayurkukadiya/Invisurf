// spec: tests/specs/tabs-scenarios.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('InviSurf Tab Strip Detailed Scenarios', () => {
  test('1.1 tab-creation-and-keyboard-shortcuts: creates tabs via button and shortcut', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // 1. Initial tab state
    const tabs = shellWindow.locator('.tab');
    await expect(tabs.first()).toBeVisible({ timeout: 5000 });
    const initialCount = await tabs.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 2. Click Add Tab button
    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible();
    await addTabBtn.click();

    // Verify count increased by 1 and the new tab has .active class
    await expect(tabs).toHaveCount(initialCount + 1);
    const newTab = tabs.nth(initialCount);
    await expect(newTab).toHaveClass(/active/);

    // 3. Dispatch shortcut-new-tab IPC
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-new-tab');
    });

    // Verify count increased by 2 from initial
    await expect(tabs).toHaveCount(initialCount + 2);
    const shortcutTab = tabs.nth(initialCount + 1);
    await expect(shortcutTab).toHaveClass(/active/);

    // 4. Verify unique tab IDs
    const id1 = await tabs.nth(0).getAttribute('data-tab-id');
    const id2 = await tabs.nth(1).getAttribute('data-tab-id');
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  test('1.2 tab-switching-and-order: switches active tab via mouse click and shortcut navigation', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    const initialCount = await tabs.count();

    // Add 2 tabs
    await addTabBtn.click();
    await addTabBtn.click();
    await expect(tabs).toHaveCount(initialCount + 2);

    const tab0Id = await tabs.nth(0).getAttribute('data-tab-id');
    const tab1Id = await tabs.nth(initialCount).getAttribute('data-tab-id');
    const tab2Id = await tabs.nth(initialCount + 1).getAttribute('data-tab-id');

    // Click tab 0
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveClass(/active/);
    await expect(tabs.nth(initialCount)).not.toHaveClass(/active/);

    // Click tab 1
    await tabs.nth(initialCount).click();
    await expect(tabs.nth(initialCount)).toHaveClass(/active/);
    await expect(tabs.nth(0)).not.toHaveClass(/active/);

    // Click tab 2
    await tabs.nth(initialCount + 1).click();
    await expect(tabs.nth(initialCount + 1)).toHaveClass(/active/);
    await expect(tabs.nth(initialCount)).not.toHaveClass(/active/);

    // Directional keyboard switch (-1) -> goes back to tab 1
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-switch-tab', { direction: -1 });
    });
    await expect(tabs.nth(initialCount)).toHaveClass(/active/);
    await expect(tabs.nth(initialCount + 1)).not.toHaveClass(/active/);
  });

  test('1.3 tab-closing-mechanisms: supports hover close button, middle click, and keyboard shortcut', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    const initialCount = await tabs.count();

    // Open 3 more tabs
    await addTabBtn.click();
    await addTabBtn.click();
    await addTabBtn.click();
    await expect(tabs).toHaveCount(initialCount + 3);

    // 1. Close button on last tab via hover + click
    const lastTab = tabs.last();
    await lastTab.hover();
    const closeBtn = lastTab.locator('.close-btn');
    await closeBtn.click();
    await expect(tabs).toHaveCount(initialCount + 2);

    // 2. Middle-click mouse wheel button on previous tab
    const midTab = tabs.last();
    await midTab.click({ button: 'middle' });
    await expect(tabs).toHaveCount(initialCount + 1);

    // 3. Keyboard shortcut close active tab
    const activeTab = tabs.last();
    await activeTab.click();
    await expect(activeTab).toHaveClass(/active/);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-close-tab');
    });

    await expect(tabs).toHaveCount(initialCount);
  });

  test('2.1 tab-pinning-and-unpinning: toggles pinned state and compact styling', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    const initialCount = await tabs.count();
    await addTabBtn.click();
    await expect(tabs).toHaveCount(initialCount + 1);

    // Select first tab
    await tabs.first().click();
    await expect(tabs.first()).toHaveClass(/active/);

    // Toggle Pin shortcut
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-pin');
    });

    // Verify first tab is pinned
    await expect(tabs.first()).toHaveClass(/tab--pinned/);

    // Unpin first tab
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-pin');
    });

    // Verify pinned class removed
    await expect(tabs.first()).not.toHaveClass(/tab--pinned/);
  });

  test('2.2 tab-strip-context-menu-actions: duplicate, new tab right, close right, and close others', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    const tabs = shellWindow.locator('.tab');

    const initialCount = await tabs.count();

    // 1. New Tab to Right shortcut
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-new-to-right');
    });
    await expect(tabs).toHaveCount(initialCount + 1);

    // 2. Duplicate Tab shortcut
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-duplicate');
    });
    await expect(tabs).toHaveCount(initialCount + 2);

    // Select first tab and close tabs to the right
    await tabs.first().click();
    await expect(tabs.first()).toHaveClass(/active/);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-close-right');
    });
    await expect(tabs).toHaveCount(1);

    // Add extra tabs then close others
    await shellWindow.locator('#add-tab').click();
    await shellWindow.locator('#add-tab').click();
    await expect(tabs).toHaveCount(3);

    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/active/);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-close-others');
    });
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveClass(/active/);
  });

  test('3.1 tab-overflow-and-responsive-strip: auto-scales tab widths and adapts on window resize', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    // Set initial comfortable window size
    await shellWindow.setViewportSize({ width: 1280, height: 800 });

    const initialCount = await tabs.count();

    // Open multiple tabs
    for (let i = 0; i < 5; i++) {
      await addTabBtn.click();
    }
    await expect(tabs).toHaveCount(initialCount + 5);

    // Check width of an unpinned tab at 1280px width
    const firstBox = await tabs.first().boundingBox();
    expect(firstBox).not.toBeNull();
    expect(firstBox.width).toBeLessThanOrEqual(240);

    // Resize window narrower to 680px
    await shellWindow.setViewportSize({ width: 680, height: 600 });
    await shellWindow.waitForTimeout(300);

    // Tabs should automatically scale down or adapt display mode
    const narrowBox = await tabs.first().boundingBox();
    expect(narrowBox).not.toBeNull();
    expect(narrowBox.width).toBeLessThan(firstBox.width);

    // Tab bar container remains rendered and interactive
    await expect(addTabBtn).toBeVisible();
    await addTabBtn.click();
    await expect(tabs).toHaveCount(initialCount + 6);
  });
});
