'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Modal & Sidebar Compatibility (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const indexUrl = 'file://' + path.join(ROOT, 'renderer/dist/index.html');
  const screenshotDir = path.resolve(__dirname, '../../../');

  let browser;
  const consoleErrors = [];

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('verifies modals open strictly above side panel and web content card frame when sidebar is open', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore CSP blocks caused by running app:// scheme assets inside standalone Playwright Chromium
        if (
          !text.includes('favicon') &&
          !text.includes('net::ERR_FILE_NOT_FOUND') &&
          !text.includes('app://') &&
          !text.includes('Content Security Policy')
        ) {
          consoleErrors.push(text);
        }
      }
    });

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
        onShortcutTabSearch: (cb) => { window.__triggerTabSearch = cb; },
        onShortcutCommandPalette: (cb) => { window.__triggerCommandPalette = cb; },
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
        bookmarksGet: () => Promise.resolve({ bar: [] }),
        historySearch: () => Promise.resolve([]),
        profileList: () => Promise.resolve([
          { profileId: 'default', displayName: 'Default User', avatar: 'user' },
        ]),
        profileGetActive: () => Promise.resolve({
          profileId: 'default',
          displayName: 'Default User',
          avatar: 'user',
        }),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        newTab: () => {},
        switchTab: () => {},
        closeTab: () => {},
        tabSetAudioMuted: () => {},
        tabMenuSyncLabels: () => {},
        appLog: () => {},
        tabCaptureSnapshot: () => Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
        tabHideActive: () => Promise.resolve(),
        tabRestoreActive: () => Promise.resolve(),
      };
    });

    await page.goto(indexUrl);

    // 1. Open the Side Panel
    const sidePanelBtn = page.locator('#side-panel-btn');
    await sidePanelBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sidePanelBtn.click();

    const sidePanel = page.locator('.side-panel-container');
    await sidePanel.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await sidePanel.isVisible(), 'Side panel container must be visible');

    // Verify side panel position (docked on right: x approx 1280 - 360 = 920 to 1280)
    const sidePanelBox = await sidePanel.boundingBox();
    assert.ok(sidePanelBox, 'Side panel must have bounding box');
    assert.ok(sidePanelBox.x >= 900, `Side panel x (${sidePanelBox.x}) should be on right edge`);

    // 2. Test SearchTabsModal with Side Panel OPEN
    await page.evaluate(() => window.__triggerTabSearch?.());

    const searchOverlay = page.locator('.search-tabs-overlay');
    await searchOverlay.waitFor({ state: 'visible', timeout: 3000 });

    // Check DOM hierarchy: must be direct child of body (via ModalPortal)
    const isDirectChildOfBody = await page.evaluate(() => {
      const el = document.querySelector('.search-tabs-overlay');
      return el && el.parentElement === document.body;
    });
    assert.ok(isDirectChildOfBody, 'search-tabs-overlay must be rendered as direct child of document.body via ModalPortal');

    // Check z-index
    const searchZIndex = await page.evaluate(() => {
      const el = document.querySelector('.search-tabs-overlay');
      return el ? window.getComputedStyle(el).zIndex : null;
    });
    assert.equal(searchZIndex, '30000', 'search-tabs-overlay z-index must be 30000');

    // Verify elementFromPoint over the side panel returns .search-tabs-backdrop (modal is in front of sidebar)
    const elementOverSidebar = await page.evaluate(() => {
      const el = document.elementFromPoint(1100, 300);
      return el ? el.className : null;
    });
    assert.ok(
      elementOverSidebar && elementOverSidebar.includes('search-tabs-backdrop'),
      `Element over side panel (${elementOverSidebar}) must be the modal backdrop, not the side panel`
    );

    // Verify elementFromPoint over center of modal returns the search dialog or input
    const searchBox = await page.locator('.search-tabs-panel').boundingBox();
    assert.ok(searchBox, 'Search dialog must have bounding box');
    const elementAtModalCenter = await page.evaluate((box) => {
      const el = document.elementFromPoint(box.x + box.width / 2, box.y + 20);
      return el ? (el.className || el.tagName) : null;
    }, searchBox);
    assert.ok(
      elementAtModalCenter && (elementAtModalCenter.includes('search-tabs') || elementAtModalCenter.toUpperCase() === 'INPUT'),
      `Element at modal center (${elementAtModalCenter}) must be part of the modal`
    );

    // Capture visual proof of SearchTabsModal with sidebar open
    await page.screenshot({ path: path.join(screenshotDir, 'modal-search-tabs-with-sidebar.png') });

    // Close SearchTabsModal via Escape
    await page.keyboard.press('Escape');
    await searchOverlay.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await page.locator('.search-tabs-overlay').count(), 0, 'Search modal should be closed');

    // 3. Test CommandPaletteModal with Side Panel OPEN
    await page.evaluate(() => window.__triggerCommandPalette?.());
    const commandPanel = page.locator('.command-palette-panel');
    await commandPanel.waitFor({ state: 'visible', timeout: 3000 });

    const cmdIsDirectBody = await page.evaluate(() => {
      const el = document.querySelector('.command-palette-panel')?.closest('.search-tabs-overlay');
      return el && el.parentElement === document.body;
    });
    assert.ok(cmdIsDirectBody, 'command palette overlay must be rendered as direct child of document.body via ModalPortal');

    const cmdElementOverSidebar = await page.evaluate(() => {
      const el = document.elementFromPoint(1100, 300);
      return el ? el.className : null;
    });
    assert.ok(
      cmdElementOverSidebar && cmdElementOverSidebar.includes('search-tabs-backdrop'),
      `Element over side panel (${cmdElementOverSidebar}) must be the command palette backdrop`
    );

    await page.screenshot({ path: path.join(screenshotDir, 'modal-command-palette-with-sidebar.png') });

    await page.keyboard.press('Escape');
    await commandPanel.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await page.locator('.command-palette-panel').count(), 0, 'Command palette should be closed');

    // 4. Test ProfileEditorModal with Side Panel OPEN
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('invisurf:open-profile-editor', { detail: { mode: 'create' } }));
    });

    const profileOverlay = page.locator('.profile-editor-overlay');
    await profileOverlay.waitFor({ state: 'visible', timeout: 3000 });

    const profileIsDirectBody = await page.evaluate(() => {
      const el = document.querySelector('.profile-editor-overlay');
      return el && el.parentElement === document.body;
    });
    assert.ok(profileIsDirectBody, 'profile-editor-overlay must be rendered as direct child of document.body via ModalPortal');

    const profileZIndex = await page.evaluate(() => {
      const el = document.querySelector('.profile-editor-overlay');
      return el ? window.getComputedStyle(el).zIndex : null;
    });
    assert.equal(profileZIndex, '30000', 'profile-editor-overlay z-index must be 30000');

    // Check dialog position: must be vertically centered in the viewport, not constrained or cut off below header
    const profileDialogBox = await page.locator('.profile-editor-dialog').boundingBox();
    assert.ok(profileDialogBox, 'Profile editor dialog must have bounding box');
    // In an 800px high window, a centered dialog will have top around (800 - height) / 2
    const expectedApproxTop = (800 - profileDialogBox.height) / 2;
    assert.ok(
      Math.abs(profileDialogBox.y - expectedApproxTop) < 60,
      `Dialog y position (${profileDialogBox.y}) should be approximately centered (~${expectedApproxTop})`
    );

    // Verify elementFromPoint over sidebar returns .profile-editor-backdrop
    const profileElementOverSidebar = await page.evaluate(() => {
      const el = document.elementFromPoint(1100, 300);
      return el ? el.className : null;
    });
    assert.ok(
      profileElementOverSidebar && profileElementOverSidebar.includes('profile-editor-backdrop'),
      `Element over side panel (${profileElementOverSidebar}) must be the profile editor backdrop`
    );

    await page.screenshot({ path: path.join(screenshotDir, 'modal-profile-editor-with-sidebar.png') });

    // Close profile editor modal via Cancel button
    const cancelBtn = page.locator('.profile-editor-btn--secondary');
    await cancelBtn.click();
    await profileOverlay.waitFor({ state: 'detached', timeout: 2000 });

    // 5. Close the Side Panel and verify modals work identically without sidebar view
    await sidePanelBtn.click();
    await sidePanel.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await page.locator('.side-panel-container').count(), 0, 'Side panel should be closed');

    // Trigger SearchTabsModal without sidebar
    await page.evaluate(() => window.__triggerTabSearch?.());
    await searchOverlay.waitFor({ state: 'visible', timeout: 3000 });

    const searchBoxNoSidebar = await page.locator('.search-tabs-panel').boundingBox();
    assert.ok(searchBoxNoSidebar, 'Search dialog must be visible without sidebar');
    // Should be centered horizontally in 1280px viewport
    const expectedCenterX = (1280 - searchBoxNoSidebar.width) / 2;
    assert.ok(
      Math.abs(searchBoxNoSidebar.x - expectedCenterX) < 10,
      `Search dialog should be horizontally centered (got ${searchBoxNoSidebar.x}, expected ~${expectedCenterX})`
    );

    await page.screenshot({ path: path.join(screenshotDir, 'modal-search-tabs-without-sidebar.png') });

    await page.keyboard.press('Escape');
    await searchOverlay.waitFor({ state: 'detached', timeout: 2000 });

    // Trigger ProfileEditorModal without sidebar
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('invisurf:open-profile-editor', { detail: { mode: 'create' } }));
    });
    await profileOverlay.waitFor({ state: 'visible', timeout: 3000 });

    const profileBoxNoSidebar = await page.locator('.profile-editor-dialog').boundingBox();
    assert.ok(profileBoxNoSidebar, 'Profile dialog must be visible without sidebar');
    const expectedProfileCenterX = (1280 - profileBoxNoSidebar.width) / 2;
    assert.ok(
      Math.abs(profileBoxNoSidebar.x - expectedProfileCenterX) < 10,
      `Profile dialog should be horizontally centered (got ${profileBoxNoSidebar.x}, expected ~${expectedProfileCenterX})`
    );

    await page.screenshot({ path: path.join(screenshotDir, 'modal-profile-editor-without-sidebar.png') });

    await page.locator('.profile-editor-btn--secondary').click();
    await profileOverlay.waitFor({ state: 'detached', timeout: 2000 });

    await page.close();
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
    assert.equal(consoleErrors.length, 0, `Expected 0 console errors, but got: ${consoleErrors.join(', ')}`);
  });
});
