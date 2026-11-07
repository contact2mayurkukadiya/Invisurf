'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const State = require('../../../main/state');
const { getTabRegistry } = require('../../../main/extensions/compat/TabRegistry');
const { getMediaCaptureManager } = require('../../../main/extensions/compat/MediaCaptureManager');

describe('MediaCapture & TabRegistry Sleeping Tabs & Tab Sharing Unit Tests', () => {
  after(() => {
    env.cleanup();
  });

  beforeEach(() => {
    State.windowContextsById.clear();
    State.tabIdToWindowId.clear();
    State.detachedTabWindows.clear();
    State.webContentsIdToTabId.clear();
  });

  test('TabRegistry.query returns awake and sleeping tabs in exact tabOrder with titles and favicons', async () => {
    const registry = getTabRegistry();

    const mockWin = {
      id: 101,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    const activeView = {
      _favicon: 'https://meet.google.com/favicon.ico',
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: {
        id: 55,
        isDestroyed: () => false,
        getURL: () => 'https://meet.google.com/wfc-bojs-jsw',
        getTitle: () => 'Meet - wfc-bojs-jsw',
        isLoading: () => false,
        isCurrentlyAudible: () => true,
        isAudioMuted: () => false,
      },
    };

    State.webContentsIdToTabId.set(55, 'tab-meet');
    State.tabIdToWindowId.set('tab-meet', 101);
    State.tabIdToWindowId.set('tab-permit', 101);
    State.tabIdToWindowId.set('tab-canva', 101);

    const context = {
      window: mockWin,
      windowId: 101,
      activeTabId: 'tab-meet',
      tabOrder: ['tab-permit', 'tab-canva', 'tab-meet'],
      tabs: {
        'tab-meet': activeView,
      },
      sleepingTabs: {
        'tab-permit': {
          url: 'https://permit.io/overview/sync-your-first-user-with-sdk/',
          title: 'Sync your First User with the API',
          favicon: 'https://permit.io/favicon.ico',
        },
        'tab-canva': {
          url: 'https://www.canva.com/',
          title: 'Free Online Graphic Design Maker',
          favicon: 'https://www.canva.com/favicon.ico',
        },
      },
    };
    State.windowContextsById.set(101, context);

    const allTabs = await registry.query({});
    assert.strictEqual(allTabs.length, 3, 'Should return all 3 open tabs (2 sleeping + 1 awake)');

    assert.strictEqual(allTabs[0].stringTabId, 'tab-permit');
    assert.strictEqual(allTabs[0].title, 'Sync your First User with the API');
    assert.strictEqual(allTabs[0].favIconUrl, 'https://permit.io/favicon.ico');
    assert.strictEqual(allTabs[0].discarded, true);

    assert.strictEqual(allTabs[1].stringTabId, 'tab-canva');
    assert.strictEqual(allTabs[1].title, 'Free Online Graphic Design Maker');
    assert.strictEqual(allTabs[1].favIconUrl, 'https://www.canva.com/favicon.ico');
    assert.strictEqual(allTabs[1].discarded, true);

    assert.strictEqual(allTabs[2].stringTabId, 'tab-meet');
    assert.strictEqual(allTabs[2].title, 'Meet - wfc-bojs-jsw');
    assert.strictEqual(allTabs[2].favIconUrl, 'https://meet.google.com/favicon.ico');
    assert.strictEqual(allTabs[2].active, true);
    assert.strictEqual(allTabs[2].discarded, undefined);
  });

  test('MediaCaptureManager._gatherTabSources maps tabs to picker sources with favicons', async () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 102,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    const activeView = {
      _favicon: 'https://meet.google.com/favicon.ico',
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: {
        id: 77,
        isDestroyed: () => false,
        getURL: () => 'https://meet.google.com/abc',
        getTitle: () => 'Meet - abc',
        isLoading: () => false,
        capturePage: async () => ({ isEmpty: () => true }),
      },
    };

    State.webContentsIdToTabId.set(77, 'tab-1');
    State.tabIdToWindowId.set('tab-1', 102);
    State.tabIdToWindowId.set('tab-2', 102);

    const context = {
      window: mockWin,
      windowId: 102,
      activeTabId: 'tab-1',
      tabOrder: ['tab-1', 'tab-2'],
      tabs: {
        'tab-1': activeView,
      },
      sleepingTabs: {
        'tab-2': {
          url: 'https://canva.com',
          title: 'Canva Design',
          favicon: 'https://canva.com/favicon.ico',
        },
      },
    };
    State.windowContextsById.set(102, context);

    const sources = await mgr._gatherTabSources();
    assert.strictEqual(sources.length, 2);
    assert.strictEqual(sources[0].name, 'Meet - abc');
    assert.strictEqual(sources[0].favicon, 'https://meet.google.com/favicon.ico');
    assert.strictEqual(sources[1].name, 'Canva Design');
    assert.strictEqual(sources[1].favicon, 'https://canva.com/favicon.ico');
  });

  test('MediaCaptureManager.handlePickerResponse passes WebFrameMain directly for tab sharing without capturing window', async () => {
    const mgr = getMediaCaptureManager();

    const mockFrame = { id: 'frame-99', name: 'mainFrame' };
    const mockView = {
      setBounds: () => {},
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: {
        id: 88,
        isDestroyed: () => false,
        mainFrame: mockFrame,
        focus: () => {},
        getURL: () => 'https://example.com',
        getZoomFactor: () => 1.0,
      },
    };

    State.webContentsIdToTabId.set(88, 'tab-shared');
    State.tabIdToWindowId.set('tab-shared', 103);
    const mockWin = {
      id: 103,
      isDestroyed: () => false,
      getTitle: () => 'InviSurf - Main Window',
      getContentBounds: () => ({ width: 1200, height: 800 }),
      isFullScreen: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => {},
      },
    };

    State.windowContextsById.set(103, {
      window: mockWin,
      tabs: {
        'tab-shared': mockView,
      },
      sleepingTabs: {},
      tabOrder: ['tab-shared'],
    });

    let callbackResult = null;
    const reqId = 9999;
    mgr.pendingPickerRequests.set(reqId, {
      requestId: reqId,
      callback: (res) => {
        callbackResult = res;
      },
      rawDesktopSources: [{ id: 'window:103:0', name: 'InviSurf - Main Window' }],
      isDisplayMedia: true,
    });

    mgr.handlePickerResponse({
      requestId: reqId,
      cancelled: false,
      sourceId: 'tab:88',
      sourceKind: 'tab',
      tabId: 88,
      shareAudio: true,
    });

    assert.ok(callbackResult, 'Callback should have been called');
    assert.strictEqual(callbackResult.video, mockFrame, 'Should pass WebFrameMain for video capture, NOT the whole window source');
    assert.strictEqual(callbackResult.audio, mockFrame, 'Should pass WebFrameMain for audio capture');
  });
});
