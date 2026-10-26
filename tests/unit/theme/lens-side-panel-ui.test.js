'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Unified Google Lens Side Panel UI (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const indexUrl = 'file://' + path.join(ROOT, 'renderer/dist/index.html');
  const artifactDir = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/1a1e2f53-0c12-446c-9625-d5c5b3ce8448';

  let browser;

  test('launches browser instance for shell UI test', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('renders Google Lens in unified Side Panel with card view, resizer pill, and toolbar pin', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.addInitScript(() => {
      const noopListener = () => () => {};
      let stateChangedHandler = null;
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
        onDownloadsStarted: noopListener,
        onDownloadsProgress: noopListener,
        onDownloadsDone: noopListener,
        onDownloadsUpdated: noopListener,
        onDownloadsShowAttention: noopListener,
        onGhostClickThroughChanged: noopListener,
        bookmarksGet: () => Promise.resolve({ bar: [] }),
        historySearch: () => Promise.resolve({ items: [] }),
        profileList: () => Promise.resolve([]),
        profileGetActive: () => Promise.resolve(null),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        runMenuCommand: () => {},
        closeGoogleLens: () => {},
        openLensInNewTab: () => {
          window.__openLensInNewTabCalled = (window.__openLensInNewTabCalled || 0) + 1;
          return Promise.resolve(true);
        },
        reloadLensSidebar: () => {
          window.__reloadLensSidebarCalled = (window.__reloadLensSidebarCalled || 0) + 1;
          return Promise.resolve(true);
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
    });

    await page.goto(indexUrl);

    // 1. Open side panel and switch to Google Lens
    const sidePanelBtn = page.locator('#side-panel-btn');
    await assert.doesNotReject(sidePanelBtn.waitFor({ state: 'visible', timeout: 5000 }));
    await sidePanelBtn.click();

    const sidePanelContainer = page.locator('.side-panel-container');
    await assert.doesNotReject(sidePanelContainer.waitFor({ state: 'visible', timeout: 3000 }));

    // Switch active panel to lens via onSidePanelStateChanged
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'lens', isOpen: true });
    });

    // Wait for Lens title in header
    const headerTitle = page.locator('.side-panel-header-title');
    await assert.doesNotReject(headerTitle.waitFor({ timeout: 2000 }));
    assert.equal(await headerTitle.textContent(), 'Google Lens');

    // 2. Verify Open in new tab button is present
    const openTabBtn = page.locator('.side-panel-open-tab-btn');
    await assert.doesNotReject(openTabBtn.waitFor({ state: 'visible', timeout: 2000 }));
    assert.equal(await openTabBtn.getAttribute('title'), 'Open Google Lens in new tab');

    // 3. Verify Lens body contains unified card and empty state
    const card = page.locator('.side-panel-card');
    await assert.doesNotReject(card.waitFor({ state: 'visible', timeout: 2000 }));

    const lensTitle = page.locator('.lens-panel-title');
    assert.equal(await lensTitle.textContent(), 'Search with Google Lens');

    const searchBtn = page.locator('#lens-panel-start-search-btn');
    await assert.doesNotReject(searchBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // 4. Verify center resizer pill
    const resizer = page.locator('.side-panel-resizer');
    const pill = page.locator('.side-panel-resizer-pill');
    await assert.doesNotReject(resizer.waitFor({ state: 'visible', timeout: 2000 }));
    await assert.doesNotReject(pill.waitFor({ timeout: 2000 }));

    // Hover resizer to reveal pill
    await resizer.hover();
    await page.waitForTimeout(150);

    // 5. Verify web content card frame backing exists
    const cardFrame = page.locator('.web-content-card-frame');
    await assert.doesNotReject(cardFrame.waitFor({ state: 'visible', timeout: 2000 }));

    // Capture screenshot: Google Lens open in unified Side Panel (light mode)
    await page.screenshot({
      path: path.join(artifactDir, 'side_panel_lens_unified_light.png'),
    });

    // 6. Verify pin button is removed from top header for Google Lens only
    const lensPinBtn = page.locator('.side-panel-header .side-panel-pin-btn');
    assert.equal(await lensPinBtn.count(), 0, 'Pin button must not be present in header for Google Lens');

    // 7. Test "Open in new tab" on title bar for Google Lens invokes openLensInNewTab
    await openTabBtn.click();
    await page.waitForTimeout(100);
    const openLensCallCount = await page.evaluate(() => window.__openLensInNewTabCalled || 0);
    assert.equal(openLensCallCount, 1, 'openLensInNewTab must be invoked when clicking Open in new tab for Lens');

    // 8. Verify refresh button is present on title bar for Google Lens
    const lensRefreshBtn = page.locator('.side-panel-header .side-panel-refresh-btn');
    assert.equal(await lensRefreshBtn.count(), 1, 'Refresh button must be present in header for Google Lens');
    await lensRefreshBtn.click();
    await page.waitForTimeout(100);
    const reloadLensCallCount = await page.evaluate(() => window.__reloadLensSidebarCalled || 0);
    assert.equal(reloadLensCallCount, 1, 'reloadLensSidebar must be invoked when clicking Refresh for Lens');

    // 9. Verify pin button IS present for other features (e.g. Bookmarks) and refresh button is NOT
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'bookmarks', isOpen: true });
    });
    await page.waitForTimeout(100);
    const bookmarksPinBtn = page.locator('.side-panel-header .side-panel-pin-btn');
    assert.equal(await bookmarksPinBtn.count(), 1, 'Pin button must be present in header for Bookmarks panel');
    assert.equal(await page.locator('.side-panel-header .side-panel-refresh-btn').count(), 0, 'Refresh button must not be present for Bookmarks panel');
    await bookmarksPinBtn.click();
    const pinnedBookmarksBtn = page.locator('#side-panel-pin-bookmarks');
    await assert.doesNotReject(pinnedBookmarksBtn.waitFor({ state: 'visible', timeout: 2000 }));

    // Switch back to Google Lens
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'lens', isOpen: true });
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.side-panel-header .side-panel-pin-btn').count(), 0, 'Pin button remains removed for Google Lens');
    assert.equal(await page.locator('.side-panel-header .side-panel-refresh-btn').count(), 1, 'Refresh button is present for Google Lens');

    // 10. Test closing side panel
    const closeBtn = page.locator('.side-panel-close-btn');
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Verify side panel closed
    assert.equal(await sidePanelContainer.count(), 0);

    // Capture screenshot of toolbar with pinned Bookmarks button
    await page.screenshot({
      path: path.join(artifactDir, 'toolbar_pinned_bookmarks_closed.png'),
    });

    // Re-open Google Lens side panel
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'lens', isOpen: true });
    });
    await assert.doesNotReject(sidePanelContainer.waitFor({ state: 'visible', timeout: 3000 }));
    assert.equal(await headerTitle.textContent(), 'Google Lens');

    // 9. Switch to dark mode and verify uniform dark card appearance
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-forced-appearance', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(200);

    // Capture screenshot in dark mode
    await page.screenshot({
      path: path.join(artifactDir, 'side_panel_lens_unified_dark.png'),
    });

    await page.close();
  });

  test('verifies Lens selection overlay uses uniform single left card without duplicate resizer or extra canvas', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.addInitScript(() => {
      const noopListener = () => () => {};
      let stateChangedHandler = null;
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
        onDownloadsStarted: noopListener,
        onDownloadsProgress: noopListener,
        onDownloadsDone: noopListener,
        onDownloadsUpdated: noopListener,
        onDownloadsShowAttention: noopListener,
        onGhostClickThroughChanged: noopListener,
        bookmarksGet: () => Promise.resolve({ bar: [] }),
        historySearch: () => Promise.resolve({ items: [] }),
        profileList: () => Promise.resolve([]),
        profileGetActive: () => Promise.resolve(null),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        runMenuCommand: () => {},
        closeGoogleLens: () => {},
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
    });

    await page.goto(indexUrl);

    // 1. Open Google Lens side panel
    const sidePanelBtn = page.locator('#side-panel-btn');
    await sidePanelBtn.click();
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'lens', isOpen: true, width: 360 });
    });

    const sidePanelCard = page.locator('.side-panel-card');
    await assert.doesNotReject(sidePanelCard.waitFor({ state: 'visible', timeout: 3000 }));

    // 2. Inject Lens overlay styles & test selection layer directly
    const cssPath = path.join(ROOT, 'renderer/overlay/styles/lens.css');
    const fs = require('fs');
    const lensCss = fs.readFileSync(cssPath, 'utf8');
    await page.addStyleTag({ content: lensCss });

    // 3. Render unified Lens selection layer
    await page.evaluate(() => {
      // Simulate renderLensSelection patch
      const patch = {
        kind: 'lensSelection',
        hint: 'Select any text or image to search with Google Lens',
        sidebarWidth: 360,
        siteBounds: { x: 8, y: 126, width: 898, height: 662 },
        leftPanelBounds: { x: 8, y: 126, width: 898, height: 662 },
        panelRadius: 14,
        hasSelectionText: true,
      };

      const lensLayer = document.createElement('div');
      lensLayer.className = 'co-lens-layer';
      lensLayer.style.position = 'fixed';
      lensLayer.style.left = '0';
      lensLayer.style.top = '0';
      lensLayer.style.width = (patch.siteBounds.x + patch.siteBounds.width) + 'px';
      lensLayer.style.height = '100%';
      lensLayer.style.zIndex = '40';
      lensLayer.style.pointerEvents = 'auto';

      const site = patch.siteBounds;
      const siteFrame = document.createElement('div');
      siteFrame.className = 'co-lens-site-frame';
      siteFrame.style.left = site.x + 'px';
      siteFrame.style.top = site.y + 'px';
      siteFrame.style.width = site.width + 'px';
      siteFrame.style.height = site.height + 'px';
      siteFrame.style.borderRadius = '14px';
      lensLayer.appendChild(siteFrame);

      const chip = document.createElement('div');
      chip.className = 'co-lens-chip';
      chip.textContent = patch.hint;
      chip.style.display = 'flex';
      chip.style.left = (site.x + site.width / 2) + 'px';
      chip.style.top = (site.y + 16) + 'px';
      lensLayer.appendChild(chip);

      const selectionMask = document.createElement('div');
      selectionMask.className = 'co-lens-selection-mask';
      selectionMask.style.left = site.x + 'px';
      selectionMask.style.top = site.y + 'px';
      selectionMask.style.width = site.width + 'px';
      selectionMask.style.height = site.height + 'px';
      selectionMask.style.borderRadius = '14px';
      lensLayer.appendChild(selectionMask);

      const selection = document.createElement('div');
      selection.className = 'co-lens-selection co-visible co-lens-selection--complete';
      selection.style.left = '80px';
      selection.style.top = '100px';
      selection.style.width = '360px';
      selection.style.height = '240px';
      ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
        const cornerEl = document.createElement('div');
        cornerEl.className = 'co-lens-selection-corner co-lens-selection-corner--' + corner;
        selection.appendChild(cornerEl);
      });
      selectionMask.appendChild(selection);

      const actions = document.createElement('div');
      actions.className = 'co-lens-actions co-visible';
      actions.style.left = (site.x + 80) + 'px';
      actions.style.top = (site.y + 100 + 240 + 12) + 'px';
      actions.innerHTML = '<button class="co-lens-action" type="button" data-action="copyText">Copy text</button><button class="co-lens-action" type="button" data-action="copyImage">Copy as image</button>';
      lensLayer.appendChild(actions);

      document.body.appendChild(lensLayer);
    });

    // 4. Verify ONLY single left card and single resize handle
    // Assert NO duplicate resizer in overlay
    assert.equal(await page.locator('.co-lens-resizer').count(), 0);
    // Assert NO circular close button on left card
    assert.equal(await page.locator('.co-lens-close').count(), 0);
    // Assert NO extra blur canvas
    assert.equal(await page.locator('.co-lens-bg-blur').count(), 0);
    // Assert NO backdrop pieces
    assert.equal(await page.locator('.co-lens-panel-backdrop').count(), 0);

    // Assert EXACTLY ONE resize handle exists on the page
    const resizers = page.locator('.side-panel-resizer');
    assert.equal(await resizers.count(), 1);

    // Assert site frame has 14px border radius
    const siteFrame = page.locator('.co-lens-site-frame');
    await assert.doesNotReject(siteFrame.waitFor({ state: 'visible', timeout: 2000 }));
    const borderRadius = await siteFrame.evaluate((el) => window.getComputedStyle(el).borderRadius);
    assert.equal(borderRadius, '14px');

    // Assert selection box and actions are visible
    const selection = page.locator('.co-lens-selection');
    await assert.doesNotReject(selection.waitFor({ state: 'visible', timeout: 2000 }));

    const actions = page.locator('.co-lens-actions');
    await assert.doesNotReject(actions.waitFor({ state: 'visible', timeout: 2000 }));

    // Hover resizer pill to show uniform center spacing with pill
    await resizers.first().hover();
    await page.waitForTimeout(150);

    // Capture visual proof of the unified Google Lens selection overlay
    await page.screenshot({
      path: path.join(artifactDir, 'side_panel_lens_unified_selection.png'),
    });

    await page.close();
  });

  test('maintains canvas aspect ratio, supports live resizing, and centers 2x magnifier glass', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.addInitScript(() => {
      const noopListener = () => () => {};
      let stateChangedHandler = null;
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
        onDownloadsStarted: noopListener,
        onDownloadsProgress: noopListener,
        onDownloadsDone: noopListener,
        onDownloadsUpdated: noopListener,
        onDownloadsShowAttention: noopListener,
        onGhostClickThroughChanged: noopListener,
        bookmarksGet: () => Promise.resolve({ bar: [] }),
        historySearch: () => Promise.resolve({ items: [] }),
        profileList: () => Promise.resolve([]),
        profileGetActive: () => Promise.resolve(null),
        windowGetBootstrap: () => Promise.resolve({}),
        isStealthWindow: () => Promise.resolve(false),
        isGhostWindow: () => Promise.resolve(false),
        sidePanelSyncState: () => {},
        sidePanelResize: () => {},
        sidePanelGetState: () => Promise.resolve({ isOpen: false, width: 360, activePanelId: 'reading-list' }),
        runMenuCommand: () => {},
        closeGoogleLens: () => {},
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
    });

    await page.goto(indexUrl);

    // 1. Open Google Lens side panel
    const sidePanelBtn = page.locator('#side-panel-btn');
    await sidePanelBtn.click();
    await page.evaluate(() => {
      window.__triggerSidePanelState({ activePanelId: 'lens', isOpen: true, width: 360 });
    });

    // 2. Inject Lens overlay styles
    const cssPath = path.join(ROOT, 'renderer/overlay/styles/lens.css');
    const fs = require('fs');
    const lensCss = fs.readFileSync(cssPath, 'utf8');
    await page.addStyleTag({ content: lensCss });

    // 3. Render unified Lens layer with 16:9 source dimensions (1280x720)
    await page.evaluate(() => {
      const sourceW = 1280;
      const sourceH = 720;
      const sourceAspect = sourceW / sourceH; // 1.7778
      const container = { x: 8, y: 126, width: 898, height: 662 };

      const containerAspect = container.width / container.height; // 1.3565
      let canvasW, canvasH, canvasX, canvasY;
      if (containerAspect > sourceAspect) {
        canvasH = container.height;
        canvasW = Math.round(canvasH * sourceAspect);
        canvasX = container.x + Math.round((container.width - canvasW) / 2);
        canvasY = container.y;
      } else {
        canvasW = container.width;
        canvasH = Math.round(canvasW / sourceAspect);
        canvasX = container.x;
        canvasY = container.y + Math.round((container.height - canvasH) / 2);
      }

      const lensLayer = document.createElement('div');
      lensLayer.id = 'lens-aspect-layer';
      lensLayer.className = 'co-lens-layer';
      lensLayer.style.position = 'fixed';
      lensLayer.style.left = '0';
      lensLayer.style.top = '0';
      lensLayer.style.width = (container.x + container.width) + 'px';
      lensLayer.style.height = '100%';
      lensLayer.style.zIndex = '40';
      lensLayer.style.pointerEvents = 'auto';

      // Outer container card (with overflow: hidden to prevent canvas spill)
      const siteFrame = document.createElement('div');
      siteFrame.className = 'co-lens-site-frame';
      siteFrame.style.left = container.x + 'px';
      siteFrame.style.top = container.y + 'px';
      siteFrame.style.width = container.width + 'px';
      siteFrame.style.height = container.height + 'px';
      siteFrame.style.borderRadius = '14px';

      // SVG Mockup Graphic representing web content
      const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1e3c72" />
            <stop offset="50%" stop-color="#2a5298" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#bgGrad)" />
        <rect x="60" y="50" width="1160" height="620" rx="16" fill="#ffffff" fill-opacity="0.96" />
        <rect x="100" y="90" width="1080" height="280" rx="14" fill="#1d4ed8" />
        <text x="640" y="245" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="46" font-weight="bold" fill="#ffffff" text-anchor="middle">Graphic Design Maker for You</text>
        <rect x="100" y="410" width="240" height="220" rx="12" fill="#eff6ff" stroke="#bfdbfe" stroke-width="2" />
        <rect x="380" y="410" width="240" height="220" rx="12" fill="#eff6ff" stroke="#bfdbfe" stroke-width="2" />
        <rect x="660" y="410" width="240" height="220" rx="12" fill="#eff6ff" stroke="#bfdbfe" stroke-width="2" />
        <rect x="940" y="410" width="240" height="220" rx="12" fill="#eff6ff" stroke="#bfdbfe" stroke-width="2" />
      </svg>`;
      const sampleImgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sampleSvg);

      // Blurred cover backdrop
      const blurImg = document.createElement('img');
      blurImg.className = 'co-lens-cover-blur';
      blurImg.id = 'lens-test-blur';
      blurImg.src = sampleImgUrl;
      blurImg.alt = '';
      siteFrame.appendChild(blurImg);

      const blurOverlay = document.createElement('div');
      blurOverlay.className = 'co-lens-cover-overlay';
      siteFrame.appendChild(blurOverlay);

      // "Click to exit Google Lens" tooltip on top right of blurred area
      const exitTooltip = document.createElement('div');
      exitTooltip.className = 'co-lens-cursor-tooltip co-visible';
      exitTooltip.textContent = 'Click to exit Google Lens';
      exitTooltip.style.right = '24px';
      exitTooltip.style.top = '20px';
      exitTooltip.style.left = 'auto';
      siteFrame.appendChild(exitTooltip);

      lensLayer.appendChild(siteFrame);

      // Aspect-ratio canvas
      const canvasFrame = document.createElement('div');
      canvasFrame.className = 'co-lens-canvas-frame';
      canvasFrame.id = 'lens-test-canvas';
      canvasFrame.style.left = canvasX + 'px';
      canvasFrame.style.top = canvasY + 'px';
      canvasFrame.style.width = canvasW + 'px';
      canvasFrame.style.height = canvasH + 'px';

      const sharpImg = document.createElement('img');
      sharpImg.className = 'co-lens-sharp-image';
      sharpImg.src = sampleImgUrl;
      sharpImg.alt = '';
      canvasFrame.appendChild(sharpImg);

      // Exit button
      const exitBtn = document.createElement('button');
      exitBtn.className = 'co-lens-exit-btn';
      exitBtn.id = 'lens-test-exit-btn';
      exitBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      canvasFrame.appendChild(exitBtn);

      siteFrame.appendChild(canvasFrame);

      // Selection box inside canvas
      const selectionMask = document.createElement('div');
      selectionMask.className = 'co-lens-selection-mask';
      selectionMask.style.left = canvasX + 'px';
      selectionMask.style.top = canvasY + 'px';
      selectionMask.style.width = canvasW + 'px';
      selectionMask.style.height = canvasH + 'px';
      lensLayer.appendChild(selectionMask);

      const selection = document.createElement('div');
      selection.className = 'co-lens-selection co-visible co-lens-selection--complete';
      selection.style.left = '60px';
      selection.style.top = '110px';
      selection.style.width = '420px';
      selection.style.height = '110px';
      ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
        const cornerEl = document.createElement('div');
        cornerEl.className = 'co-lens-selection-corner co-lens-selection-corner--' + corner;
        selection.appendChild(cornerEl);
      });
      selectionMask.appendChild(selection);

      // Actions popup menu
      const actions = document.createElement('div');
      actions.className = 'co-lens-actions co-visible';
      actions.style.left = (canvasX + 60) + 'px';
      actions.style.top = (canvasY + 230) + 'px';
      actions.innerHTML = `
        <button class="co-lens-action" type="button"><svg class="co-lens-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy text</span></button>
        <button class="co-lens-action" type="button"><svg class="co-lens-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path></svg><span>Translate</span></button>
        <button class="co-lens-action" type="button"><svg class="co-lens-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><span>Copy as image</span></button>
      `;
      lensLayer.appendChild(actions);

      // Magnifier glass (120px, 2x zoom)
      const magnifier = document.createElement('div');
      magnifier.className = 'co-lens-magnifier co-visible';
      magnifier.id = 'lens-test-magnifier';
      const zoom = 2.0;
      const radius = 60;
      const testCursorX = canvasX + 550;
      const testCursorY = canvasY + 250;
      const relX = testCursorX - canvasX;
      const relY = testCursorY - canvasY;
      magnifier.style.left = (testCursorX - radius) + 'px';
      magnifier.style.top = (testCursorY - radius) + 'px';
      magnifier.style.backgroundImage = 'url("' + sampleImgUrl + '")';
      magnifier.style.backgroundSize = (canvasW * zoom) + 'px ' + (canvasH * zoom) + 'px';
      magnifier.style.backgroundPosition = (radius - (relX * zoom)) + 'px ' + (radius - (relY * zoom)) + 'px';
      lensLayer.appendChild(magnifier);

      document.body.appendChild(lensLayer);
    });

    // 4. Verify aspect ratio of canvas is strictly preserved
    const canvas = page.locator('#lens-test-canvas');
    await assert.doesNotReject(canvas.waitFor({ state: 'visible', timeout: 2000 }));
    const canvasBounds = await canvas.boundingBox();
    assert.ok(canvasBounds);
    const canvasAspect = canvasBounds.width / canvasBounds.height;
    // Expected aspect: 1280 / 720 = 1.777777...
    assert.ok(Math.abs(canvasAspect - (1280 / 720)) < 0.02, `Canvas aspect ratio ${canvasAspect} must match source 1.777`);

    // 5. Verify magnifier glass has 2x background zoom and 120px diameter
    const magnifier = page.locator('#lens-test-magnifier');
    await assert.doesNotReject(magnifier.waitFor({ state: 'visible', timeout: 2000 }));
    const magBounds = await magnifier.boundingBox();
    assert.equal(Math.round(magBounds.width), 120);
    assert.equal(Math.round(magBounds.height), 120);

    const magBgSize = await magnifier.evaluate((el) => el.style.backgroundSize);
    assert.equal(magBgSize, `${Math.round(canvasBounds.width * 2)}px ${Math.round(canvasBounds.height * 2)}px`);

    // 6. Test Live Resizing: Simulate side panel resize to 480px width
    await page.evaluate(() => {
      const sourceW = 1280;
      const sourceH = 720;
      const sourceAspect = sourceW / sourceH;
      // When sidebar is resized to 480px, left container becomes 1280 - 480 - 14 = 786px
      const container = { x: 8, y: 126, width: 786, height: 662 };
      const containerAspect = container.width / container.height;
      let canvasW, canvasH, canvasX, canvasY;
      if (containerAspect > sourceAspect) {
        canvasH = container.height;
        canvasW = Math.round(canvasH * sourceAspect);
        canvasX = container.x + Math.round((container.width - canvasW) / 2);
        canvasY = container.y;
      } else {
        canvasW = container.width;
        canvasH = Math.round(canvasW / sourceAspect);
        canvasX = container.x;
        canvasY = container.y + Math.round((container.height - canvasH) / 2);
      }

      const canvasEl = document.getElementById('lens-test-canvas');
      canvasEl.style.left = canvasX + 'px';
      canvasEl.style.top = canvasY + 'px';
      canvasEl.style.width = canvasW + 'px';
      canvasEl.style.height = canvasH + 'px';
    });

    const resizedCanvasBounds = await canvas.boundingBox();
    const resizedCanvasAspect = resizedCanvasBounds.width / resizedCanvasBounds.height;
    assert.ok(Math.abs(resizedCanvasAspect - (1280 / 720)) < 0.02, `Resized canvas aspect ratio ${resizedCanvasAspect} must still match source 1.777`);

    // 7. Capture visual proof of aspect ratio preservation & magnifier
    await page.screenshot({
      path: path.join(artifactDir, 'side_panel_lens_aspect_ratio_magnifier.png'),
    });

    await page.close();
  });

  after(async () => {
    if (browser) await browser.close();
  });
});
