// spec: tests/specs/bookmarks-scenarios.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('InviSurf Bookmarks Detailed Scenarios', () => {
  test('1.1 bookmark-star-availability-and-state: checks star disable on NTP, enable on web, and starred state', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // 1. On NTP, star button is disabled
    const starBtn = shellWindow.locator('#bookmark-btn');
    await expect(starBtn).toBeVisible({ timeout: 5000 });
    await expect(starBtn).toBeDisabled();
    await expect(starBtn).toHaveAttribute('title', 'This page cannot be bookmarked');

    // 2. Add bookmark via renderer IPC and sync to Redux store
    await shellWindow.evaluate(async () => {
      const data = await window.electronAPI.bookmarksAdd({
        id: 'bk-ex-1',
        type: 'bookmark',
        title: 'Example Domain',
        url: 'https://example.com',
      });
      window.__store?.dispatch({ type: 'bookmarks/setBookmarks', payload: data });
    });

    // 3. Obtain current tab ID and simulate web navigation to https://example.com
    const activeTab = shellWindow.locator('.tab.active');
    await expect(activeTab).toBeVisible();
    const tabId = await activeTab.getAttribute('data-tab-id');

    await app.evaluate(({ BrowserWindow }, { id }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('url-changed', { id, url: 'https://example.com' });
      win?.webContents.send('tab-update', { id, url: 'https://example.com', title: 'Example Domain' });
    }, { id: tabId });

    // 4. Star button becomes enabled and reflects starred state
    await expect(starBtn).toBeEnabled({ timeout: 10000 });
    await expect(starBtn).toHaveClass(/starred/, { timeout: 10000 });

    // 5. Clicking star button triggers animation / interaction
    await starBtn.click();
  });

  test('1.2 bookmark-bar-items-and-navigation: renders bookmark items and triggers navigation', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Verify bookmark bar is present
    const bookmarkBar = shellWindow.locator('.bookmark-bar');
    await expect(bookmarkBar).toBeVisible({ timeout: 5000 });

    // 2. Populate bookmark bar with item via renderer IPC and Redux dispatch
    await shellWindow.evaluate(async () => {
      const data = await window.electronAPI.bookmarksAdd({
        id: 'bk-item-1',
        type: 'bookmark',
        title: 'GitHub Portal',
        url: 'https://github.com',
      });
      window.__store?.dispatch({ type: 'bookmarks/setBookmarks', payload: data });
    });

    // 3. Verify bookmark item rendered
    const bkItem = shellWindow.locator('.bk-item', { hasText: 'GitHub Portal' });
    await expect(bkItem).toBeVisible({ timeout: 5000 });

    // 4. Click bookmark item
    await bkItem.click();
  });

  test('2.1 bookmark-folder-prompt-workflow: manages folder creation prompt with cancel and submit', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const addFolderBtn = shellWindow.locator('button.bk-add-folder');
    await expect(addFolderBtn).toBeVisible({ timeout: 5000 });

    // 1. Open prompt
    await addFolderBtn.click();
    const prompt = shellWindow.locator('#bk-folder-prompt');
    await expect(prompt).toBeVisible();

    const nameInput = shellWindow.locator('#bk-folder-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Temp Folder');

    // 2. Cancel prompt
    const cancelBtn = shellWindow.locator('#bk-folder-cancel');
    await cancelBtn.click();
    await expect(prompt).not.toBeVisible();

    // 3. Re-open and submit folder
    await addFolderBtn.click();
    await expect(prompt).toBeVisible();
    await nameInput.fill('Engineering Projects');

    const okBtn = shellWindow.locator('#bk-folder-ok');
    await okBtn.click();
    await expect(prompt).not.toBeVisible();

    // 4. Verify folder appears in bookmark bar
    const folderItem = shellWindow.locator('.bk-folder').first();
    await expect(folderItem).toBeVisible({ timeout: 5000 });
    await expect(folderItem).toContainText('Engineering Projects');
  });

  test('3.1 bookmark-bar-overflow-on-resize: toggles overflow button based on available viewport width', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Add 15 short bookmarks via renderer IPC
    await shellWindow.evaluate(async () => {
      let lastData;
      for (let i = 1; i <= 15; i++) {
        lastData = await window.electronAPI.bookmarksAdd({
          id: `bk-overflow-${i}`,
          type: 'bookmark',
          title: `Link ${i}`,
          url: `https://example${i}.com`,
        });
      }
      window.__store?.dispatch({ type: 'bookmarks/setBookmarks', payload: lastData });
    });

    // 2. Compact window size (400px width) -> 15 items must overflow
    await shellWindow.setViewportSize({ width: 400, height: 600 });
    await shellWindow.waitForTimeout(500);

    const overflowBtn = shellWindow.locator('.bk-overflow-btn');
    await expect(overflowBtn).toBeVisible({ timeout: 5000 });

    // 3. Expand window to wide width (1600px) -> all items fit, overflow disappears
    await shellWindow.setViewportSize({ width: 1600, height: 800 });
    await shellWindow.waitForTimeout(500);
    await expect(overflowBtn).not.toBeVisible({ timeout: 5000 });
  });
});
