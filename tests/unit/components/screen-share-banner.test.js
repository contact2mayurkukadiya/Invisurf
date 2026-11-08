'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('ScreenShareBanner Component & State Unit Tests', () => {
  test('browserSlice handles setScreenShareStatus correctly', () => {
    // Dynamically test reducer behavior
    const reducer = require('../../../src/store/browserSlice').default;
    const { setScreenShareStatus } = require('../../../src/store/browserSlice');

    const initialState = reducer(undefined, { type: '@@INIT' });
    assert.deepStrictEqual(initialState.screenShare, {
      active: false,
      sourceKind: 'tab',
      sharedTabId: null,
      sharedHost: '',
      sharedTitle: '',
      requestingTabId: null,
      requestingHost: '',
      surfaceSwitching: 'include',
      state: 'idle',
    });

    const activePayload = {
      active: true,
      sourceKind: 'tab',
      sharedTabId: 'tab-chatgpt',
      sharedHost: 'chatgpt.com',
      sharedTitle: 'ChatGPT - Drone Cost Analysis',
      requestingTabId: 'tab-meet',
      requestingHost: 'meet.google.com',
    };

    const nextState = reducer(initialState, setScreenShareStatus(activePayload));
    assert.strictEqual(nextState.screenShare.active, true);
    assert.strictEqual(nextState.screenShare.sourceKind, 'tab');
    assert.strictEqual(nextState.screenShare.sharedTabId, 'tab-chatgpt');
    assert.strictEqual(nextState.screenShare.sharedHost, 'chatgpt.com');
    assert.strictEqual(nextState.screenShare.requestingTabId, 'tab-meet');
    assert.strictEqual(nextState.screenShare.requestingHost, 'meet.google.com');

    const stoppedState = reducer(nextState, setScreenShareStatus({ active: false }));
    assert.strictEqual(stoppedState.screenShare.active, false);
    assert.strictEqual(stoppedState.screenShare.sharedTabId, null);
  });

  test('ScreenShareBanner JSX file contains required contextual conditions and styling hooks', () => {
    const bannerPath = path.resolve(__dirname, '../../../src/components/ScreenShareBanner.jsx');
    assert.ok(fs.existsSync(bannerPath), 'ScreenShareBanner.jsx must exist');
    const content = fs.readFileSync(bannerPath, 'utf8');

    assert.ok(content.includes('screen-share-banner-wrapper'), 'Must render wrapper class');
    assert.ok(content.includes('screen-share-chip') || content.includes('screen-share-banner-pill'), 'Must render chip/pill elements');
    assert.ok(content.includes('isMeetingTab'), 'Must detect if currentTab is meeting tab');
    assert.ok(content.includes('isSharedTab'), 'Must detect if currentTab is the shared tab');
    assert.ok(content.includes('Sharing this tab to'), 'Must render "Sharing this tab to" when on shared tab');
    assert.ok(content.includes('to this tab'), 'Must render "to this tab" when on meeting tab');
    assert.ok(content.includes('Share this tab instead'), 'Must render "Share this tab instead" button');
    assert.ok(content.includes('Stop sharing'), 'Must render "Stop sharing" button');
    assert.ok(content.includes('window.electronAPI?.stopScreenShare'), 'Must call stopScreenShare IPC');
    assert.ok(content.includes('window.electronAPI?.switchScreenShareTab'), 'Must call switchScreenShareTab IPC');
  });

  test('ScreenShareBanner CSS contains themed background and pill styling', () => {
    const cssPath = path.resolve(__dirname, '../../../src/components/ScreenShareBanner.css');
    assert.ok(fs.existsSync(cssPath), 'ScreenShareBanner.css must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('--chrome-accent'), 'Must use --chrome-accent token');
    assert.ok(css.includes('--chrome-nav-bg'), 'Must use --chrome-nav-bg token');
    assert.ok(css.includes('--chrome-fg'), 'Must use --chrome-fg token');
    assert.ok(css.includes('screen-share-stop-btn'), 'Must define screen-share-stop-btn');
    assert.ok(css.includes('screen-share-switch-btn'), 'Must define screen-share-switch-btn');
  });

  test('preload.js exposes required screen share methods', () => {
    const preloadPath = path.resolve(__dirname, '../../../preload.js');
    const content = fs.readFileSync(preloadPath, 'utf8');

    assert.ok(content.includes('stopScreenShare:'), 'Must expose stopScreenShare');
    assert.ok(content.includes('switchScreenShareTab:'), 'Must expose switchScreenShareTab');
    assert.ok(content.includes('onScreenShareStatusChanged:'), 'Must expose onScreenShareStatusChanged');
    assert.ok(content.includes('__invisurfActiveDisplayStream'), 'Must track active display stream for ended events');
  });

  test('desktopMediaPicker.js provides two-column tab picker with live preview and audio toggle', () => {
    const pickerPath = path.resolve(__dirname, '../../../renderer/overlay/components/desktopMediaPicker.js');
    const content = fs.readFileSync(pickerPath, 'utf8');

    assert.ok(content.includes('renderTabsSplitView'), 'Must support 2-column split view for tabs');
    assert.ok(content.includes('Share with tab audio'), 'Must support tab audio label');
    assert.ok(content.includes('Share with system audio'), 'Must support system audio label');
    assert.ok(content.includes('Share with Audio'), 'Must dynamically update Share button text');
    assert.ok(content.includes('categoriesMeta'), 'Must support categories navigation');
  });

  test('tab bounds shift down by 38px during screen sharing without leaving gap at window bottom', () => {
    const { getActiveTabContentBounds } = require('../../../main/windows/lensManager');
    const { UI_HEIGHT } = require('../../../main/constants/defaults');

    const mockWin = {
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    // 1. Normal state: y = UI_HEIGHT, height = 800 - UI_HEIGHT, bottom touches window bottom
    const normalCtx = {
      window: mockWin,
      activeTabId: 'tab-1',
      isScreenSharingActive: false,
    };
    const normalBounds = getActiveTabContentBounds(normalCtx, 'tab-1');
    assert.strictEqual(normalBounds.y, UI_HEIGHT, 'Normal y must be UI_HEIGHT');
    assert.strictEqual(normalBounds.height, 800 - UI_HEIGHT, 'Normal height must be window height - UI_HEIGHT');
    assert.strictEqual(normalBounds.y + normalBounds.height, 800, 'Normal bounds must reach bottom of window');

    // 2. Screen sharing active: y = UI_HEIGHT + 38, height = 800 - (UI_HEIGHT + 38), bottom touches window bottom
    const sharingCtx = {
      window: mockWin,
      activeTabId: 'tab-1',
      isScreenSharingActive: true,
    };
    const sharingBounds = getActiveTabContentBounds(sharingCtx, 'tab-1');
    assert.strictEqual(sharingBounds.y, UI_HEIGHT + 38, 'Sharing y must shift down by 38px for banner');
    assert.strictEqual(sharingBounds.height, 800 - (UI_HEIGHT + 38), 'Sharing height must be window height - (UI_HEIGHT + 38)');
    assert.strictEqual(sharingBounds.y + sharingBounds.height, 800, 'Sharing bounds must reach exact bottom of window without white gap');
  });

  test('Tab.jsx and TabBar.jsx wire captureRole indicators and styles', () => {
    const tabJsx = fs.readFileSync(path.resolve(__dirname, '../../../src/components/Tab.jsx'), 'utf8');
    assert.ok(tabJsx.includes('captureRole'), 'Tab.jsx must accept captureRole prop');
    assert.ok(tabJsx.includes('tab-capture-indicator'), 'Tab.jsx must render tab-capture-indicator');
    assert.ok(tabJsx.includes('tab-capture-dot'), 'Tab.jsx must render pulsing capture dot');
    assert.ok(tabJsx.includes('tab-capture-cast-icon'), 'Tab.jsx must render cast icon for capturer');

    const tabBarJsx = fs.readFileSync(path.resolve(__dirname, '../../../src/components/TabBar.jsx'), 'utf8');
    assert.ok(tabBarJsx.includes('getCaptureRole'), 'TabBar.jsx must compute getCaptureRole');
    assert.ok(tabBarJsx.includes('captureRole={getCaptureRole(id)}'), 'TabBar.jsx must pass captureRole to Tab');

    const indexCss = fs.readFileSync(path.resolve(__dirname, '../../../src/index.css'), 'utf8');
    assert.ok(indexCss.includes('.tab-capture-indicator'), 'index.css must define tab-capture-indicator');
    assert.ok(indexCss.includes('.tab-capture-dot'), 'index.css must define tab-capture-dot');
    assert.ok(indexCss.includes('@keyframes tabCapturePulse'), 'index.css must define tabCapturePulse animation');
  });

  test('ScreenShareBanner enforces surfaceSwitching, switching guard, and restricted tabs', () => {
    const bannerPath = path.resolve(__dirname, '../../../src/components/ScreenShareBanner.jsx');
    const content = fs.readFileSync(bannerPath, 'utf8');

    assert.ok(content.includes('surfaceSwitching !== \'exclude\''), 'Must hide switch button when surfaceSwitching === exclude');
    assert.ok(content.includes('isSwitching'), 'Must guard against clicks during switching state');
    assert.ok(content.includes('isRestrictedTab'), 'Must disallow switching to restricted internal tabs');
    assert.ok(content.includes('disabled={isSwitching}'), 'Must disable switch button when switching');
  });
});

