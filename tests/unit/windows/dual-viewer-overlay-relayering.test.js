'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const overlayManager = require('../../../main/windows/overlayManager');
const lensManager = require('../../../main/windows/lensManager');
const sidePanelManager = require('../../../main/windows/sidePanelManager');
const tabManager = require('../../../main/windows/tabManager');

function createMockView(name) {
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let borderRadius = 0;
  return {
    name,
    getBounds: () => ({ ...bounds }),
    setBounds: (b) => { bounds = { ...b }; },
    setBorderRadius: (r) => { borderRadius = r; },
    getBorderRadius: () => borderRadius,
    setBackgroundColor: () => {},
    webContents: {
      isDestroyed: () => false,
      send: () => {},
      focus: () => {},
      capturePage: async () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 1000, height: 800 }),
        toJPEG: () => Buffer.from('fake-jpeg-data'),
        toPNG: () => Buffer.from('fake-png-data'),
        crop: () => ({
          toPNG: () => Buffer.from('fake-png-data'),
        }),
      }),
      setZoomFactor: () => {},
      getZoomFactor: () => 1.0,
      disableDeviceEmulation: () => {},
      getURL: () => 'https://example.com',
      getUserAgent: () => 'Mozilla/5.0 Chrome/120.0.0.0',
      loadURL: async () => {},
      executeJavaScript: async () => null,
      on: () => {},
      removeListener: () => {},
    },
  };
}

function createMockContext() {
  const children = [];
  const contentView = {
    children,
    addChildView: (v) => {
      const idx = children.indexOf(v);
      if (idx !== -1) children.splice(idx, 1);
      children.push(v);
    },
    removeChildView: (v) => {
      const idx = children.indexOf(v);
      if (idx !== -1) children.splice(idx, 1);
    },
  };

  const window = {
    contentView,
    getContentBounds: () => ({ width: 1200, height: 800 }),
    isDestroyed: () => false,
    isFullScreen: () => false,
    focus: () => {},
    webContents: {
      isDestroyed: () => false,
      send: () => {},
      focus: () => {},
    },
  };

  const tab1 = createMockView('tab-1-view');
  const chromeOverlayView = createMockView('chromeOverlayView');
  const chromeShellMenuOverlayView = createMockView('chromeShellMenuOverlayView');
  const chromeOmniboxOverlayView = createMockView('chromeOmniboxOverlayView');

  return {
    window,
    activeTabId: 'tab-1',
    tabs: { 'tab-1': tab1 },
    chromeOverlayView,
    chromeShellMenuOverlayView,
    chromeOmniboxOverlayView,
    lensSessions: new Map(),
    sidePanelState: {
      isOpen: false,
      width: 360,
      activePanelId: 'lens',
    },
  };
}

