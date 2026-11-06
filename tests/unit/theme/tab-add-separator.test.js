'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

describe('Tab Add Separator UI (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const indexUrl = 'file://' + path.join(ROOT, 'renderer/dist/index.html');

  let browser;

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('verifies tab add separator beside plus icon and hides on hover / active', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERR:', err));

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
        onChromeShellMenuOverlaySuperseded: noopListener,
        onProfileToolbarConfigUpdated: noopListener,
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
        tooltipHide: () => {},
        tooltipShow: () => {},
        getTabInfo: () => Promise.resolve({ title: 'Test Tab', url: 'https://example.com' }),
      };
    });

    await page.goto(indexUrl);

    // Wait for the tab bar and the new-tab separator element to be in the DOM
    const separator = page.locator('.tab-add-separator');
    await assert.doesNotReject(separator.waitFor({ state: 'attached', timeout: 5000 }));

    // Verify it is located right beside #add-tab
    const addTabBtn = page.locator('#add-tab');
    await assert.doesNotReject(addTabBtn.waitFor({ state: 'visible', timeout: 5000 }));

    // Initially with 1 tab (which is active), the separator is hidden because the last tab is active
    let opacity = await separator.evaluate((el) => window.getComputedStyle(el).opacity);
    assert.equal(opacity, '0', 'Separator should be hidden when the single last tab is active');

    // Add a second tab by clicking #add-tab
    await addTabBtn.click();
    await page.waitForTimeout(300);

    // Click the first tab to make it active so the second (last) tab is inactive
    const firstTab = page.locator('.tab').first();
    await firstTab.click();
    await page.waitForTimeout(350);

    // With the first tab active and the second tab unhovered, the separator beside the plus icon should be visible!
    opacity = await separator.evaluate((el) => window.getComputedStyle(el).opacity);
    assert.equal(opacity, '1', 'Separator should be visible when the last tab is not active and not hovered');

    // Capture visual proof of separator beside plus button
    const screenshotDir = path.join(ROOT, 'test-results', 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, 'tab-add-separator.png');
    await page.locator('.tab-bar').screenshot({ path: screenshotPath });

    // Now hover over the last tab near the plus icon
    const lastTab = page.locator('.tab').last();
    await lastTab.hover();
    await page.waitForTimeout(250); // allow 0.2s transition

    // When the last tab is hovered, the separator beside the plus button MUST be removed (opacity 0)
    opacity = await separator.evaluate((el) => window.getComputedStyle(el).opacity);
    assert.equal(opacity, '0', 'Separator should hide (opacity 0) on hover of the last tab');

    // Move mouse away from the last tab (hover over omnibox or back button)
    await page.locator('#back-btn').hover();
    await page.waitForTimeout(250);

    // Separator should reappear
    opacity = await separator.evaluate((el) => window.getComputedStyle(el).opacity);
    assert.equal(opacity, '1', 'Separator should become visible again when hover ends');

    // Click the last tab to make it active
    await lastTab.click();
    await page.waitForTimeout(250);

    // When the last tab becomes active, separator hides again
    opacity = await separator.evaluate((el) => window.getComputedStyle(el).opacity);
    assert.equal(opacity, '0', 'Separator should hide when the last tab is active');

    await page.close();
  });

  test('verifies even spacing around plus icon when tab bar is full without touching right edge', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });

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
        onSidePanelStateChanged: () => () => {},
        onChromeOverlayV1HostEvent: () => () => {},
        onChromeShellMenuOverlaySuperseded: noopListener,
        onProfileToolbarConfigUpdated: noopListener,
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
        profileSetToolbarConfig: () => Promise.resolve({ ok: true }),
        showToolbarContextMenu: () => Promise.resolve(null),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        tabSetAudioMuted: () => {},
        tabMenuSyncLabels: () => {},
        appLog: () => {},
        tooltipHide: () => {},
        tooltipShow: () => {},
        getTabInfo: () => Promise.resolve({ title: 'Test Tab', url: 'https://example.com' }),
      };
    });

    await page.goto(indexUrl);

    const addTabBtn = page.locator('#add-tab');
    for (let i = 0; i < 15; i++) {
      await addTabBtn.click();
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(400);

    const metrics = await page.evaluate(() => {
      const bar = document.querySelector('.tab-bar');
      const addBtn = document.querySelector('#add-tab');
      const container = document.querySelector('.tab-container');
      const tabs = Array.from(document.querySelectorAll('.tab'));
      const lastTab = tabs[tabs.length - 1];

      const barRect = bar.getBoundingClientRect();
      const addRect = addBtn.getBoundingClientRect();
      const lastTabRect = lastTab.getBoundingClientRect();

      return {
        topSpacing: addRect.top - barRect.top,
        bottomSpacing: barRect.bottom - addRect.bottom,
        rightSpacing: barRect.right - addRect.right,
        leftSpacingFromLastTab: addRect.left - lastTabRect.right,
        tabCount: tabs.length,
        containerOverflow: window.getComputedStyle(container).overflow,
      };
    });

    assert.equal(metrics.tabCount, 16, 'Should have 16 tabs');
    assert.equal(metrics.containerOverflow, 'visible', 'Tab container should have visible overflow so outer rounded corner of active tab is not clipped');
    assert.ok(metrics.rightSpacing >= 6 && metrics.rightSpacing <= 10, `Right spacing should be ~8px, got ${metrics.rightSpacing}`);
    assert.ok(metrics.leftSpacingFromLastTab >= 6 && metrics.leftSpacingFromLastTab <= 10, `Left spacing from last tab should be ~8px, got ${metrics.leftSpacingFromLastTab}`);
    assert.ok(Math.abs(metrics.topSpacing - metrics.bottomSpacing) <= 1, `Top and bottom spacing should be balanced, got top: ${metrics.topSpacing}, bottom: ${metrics.bottomSpacing}`);

    await page.close();
  });

  after(async () => {
    if (browser) await browser.close();
  });
});
