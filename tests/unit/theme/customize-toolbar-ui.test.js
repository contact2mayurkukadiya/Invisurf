'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Customize Toolbar & Sidebar UI (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const indexUrl = 'file://' + path.join(ROOT, 'renderer/dist/index.html');
  const screenshotPath = path.join(ROOT, 'customize-toolbar-sidebar.png');

  let browser;

  test('launches browser instance for Customize Toolbar test', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('verifies Customize Toolbar sidebar UI, toggles, toolbar buttons, and reset', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.addInitScript(() => {
      const noopListener = () => () => {};
      let stateChangedHandler = null;
      let overlayHostEventHandler = null;
      window.__invocations = {
        navigatedUrls: [],
        splitEntered: [],
        stealthCreated: 0,
        ghostCreated: 0,
        printed: 0,
        contextMenuShown: [],
        savedConfigs: [],
      };

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
        onSidePanelStateChanged: (handler) => {
          stateChangedHandler = handler;
          return () => { stateChangedHandler = null; };
        },
        onChromeOverlayV1HostEvent: (handler) => {
          overlayHostEventHandler = handler;
          return () => { overlayHostEventHandler = null; };
        },
        onDownloadsStarted: noopListener,
        onDownloadsProgress: noopListener,
        onDownloadsDone: noopListener,
        onDownloadsUpdated: noopListener,
        onDownloadsShowAttention: noopListener,
        onGhostClickThroughChanged: noopListener,
        bookmarksGet: () => Promise.resolve({ bar: [] }),
        historySearch: () => Promise.resolve({ items: [] }),
        profileList: () => Promise.resolve([{ profileId: 'profile-default', displayName: 'Default' }]),
        profileGetCurrent: () => Promise.resolve({ profileId: 'profile-default', displayName: 'Default' }),
        profileGetToolbarConfig: () => Promise.resolve(null),
        profileSetToolbarConfig: (payload) => {
          window.__invocations.savedConfigs.push(payload);
          return Promise.resolve({ ok: true });
        },
        showToolbarContextMenu: (payload) => {
          window.__invocations.contextMenuShown.push(payload);
          return Promise.resolve(null);
        },
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        navigate: (tabId, url) => {
          window.__invocations.navigatedUrls.push({ tabId, url });
        },
        splitTabEnter: (tabId, target) => {
          window.__invocations.splitEntered.push({ tabId, target });
        },
        createStealthWindow: () => {
          window.__invocations.stealthCreated++;
        },
        createGhostWindow: () => {
          window.__invocations.ghostCreated++;
        },
        runMenuCommand: (cmd) => {
          if (cmd === 'print-active-tab') window.__invocations.printed++;
        },
        newTab: () => {},
        switchTab: () => {},
        closeTab: () => {},
        tabSetAudioMuted: () => {},
        tabMenuSyncLabels: () => {},
        appLog: () => {},
      };

      window.__triggerSidePanelState = (state) => {
        if (stateChangedHandler) stateChangedHandler(state);
      };
      window.__triggerOverlayHostEvent = (data) => {
        if (overlayHostEventHandler) overlayHostEventHandler(data);
      };
    });

    await page.goto(indexUrl);

    // 1. Initial State: Forward button is visible, Home and Split buttons are not
    const forwardBtn = page.locator('#forward-btn');
    await assert.doesNotReject(forwardBtn.waitFor({ state: 'visible', timeout: 5000 }));
    assert.equal(await page.locator('#home-btn').count(), 0);
    assert.equal(await page.locator('#split-view-btn').count(), 0);

    // 2. Open Customize Toolbar via side panel trigger
    await page.evaluate(() => {
      window.__triggerSidePanelState({ isOpen: true, activePanelId: 'customize-toolbar' });
    });

    const panelContainer = page.locator('.side-panel-container');
    await assert.doesNotReject(panelContainer.waitFor({ state: 'visible', timeout: 5000 }));

    // Verify Side Panel header title is "Customize Toolbar"
    const headerTitle = page.locator('.side-panel-header-title');
    assert.equal(await headerTitle.textContent(), 'Customize Toolbar');

    // Verify subheader back button with "Toolbar" label has been removed
    const backBtn = page.locator('.customize-toolbar-back-btn');
    assert.equal(await backBtn.count(), 0);

    // Verify preview card and description
    const previewDesc = page.locator('.customize-toolbar-preview-desc');
    assert.equal(await previewDesc.textContent(), 'Choose what buttons show in the toolbar');

    const resetBtn = page.locator('.customize-toolbar-reset-btn');
    await assert.doesNotReject(resetBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // 3. Verify section titles
    const sectionTitles = await page.locator('.customize-toolbar-section-title').allTextContents();
    assert.ok(sectionTitles.includes('Navigation'));
    assert.ok(sectionTitles.some(t => t.includes('InviSurf') || t.includes('Chrome')));

    // Verify new options: Arrange Window & Transparency Mode
    const arrangeRow = page.locator('.customize-toolbar-row', { hasText: 'Arrange Window' });
    assert.equal(await arrangeRow.count(), 1);
    const transparencyRow = page.locator('.customize-toolbar-row', { hasText: 'Transparency Mode' });
    assert.equal(await transparencyRow.count(), 1);

    // 4. Toggle "Home" ON
    const homeRow = page.locator('.customize-toolbar-row', { hasText: 'Home' }).first();
    const homeSwitch = homeRow.locator('.toolbar-toggle-switch');
    assert.ok(!(await homeSwitch.getAttribute('class')).includes('active'));
    await homeSwitch.click();

    // Verify Home toggle switch became active
    assert.ok((await homeSwitch.getAttribute('class')).includes('active'));

    // Verify #home-btn is now visible in the toolbar!
    const homeBtn = page.locator('#home-btn');
    await assert.doesNotReject(homeBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // Click #home-btn and verify NTP navigation was triggered
    await homeBtn.click();
    const navHistory = await page.evaluate(() => window.__invocations.navigatedUrls);
    assert.ok(navHistory.length > 0);
    assert.ok(navHistory[0].url.includes('newtab'));

    // 5. Toggle "Open In Split View" ON
    const splitRow = page.locator('.customize-toolbar-row', { hasText: 'Open In Split View' });
    const splitSwitch = splitRow.locator('.toolbar-toggle-switch');
    await splitSwitch.click();
    assert.ok((await splitSwitch.getAttribute('class')).includes('active'));

    // Verify #split-view-btn is now visible in the toolbar!
    const splitBtn = page.locator('#split-view-btn');
    await assert.doesNotReject(splitBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // Click #split-view-btn and verify splitTabEnter was called with 'choose-tab'
    await splitBtn.click();
    const splitCalls = await page.evaluate(() => window.__invocations.splitEntered);
    assert.equal(splitCalls.length, 1);
    assert.equal(splitCalls[0].target, 'choose-tab');

    // 6. Toggle "New Incognito window" ON
    const incognitoRow = page.locator('.customize-toolbar-row', { hasText: 'New Incognito window' });
    await incognitoRow.locator('.toolbar-toggle-switch').click();
    const incognitoBtn = page.locator('#incognito-toolbar-btn');
    await assert.doesNotReject(incognitoBtn.waitFor({ state: 'visible', timeout: 2000 }));
    await incognitoBtn.click();
    const stealthCount = await page.evaluate(() => window.__invocations.stealthCreated);
    assert.equal(stealthCount, 1);

    // 7. Toggle "Bookmarks" ON
    const bookmarksRow = page.locator('.customize-toolbar-row', { hasText: 'Bookmarks' });
    await bookmarksRow.locator('.toolbar-toggle-switch').click();
    const pinnedBookmarksBtn = page.locator('#side-panel-pin-bookmarks');
    await assert.doesNotReject(pinnedBookmarksBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // 8. Test Right Click context menu on toolbar button opens overlay popup
    await homeBtn.click({ button: 'right' });
    const contextCalls = await page.evaluate(() => window.__invocations.contextMenuShown);
    assert.ok(contextCalls.length > 0);
    assert.equal(contextCalls[contextCalls.length - 1].buttonId, 'home');

    // Verify overlay context menu popup is visible in DOM
    const contextMenuPopup = page.locator('.toolbar-context-menu');
    await assert.doesNotReject(contextMenuPopup.waitFor({ state: 'visible', timeout: 2000 }));

    // Verify options: Unpin and Customize Toolbar
    const menuItems = await page.locator('.toolbar-context-menu-item').allTextContents();
    assert.ok(menuItems.includes('Unpin'));
    assert.ok(menuItems.includes('Customize Toolbar'));

    // Capture screenshot showing the overlay popup opened
    await page.screenshot({ path: screenshotPath, fullPage: false });
    assert.ok(require('fs').existsSync(screenshotPath), 'Screenshot must be saved to disk');

    // Click "Unpin" option
    const unpinBtn = page.locator('.toolbar-context-menu-item', { hasText: 'Unpin' });
    await unpinBtn.click();

    // Verify overlay popup closed
    await assert.doesNotReject(contextMenuPopup.waitFor({ state: 'detached', timeout: 2000 }));

    // Verify #home-btn is now toggled off and removed from toolbar!
    await assert.doesNotReject(homeBtn.waitFor({ state: 'detached', timeout: 2000 }));

    // 9. Re-toggle Home to test "Reset to Default" button
    await homeSwitch.click();
    await assert.doesNotReject(homeBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // 10. Click "Reset to Default" and verify Home and Split buttons disappear
    await resetBtn.click();
    await assert.doesNotReject(homeBtn.waitFor({ state: 'detached', timeout: 2000 }));
    await assert.doesNotReject(splitBtn.waitFor({ state: 'detached', timeout: 2000 }));
  });

  after(async () => {
    if (browser) await browser.close();
  });
});
