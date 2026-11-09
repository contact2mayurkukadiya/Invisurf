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

  test('3.2 tab-drag-reorder-smoothness: drags a tab horizontally and drops to reorder smoothly', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    // Create 3 tabs
    await addTabBtn.click();
    await addTabBtn.click();
    await expect(tabs).toHaveCount(3);

    const tab0 = tabs.nth(0);
    const tab1 = tabs.nth(1);
    const tab2 = tabs.nth(2);

    const tab0Id = await tab0.getAttribute('data-tab-id');
    const tab1Id = await tab1.getAttribute('data-tab-id');

    const tab0Box = await tab0.boundingBox();
    const tab2Box = await tab2.boundingBox();
    expect(tab0Box).not.toBeNull();
    expect(tab2Box).not.toBeNull();

    // Drag tab0 past tab1 and tab2 to the right
    await shellWindow.mouse.move(tab0Box.x + tab0Box.width / 2, tab0Box.y + tab0Box.height / 2);
    await shellWindow.mouse.down();
    // Move horizontally across the strip in steps
    await shellWindow.mouse.move(tab2Box.x + tab2Box.width / 2, tab2Box.y + tab2Box.height / 2, { steps: 10 });
    // Release drop
    await shellWindow.mouse.up();

    // Wait for the smooth drop animation and commit
    await shellWindow.waitForTimeout(350);

    // Verify new order in DOM: tab0 is now last
    const finalTabs = shellWindow.locator('.tab');
    const newTab0Id = await finalTabs.nth(0).getAttribute('data-tab-id');
    const newTabLastId = await finalTabs.nth(2).getAttribute('data-tab-id');
    expect(newTab0Id).toBe(tab1Id);
    expect(newTabLastId).toBe(tab0Id);

    // Capture visual proof of smooth reorder
    await shellWindow.screenshot({ path: 'tests/reports/tab-drag-smooth-reorder.png' });
  });

  test('3.3 tab-detach-preserves-collapsed-group: detaching a non-grouped tab does not automatically expand collapsed tab groups', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    const tabs = shellWindow.locator('.tab');
    const addTabBtn = shellWindow.locator('#add-tab');

    // Start with 1 tab, add two more tabs -> 3 total
    await addTabBtn.click();
    await shellWindow.waitForTimeout(200);
    await addTabBtn.click();
    await shellWindow.waitForTimeout(200);
    await expect(tabs).toHaveCount(3);

    const tab0Id = await tabs.nth(0).getAttribute('data-tab-id');
    const tab1Id = await tabs.nth(1).getAttribute('data-tab-id');

    // Create a tab group containing tab0 and tab1
    await shellWindow.evaluate(({ ids }) => {
      window.dispatchEvent(new CustomEvent('invisurf:create-group-for-tabs', {
        detail: { tabIds: ids, title: 'Work' }
      }));
    }, { ids: [tab0Id, tab1Id] });
    await shellWindow.waitForTimeout(300);

    const groupChip = shellWindow.locator('.group-chip');
    await expect(groupChip).toBeVisible({ timeout: 5000 });

    // Collapse the group by clicking the chip
    await groupChip.click();
    await expect(groupChip).toHaveClass(/group-chip--collapsed/, { timeout: 5000 });
    await expect(shellWindow.locator('.tab--collapsed-member')).toHaveCount(2);

    // Ensure member tab collapse transition (120ms) has fully finished and layout has settled
    await expect.poll(async () => {
      const box = await shellWindow.locator('.tab--collapsed-member').first().boundingBox();
      return box ? box.width : 0;
    }, { timeout: 3000 }).toBeLessThanOrEqual(1);

    // tab2 (non-grouped) is active and visible
    const visibleNonCollapsedTabs = shellWindow.locator('.tab:not(.tab--collapsed-member)');
    await expect(visibleNonCollapsedTabs).toHaveCount(1);
    const tab2 = visibleNonCollapsedTabs.first();
    const tab2Box = await tab2.boundingBox();
    expect(tab2Box).not.toBeNull();

    // Detach tab2 vertically down by 70px
    const startX = tab2Box.x + tab2Box.width / 2;
    const startY = tab2Box.y + tab2Box.height / 2;
    await shellWindow.mouse.move(startX, startY);
    await shellWindow.mouse.down();
    await shellWindow.mouse.move(startX, startY + 70, { steps: 5 });
    await shellWindow.waitForTimeout(300);

    // Verify a second window spawns
    await expect.poll(async () => {
      return app.windows().filter(w => w.url().includes('index.html')).length;
    }, { timeout: 8000 }).toBe(2);

    // Release mouse
    await shellWindow.mouse.up();
    await shellWindow.waitForTimeout(500);

    // Crucial verification: In the original shellWindow, the tab group MUST STILL BE COLLAPSED!
    await expect(groupChip).toHaveClass(/group-chip--collapsed/);
    await expect(shellWindow.locator('.tab--collapsed-member')).toHaveCount(2);

    // A clean new tab was created for the shellWindow so the user isn't left empty,
    // and the group did not expand.
    await expect(visibleNonCollapsedTabs).toHaveCount(1);
    const remainingNonCollapsedId = await visibleNonCollapsedTabs.first().getAttribute('data-tab-id');
    expect(remainingNonCollapsedId).not.toBe(tab0Id);
    expect(remainingNonCollapsedId).not.toBe(tab1Id);

    // Clean up: close the detached window
    const detachedWin = app.windows().find(w => w !== shellWindow && w.url().includes('index.html'));
    if (detachedWin) {
      await detachedWin.close();
      await shellWindow.waitForTimeout(300);
    }
  });
});
