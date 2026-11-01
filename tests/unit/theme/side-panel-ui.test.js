'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Chrome Side Panel UI (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const indexUrl = 'file://' + path.join(ROOT, 'renderer/dist/index.html');
  const artifactScreenshot = path.join(
    ROOT,
    'side-panel-reading-list.png'
  );

  let browser;

  test('launches browser instance for shell UI test', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('renders Side Panel button in toolbar and toggles side panel open/closed', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // Inject mock electronAPI so React AppShell loads seamlessly
    await page.addInitScript(() => {
      const noopListener = () => () => {};
      window.electronAPI = {
        onTabUpdate: noopListener,
        onUrlChanged: noopListener,
        onTabCreated: noopListener,
        onTabClosedExternal: noopListener,
        onTabSwitched: noopListener,
        onOmniboxFocus: noopListener,
        onShortcutNewTab: noopListener,
        onShortcutHistory: noopListener,
        onShortcutSettings: noopListener,
        onShortcutCloseTab: noopListener,
        onShortcutReload: noopListener,
        onShortcutSwitchTab: noopListener,
        onShortcutTabNewToRight: noopListener,
        onShortcutTabDuplicate: noopListener,
        onShortcutTabMuteSite: noopListener,
        onShortcutTabPin: noopListener,
        onShortcutTabCloseOthers: noopListener,
        onShortcutTabCloseRight: noopListener,
        onShortcutTabMoveNewWindow: noopListener,
        onShortcutTabSearch: noopListener,
        onShortcutCommandPalette: noopListener,
        onTabAwoken: noopListener,
        onThemeApply: noopListener,
        onBookmarksUpdated: noopListener,
        onSidePanelToggle: noopListener,
        onDownloadsStarted: noopListener,
        onDownloadsProgress: noopListener,
        onDownloadsDone: noopListener,
        onDownloadsUpdated: noopListener,
        onDownloadsShowAttention: noopListener,
        onGhostClickThroughChanged: noopListener,
        bookmarksGet: () => Promise.resolve({
          bar: [
            { id: 'b-1', type: 'bookmark', title: 'Google Search', url: 'https://google.com' },
            {
              id: 'f-1',
              type: 'folder',
              title: 'Work Resources',
              children: [
                { id: 'b-2', type: 'bookmark', title: 'GitHub', url: 'https://github.com' },
              ],
            },
          ],
        }),
        historySearch: (payload) => {
          const q = (payload?.query || '').toLowerCase();
          if (q.includes('nomatch')) return Promise.resolve({ items: [] });
          return Promise.resolve([
            { visitId: 101, id: 'h-1', title: 'InviSurf Documentation', url: 'https://docs.invisurf.com', lastVisitTime: Date.now() },
          ]);
        },
        profileList: () => Promise.resolve([]),
        profileGetActive: () => Promise.resolve(null),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        newTab: (id, isStealth, url) => { window.__lastNewTab = { id, isStealth, url }; },
        switchTab: (id) => { window.__lastSwitchTab = id; },
        closeTab: () => {},
        tabSetAudioMuted: () => {},
        tabMenuSyncLabels: () => {},
        appLog: () => {},
      };
    });

    await page.goto(indexUrl);

    // 1. Verify side panel button in toolbar
    const sidePanelBtn = page.locator('#side-panel-btn');
    await sidePanelBtn.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await sidePanelBtn.isVisible(), '#side-panel-btn must be visible in toolbar');

    // Verify side panel container is not initially visible
    let sidePanel = page.locator('.side-panel-container');
    assert.equal(await sidePanel.count(), 0, 'Side panel should initially be closed');

    // 2. Click Side Panel button to open
    await sidePanelBtn.click();
    await sidePanel.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await sidePanel.isVisible(), 'Side panel container must be visible after click');

    const btnClass = await sidePanelBtn.getAttribute('class');
    assert.ok(btnClass.includes('active'), 'Side panel button should have active class');

    // 3. Verify Header title displays "Reading list" (no dropdown)
    const headerTitle = sidePanel.locator('.side-panel-header-title');
    await headerTitle.waitFor({ state: 'visible' });
    assert.equal(await headerTitle.textContent(), 'Reading list', 'Header title must be "Reading list"');
    assert.equal(await sidePanel.locator('.side-panel-selector-btn').count(), 0, 'Header must not contain dropdown button');

    const readingListPanel = sidePanel.locator('.reading-list-panel');
    assert.ok(await readingListPanel.isVisible(), 'Reading list panel must be rendered');

    // 4. Test Pinning to Toolbar
    const pinBtn = sidePanel.locator('.side-panel-pin-btn');
    assert.ok(await pinBtn.isVisible(), 'Pin button must be visible in header');
    assert.equal(await pinBtn.getAttribute('title'), 'Pin to toolbar');

    // Click pin button to pin Reading list
    await pinBtn.click();
    assert.equal(await pinBtn.getAttribute('title'), 'Unpin from toolbar');

    // Pinned button must now be visible in toolbar
    const pinnedReadingListBtn = page.locator('#side-panel-pin-reading-list');
    await pinnedReadingListBtn.waitFor({ state: 'visible' });
    assert.ok(await pinnedReadingListBtn.isVisible(), '#side-panel-pin-reading-list must be visible in toolbar');

    // Take screenshot of open side panel
    await page.screenshot({ path: artifactScreenshot });

    // 5. Switch to Bookmarks
    await page.evaluate(() => {
      // simulate opening bookmarks sidepanel
      const s = window.__INVISURF_STORE__;
      if (s) {
        s.dispatch({ type: 'browser/setSidePanelActiveView', payload: 'bookmarks' });
      }
    });

    await headerTitle.waitFor({ state: 'visible' });
    assert.equal(await headerTitle.textContent(), 'Bookmarks', 'Header title must update to "Bookmarks"');

    const bookmarksPanel = sidePanel.locator('.bookmarks-panel');
    await bookmarksPanel.waitFor({ state: 'visible' });
    assert.ok(await bookmarksPanel.isVisible(), 'Bookmarks panel must be rendered');

    // Verify "Open in new tab" icon button is visible for Bookmarks and opens invisurf://bookmark
    const openInNewTabBtn = sidePanel.locator('.side-panel-open-tab-btn');
    assert.ok(await openInNewTabBtn.isVisible(), 'Open in new tab button must be visible for Bookmarks');
    assert.ok((await openInNewTabBtn.getAttribute('title')).includes('Open Bookmarks in new tab'));

    // First click opens invisurf://bookmark in a new tab
    await openInNewTabBtn.click();
    const newTabCall = await page.evaluate(() => window.__lastNewTab);
    assert.ok(newTabCall, 'newTab should be called when clicking open in new tab button');
    assert.equal(newTabCall.url, 'invisurf://bookmark', 'newTab URL must be invisurf://bookmark');
    const bookmarkTabId = newTabCall.id;

    // Reset spies
    await page.evaluate(() => {
      window.__lastNewTab = null;
      window.__lastSwitchTab = null;
    });

    // Second click: bookmark page is already open, so it MUST redirect (switch) to it rather than opening duplicate tab
    await openInNewTabBtn.click();
    const secondNewTabCall = await page.evaluate(() => window.__lastNewTab);
    assert.equal(secondNewTabCall, null, 'newTab must NOT be called when bookmark page is already open');
    const switchedTabId = await page.evaluate(() => window.__lastSwitchTab);
    assert.equal(switchedTabId, bookmarkTabId, 'switchTab must be called with the existing bookmark tab ID');

    // Verify Bookmarks search and simple placeholder without search query
    const bmSearchInput = bookmarksPanel.locator('.sp-search-input');
    await bmSearchInput.fill('nomatch');
    const bmEmptyState = bookmarksPanel.locator('.sp-empty-state');
    await bmEmptyState.waitFor({ state: 'visible' });
    const bmEmptyText = await bmEmptyState.textContent();
    assert.ok(bmEmptyText.includes('No matching bookmarks found'), 'Bookmarks empty state should show simple placeholder');
    assert.ok(!bmEmptyText.includes('nomatch'), 'Bookmarks empty state must not contain search query');
    await bmSearchInput.fill('');

    // Pin Bookmarks to toolbar as well
    await pinBtn.click();
    const pinnedBookmarksBtn = page.locator('#side-panel-pin-bookmarks');
    await pinnedBookmarksBtn.waitFor({ state: 'visible' });
    assert.ok(await pinnedBookmarksBtn.isVisible(), '#side-panel-pin-bookmarks must be visible in toolbar');

    // 6. Switch to History
    await page.evaluate(() => {
      const s = window.__INVISURF_STORE__;
      if (s) {
        s.dispatch({ type: 'browser/setSidePanelActiveView', payload: 'history' });
      }
    });

    assert.equal(await headerTitle.textContent(), 'History', 'Header title must update to "History"');
    const historyPanel = sidePanel.locator('.history-panel');
    await historyPanel.waitFor({ state: 'visible' });
    assert.ok(await historyPanel.isVisible(), 'History panel must be rendered');

    // Verify History search and simple placeholder without search query
    const histSearchInput = historyPanel.locator('.sp-search-input');
    await histSearchInput.fill('nomatch');
    const histEmptyState = historyPanel.locator('.sp-empty-state');
    await histEmptyState.waitFor({ state: 'visible' });
    const histEmptyText = await histEmptyState.textContent();
    assert.ok(histEmptyText.includes('No matching history found'), 'History empty state should show simple placeholder');
    assert.ok(!histEmptyText.includes('nomatch'), 'History empty state must not contain search query');

    // Search matching item and verify it replaces list cleanly
    await histSearchInput.fill('InviSurf');
    const histRow = historyPanel.locator('.hist-row');
    await histRow.first().waitFor({ state: 'visible' });
    assert.ok(await histRow.first().isVisible(), 'History matching search result must be visible');
    await histSearchInput.fill('');

    // Verify "Open in new tab" icon button is visible for History and opens invisurf://history
    assert.ok(await openInNewTabBtn.isVisible(), 'Open in new tab button must be visible for History');
    assert.ok((await openInNewTabBtn.getAttribute('title')).includes('Open History in new tab'));

    // First click opens invisurf://history in a new tab
    await page.evaluate(() => {
      window.__lastNewTab = null;
      window.__lastSwitchTab = null;
    });
    await openInNewTabBtn.click();
    const histNewTabCall = await page.evaluate(() => window.__lastNewTab);
    assert.ok(histNewTabCall, 'newTab should be called for history');
    assert.equal(histNewTabCall.url, 'invisurf://history', 'newTab URL must be invisurf://history');
    const histTabId = histNewTabCall.id;

    // Reset spies
    await page.evaluate(() => {
      window.__lastNewTab = null;
      window.__lastSwitchTab = null;
    });

    // Second click: history page is already open, so it MUST redirect (switch) to it rather than opening duplicate tab
    await openInNewTabBtn.click();
    const secondHistNewTabCall = await page.evaluate(() => window.__lastNewTab);
    assert.equal(secondHistNewTabCall, null, 'newTab must NOT be called when history page is already open');
    const switchedHistTabId = await page.evaluate(() => window.__lastSwitchTab);
    assert.equal(switchedHistTabId, histTabId, 'switchTab must be called with the existing history tab ID');

    // Pin History to toolbar as well
    await pinBtn.click();
    const pinnedHistoryBtn = page.locator('#side-panel-pin-history');
    await pinnedHistoryBtn.waitFor({ state: 'visible' });
    assert.ok(await pinnedHistoryBtn.isVisible(), '#side-panel-pin-history must be visible in toolbar');

    // 7. Test Resizer handle
    const resizer = sidePanel.locator('.side-panel-resizer');
    assert.ok(await resizer.isVisible(), 'Resizer handle must be visible');

    // 8. Click Close button in header
    const closeBtn = sidePanel.locator('.side-panel-close-btn');
    await closeBtn.click();
    await sidePanel.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await sidePanel.count(), 0, 'Side panel must be closed after clicking close button');

    // Verify pinned toolbar icons persist after closing
    assert.ok(await pinnedBookmarksBtn.isVisible(), 'Bookmarks pinned toolbar icon must still be visible');
    assert.ok(await pinnedHistoryBtn.isVisible(), 'History pinned toolbar icon must still be visible');

    // 9. Re-open side panel via pinned toolbar icon
    await pinnedHistoryBtn.click();
    await sidePanel.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await sidePanel.isVisible(), 'Side panel must re-open after clicking pinned toolbar button');
    assert.equal(await headerTitle.textContent(), 'History', 'Re-opened panel must show History');

    // Close again via clicking the active pinned icon
    await pinnedHistoryBtn.click();
    await sidePanel.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await sidePanel.count(), 0, 'Side panel must close when clicking active pinned toolbar icon');

    await page.close();
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
  });
});