describe('Dual-Viewer Overlay Relayering and Modal Compatibility', () => {
  after(() => {
    env.cleanup();
  });

  test('ensureChromeOverlayOnTop layers both content viewers beneath overlay menus', () => {
    const ctx = createMockContext();

    // Setup Lens session with active search results and sidebar view
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.hasSearchResults = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');

    // Run ensureChromeOverlayOnTop
    overlayManager.ensureChromeOverlayOnTop(ctx);

    const children = ctx.window.contentView.children;

    // Both content viewers must be in children
    const lensHostIdx = children.indexOf(lensSession.sidebarHostView);
    const menuIdx = children.indexOf(ctx.chromeShellMenuOverlayView);
    const omniboxIdx = children.indexOf(ctx.chromeOmniboxOverlayView);
    const overlayIdx = children.indexOf(ctx.chromeOverlayView);

    assert.ok(lensHostIdx !== -1, 'Lens sidebar host view should be added');
    assert.ok(menuIdx !== -1, 'Chrome shell menu overlay should be added');
    assert.ok(omniboxIdx !== -1, 'Omnibox overlay should be added');

    // TIER 2 Overlays must be strictly ABOVE the TIER 1 right-side content viewer
    assert.ok(menuIdx > lensHostIdx, 'Menu overlay must be stacked above Lens sidebar host view');
    assert.ok(omniboxIdx > lensHostIdx, 'Omnibox overlay must be stacked above Lens sidebar host view');
    assert.ok(overlayIdx > lensHostIdx, 'Chrome overlay view must be stacked above Lens sidebar host view');
  });

  test('layoutLensSidebar re-invokes ensureChromeOverlayOnTop to preserve menu stacking', () => {
    const ctx = createMockContext();
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.hasSearchResults = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');

    // Initial layout
    lensManager.layoutLensSidebar(ctx, 'tab-1');

    const children = ctx.window.contentView.children;
    const lensHostIdx = children.indexOf(lensSession.sidebarHostView);
    const menuIdx = children.indexOf(ctx.chromeShellMenuOverlayView);

    assert.ok(lensHostIdx !== -1);
    assert.ok(menuIdx !== -1);
    assert.ok(menuIdx > lensHostIdx, 'Menu overlay must be on top after layoutLensSidebar');
  });

  test('attachSidePanelWebContentView keeps overlay menus on top', () => {
    const ctx = createMockContext();
    ctx.sidePanelState.isOpen = true;

    sidePanelManager.attachSidePanelWebContentView(ctx, 'https://example.com');

    const children = ctx.window.contentView.children;
    const webView = ctx.sidePanelState.webContentView;
    const webViewIdx = children.indexOf(webView);
    const menuIdx = children.indexOf(ctx.chromeShellMenuOverlayView);

    assert.ok(webViewIdx !== -1, 'Side panel web view must be attached');
    assert.ok(menuIdx !== -1, 'Menu overlay must be attached');
    assert.ok(menuIdx > webViewIdx, 'Menu overlay must be on top of side panel web view');
  });

  test('hideActiveTabViewForShellOverlay collapses both left and right viewers and overlays', () => {
    const ctx = createMockContext();
    const tabView = ctx.tabs['tab-1'];

    // Setup Lens session with active sidebar and selection
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.hasSearchResults = true;
    lensSession.selectionActive = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');

    // Setup side panel webContentView
    ctx.sidePanelState.isOpen = true;
    ctx.sidePanelState.customUrl = 'https://example.com';
    ctx.sidePanelState.webContentView = createMockView('side-panel-web-view');

    // Attach all to contentView
    overlayManager.ensureChromeOverlayOnTop(ctx);

    // Call hideActiveTabViewForShellOverlay
    tabManager.hideActiveTabViewForShellOverlay(ctx);

    // 1. Left active tab hidden
    assert.equal(ctx.isActiveTabTemporarilyHidden, true);
    assert.ok(!ctx.window.contentView.children.includes(tabView), 'Active tab view must be removed from children');

    // 2. Right Lens sidebar hidden
    assert.equal(ctx.isLensSidebarTemporarilyHidden, true);
    assert.ok(!ctx.window.contentView.children.includes(lensSession.sidebarHostView), 'Lens sidebar must be removed from children');
    assert.deepEqual(lensSession.sidebarHostView.getBounds(), { x: 0, y: 0, width: 0, height: 0 });

    // 3. Right Side Panel web view hidden
    assert.equal(ctx.isSidePanelWebContentViewTemporarilyHidden, true);
    assert.ok(!ctx.window.contentView.children.includes(ctx.sidePanelState.webContentView), 'Side panel web view must be removed from children');
    assert.deepEqual(ctx.sidePanelState.webContentView.getBounds(), { x: 0, y: 0, width: 0, height: 0 });

    // 4. Lens selection overlay hidden
    assert.equal(ctx.isLensOverlayTemporarilyHidden, true);
    assert.deepEqual(ctx.chromeOverlayView.getBounds(), { x: 0, y: 0, width: 0, height: 0 });
  });

  test('restoreActiveTabViewFromShellOverlay cleanly restores both viewers and layering', () => {
    const ctx = createMockContext();

    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.hasSearchResults = true;
    lensSession.selectionActive = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');

    // Hide for modal
    tabManager.hideActiveTabViewForShellOverlay(ctx);
    assert.equal(ctx.isActiveTabTemporarilyHidden, true);
    assert.equal(ctx.isLensSidebarTemporarilyHidden, true);

    // Restore after modal
    tabManager.restoreActiveTabViewFromShellOverlay(ctx);

    assert.equal(ctx.isActiveTabTemporarilyHidden, false);
    assert.equal(ctx.isLensSidebarTemporarilyHidden, false);
    assert.equal(ctx.isLensOverlayTemporarilyHidden, false);

    // Lens sidebar bounds restored to non-zero geometry
    const bounds = lensSession.sidebarHostView.getBounds();
    assert.ok(bounds.width > 0, 'Sidebar width must be restored to > 0');
    assert.ok(bounds.height > 0, 'Sidebar height must be restored to > 0');

    // Menu overlays must be strictly on top of restored sidebar
    const children = ctx.window.contentView.children;
    const lensHostIdx = children.indexOf(lensSession.sidebarHostView);
    const menuIdx = children.indexOf(ctx.chromeShellMenuOverlayView);

    assert.ok(lensHostIdx !== -1);
    assert.ok(menuIdx !== -1);
    assert.ok(menuIdx > lensHostIdx, 'Menu overlay must be stacked above restored Lens sidebar');
  });

  test('Lens sidebar is not hidden during selection and layouts correctly on canvas capture', () => {
    const ctx = createMockContext();
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.selectionActive = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');

    // Make sure context.isLensSidebarTemporarilyHidden is false
    assert.equal(ctx.isLensSidebarTemporarilyHidden, undefined);

    // Layout should successfully size the sidebar once search results are available
    lensSession.hasSearchResults = true;
    lensManager.layoutLensSidebar(ctx, 'tab-1');

    const bounds = lensSession.sidebarHostView.getBounds();
    assert.ok(bounds.width > 0, 'Sidebar width must be > 0 when selection results are ready');
    assert.ok(bounds.height > 0, 'Sidebar height must be > 0 when selection results are ready');
  });

  test('CSS snapshot styling places tab and sidebar snapshots above card frames and below modals', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const cssPath = path.resolve(__dirname, '../../../src/index.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Verify .tab-content-snapshot has z-index: 5 (above .web-content-card-frame z-index: 1)
    const tabMatch = css.match(/\.tab-content-snapshot\s*\{[^}]*z-index:\s*(\d+)/);
    assert.ok(tabMatch, 'tab-content-snapshot must define z-index');
    assert.equal(tabMatch[1], '5', 'tab-content-snapshot z-index must be 5 to sit above card frame (z-index: 1)');

    // Verify .side-panel-content-snapshot has z-index: 5 (above .side-panel-container z-index: 2)
    const sideMatch = css.match(/\.side-panel-content-snapshot\s*\{[^}]*z-index:\s*(\d+)/);
    assert.ok(sideMatch, 'side-panel-content-snapshot must define z-index');
    assert.equal(sideMatch[1], '5', 'side-panel-content-snapshot z-index must be 5 to sit above side-panel-container (z-index: 2)');
  });
  test('Switching side panel from lens to bookmarks or history exits lens mode', () => {
    const ctx = createMockContext();
    ctx.sidePanelState.isOpen = true;
    ctx.sidePanelState.activePanelId = 'lens';

    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.selectionActive = true;
    lensSession.hasSearchResults = true;

    // Switch to bookmarks
    sidePanelManager.setSidePanelState(ctx, { activePanelId: 'bookmarks' });

    assert.equal(ctx.sidePanelState.activePanelId, 'bookmarks');
    assert.equal(lensSession.selectionActive, false, 'Lens selection must be inactive after switching to bookmarks');
  });

  test('Lens selection overlay does not exit on clicking outside canvas frame', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const compPath = path.resolve(__dirname, '../../../renderer/overlay/components/lensSelection.js');
    const code = fs.readFileSync(compPath, 'utf8');

    // Make sure siteFrame.addEventListener('click') was removed
    assert.ok(!code.includes("siteFrame.addEventListener('click'"), 'Outside click handler on siteFrame must be removed');
  });

  test('Lens sidebar WebContentsView uses desktop Chrome user agent and ep=subb upload', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const mgrPath = path.resolve(__dirname, '../../../main/windows/lensManager.js');
    const code = fs.readFileSync(mgrPath, 'utf8');

    assert.ok(!code.includes('sidebar.webContents.setUserAgent(LENS_MOBILE_USER_AGENT)'), 'Sidebar must not be forced to mobile user agent');
    assert.ok(code.includes('ep=subb'), 'Upload URL must use ep=subb parameter');
  });

  test('returning to Lens tab after opening link in new tab allows canvas re-selection and keeps sidebar visible', async () => {
    const ctx = createMockContext();
    const tab1 = ctx.tabs['tab-1'];
    const tab2 = createMockView('tab-2-view');
    ctx.tabs['tab-2'] = tab2;

    // 1. Initial state: Lens active on Tab 1 with search results
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.selectionActive = true;
    lensSession.hasSearchResults = true;
    lensSession.sidebarView = createMockView('lens-sidebar-view');
    lensSession.sidebarHostView = createMockView('lens-sidebar-host-view');
    ctx.sidePanelState.isOpen = true;
    ctx.sidePanelState.activePanelId = 'lens';

    lensManager.layoutLensSidebar(ctx, 'tab-1');
    const initialBounds = lensSession.sidebarHostView.getBounds();
    assert.ok(initialBounds.width > 0, 'Initial sidebar width must be > 0');

    // 2. Click link in Lens sidebar -> opens in new Tab 2, suspends Lens on Tab 1, closes side panel
    tabManager.activateTabInContext(ctx, 'tab-2');
    assert.equal(ctx.activeTabId, 'tab-2');
    assert.equal(ctx.sidePanelState.isOpen, false);
    assert.equal(ctx.isLensSidebarTemporarilyHidden, false);

    // 3. Return back to Tab 1
    tabManager.activateTabInContext(ctx, 'tab-1');
    assert.equal(ctx.activeTabId, 'tab-1');
    assert.equal(ctx.sidePanelState.isOpen, true);
    assert.equal(ctx.sidePanelState.activePanelId, 'lens');
    assert.equal(ctx.isLensSidebarTemporarilyHidden, false, 'isLensSidebarTemporarilyHidden must not be stuck on true');

    const restoredBounds = lensSession.sidebarHostView.getBounds();
    assert.ok(restoredBounds.width > 0, 'Sidebar width must be non-zero after returning to tab 1');

    // 4. Select another area on canvas
    await lensManager.captureGoogleLensSelection(ctx, {
      box: { x: 50, y: 50, width: 200, height: 200 },
      devicePixelRatio: 1,
    });

    assert.equal(ctx.isLensSidebarTemporarilyHidden, false);
    const reselectedBounds = lensSession.sidebarHostView.getBounds();
    assert.ok(reselectedBounds.width > 0, 'Sidebar width must remain > 0 on subsequent selection');
    assert.ok(reselectedBounds.height > 0, 'Sidebar height must remain > 0 on subsequent selection');
    assert.ok(ctx.window.contentView.children.includes(lensSession.sidebarHostView), 'Sidebar host must be in contentView children');
  });

  test('CSS snapshot styling preserves canvas aspect ratio under modals', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const cssPath = path.resolve(__dirname, '../../../src/index.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('.tab-content-snapshot.tab-content-snapshot--lens'), 'Must include .tab-content-snapshot.tab-content-snapshot--lens');
    assert.ok(css.includes('object-fit: contain'), 'Must define object-fit: contain for lens snapshot');
    assert.ok(css.includes('background: #18191c'), 'Must define neutral dark canvas background #18191c for lens snapshot');
  });

  test('Lens selection overlay metrics provide cropped bounds for shell overlay snapshot', () => {
    const ctx = createMockContext();
    const lensSession = lensManager.getLensSession(ctx, 'tab-1', true);
    lensSession.selectionActive = true;
    lensSession.sidebarView = createMockView('sidebar-view');
    lensSession.sidebarWidth = 380;
    ctx.sidePanelState.isOpen = true;
    ctx.sidePanelState.activePanelId = 'lens';

    const metrics = lensManager.getLensLayoutMetrics(ctx, 'tab-1');
    const overlayBounds = lensManager.computeLensChromeOverlayBounds(ctx, 'tab-1');

    assert.ok(metrics && metrics.leftPanelBounds, 'leftPanelBounds must exist');
    assert.ok(overlayBounds, 'overlayBounds must exist');
    assert.equal(metrics.leftPanelBounds.x, 8);
    assert.ok(metrics.leftPanelBounds.width > 0);
    assert.ok(metrics.leftPanelBounds.height > 0);
    assert.ok(metrics.leftPanelBounds.width <= overlayBounds.width);
  });
});


