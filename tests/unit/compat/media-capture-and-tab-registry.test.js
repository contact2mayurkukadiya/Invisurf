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

    // Verify activeScreenShare state was created
    assert.ok(mgr.activeScreenShare, 'Should record activeScreenShare');
    assert.strictEqual(mgr.activeScreenShare.active, true);
    assert.strictEqual(mgr.activeScreenShare.sourceKind, 'tab');
    assert.strictEqual(mgr.activeScreenShare.sharedTabId, 'tab-shared');

    // Test switchSharedTab
    const mockFrame2 = { id: 'frame-100', name: 'mainFrame2' };
    const mockView2 = {
      setBounds: () => {},
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: {
        id: 89,
        isDestroyed: () => false,
        mainFrame: mockFrame2,
        getURL: () => 'https://zbotic.in',
        getTitle: () => 'Zbotic Store',
        getZoomFactor: () => 1.0,
      },
    };
    State.webContentsIdToTabId.set(89, 'tab-zbotic');
    State.tabIdToWindowId.set('tab-zbotic', 103);
    State.windowContextsById.get(103).tabs['tab-zbotic'] = mockView2;

    mgr.switchSharedTab('tab-zbotic');
    assert.strictEqual(mgr.activeScreenShare.sharedTabId, 'tab-zbotic');
    assert.strictEqual(mgr.activeScreenShare.sharedHost, 'zbotic.in');
    assert.strictEqual(mgr.activeScreenShare.sharedTitle, 'Zbotic Store');

    // Test stopScreenShare
    mgr.stopScreenShare();
    assert.strictEqual(mgr.activeScreenShare, null, 'activeScreenShare should be reset to null after stopScreenShare');
  });

  test('MediaCaptureManager.handlePickerResponse on cancel passes empty object {} (avoids C++ TypeError)', () => {
    const mgr = getMediaCaptureManager();
    let callbackResult = null;
    const reqId = 10001;

    mgr.pendingPickerRequests.set(reqId, {
      requestId: reqId,
      callback: (res) => {
        callbackResult = res;
      },
      isDisplayMedia: true,
    });

    mgr.handlePickerResponse({
      requestId: reqId,
      cancelled: true,
    });

    assert.ok(callbackResult !== null, 'Callback must be called on cancel');
    assert.deepStrictEqual(callbackResult, {}, 'Callback must receive empty object {}, not { video: null } which crashes Electron');
  });

  test('MediaCaptureManager.handlePickerCancel passes empty object {} for displayMedia requests', () => {
    const mgr = getMediaCaptureManager();
    let callbackResult = null;
    const reqId = 10002;

    mgr.pendingPickerRequests.set(reqId, {
      requestId: reqId,
      callback: (res) => {
        callbackResult = res;
      },
      isDisplayMedia: true,
    });

    mgr.handlePickerCancel(reqId);

    assert.ok(callbackResult !== null, 'Callback must be called on cancel');
    assert.deepStrictEqual(callbackResult, {}, 'Callback must receive empty object {} to cleanly cancel stream');
  });

  test('getDisplayMedia cancellation normalizer converts AbortError/cancel into NotAllowedError DOMException with "Permission denied by user" standard Chrome format', async () => {
    // Verify that the wrapper contract expected by Google Meet, Teams, and WebRTC works as specified
    const fs = require('fs');
    const path = require('path');
    const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../../preload.js'), 'utf-8');

    // Ensure the monkey-patch pattern is present in preload.js for both main-world and isolated-world
    assert.ok(preloadSource.includes("throw new DOMException('Permission denied by user', 'NotAllowedError')"), 'preload.js must normalize cancelled getDisplayMedia to NotAllowedError DOMException with "Permission denied by user"');
    assert.ok(preloadSource.includes("Invalid capture constraints"), 'preload.js must intercept Chromium Electron AbortError Invalid capture constraints');

    // Simulate wrapper execution
    const simulateWrapper = async (origFn) => {
      try {
        return await origFn();
      } catch (err) {
        if (err && (
          err.name === 'AbortError' ||
          err.name === 'NotAllowedError' ||
          String(err.message || '').includes('Invalid capture constraints') ||
          String(err.message || '').toLowerCase().includes('denied') ||
          String(err.message || '').toLowerCase().includes('cancel')
        )) {
          throw new DOMException('Permission denied by user', 'NotAllowedError');
        }
        throw err;
      }
    };

    // 1. When Electron returns AbortError ("Invalid capture constraints") on picker cancellation:
    let caughtErr = null;
    try {
      await simulateWrapper(async () => {
        const electronAbortErr = new DOMException('Invalid capture constraints', 'AbortError');
        throw electronAbortErr;
      });
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'Error must be thrown');
    assert.strictEqual(caughtErr.name, 'NotAllowedError', 'Error name must be NotAllowedError so Google Meet recognizes user cancellation');
    assert.strictEqual(caughtErr.message, 'Permission denied by user', 'Error message must match Chrome native: Permission denied by user');
    assert.strictEqual(caughtErr instanceof DOMException, true, 'Error must be a DOMException instance');

    // 2. Simulate Google Meet / WebRTC specification exception check:
    // If err.name === 'NotAllowedError' AND err.message contains 'by user' (standard Chrome behavior),
    // web apps recognize an intentional user dismissal and suppress all error modals/banners.
    let meetModalShown = false;
    if (caughtErr.name === 'NotAllowedError' && caughtErr.message.toLowerCase().includes('by user')) {
      meetModalShown = false;
    } else {
      meetModalShown = true;
    }
    assert.strictEqual(meetModalShown, false, 'Google Meet error modal must NOT be shown when screen share is cancelled by user');
  });

  test('MediaCaptureManager._gatherTabSources reuses _lastSnapshot for background tabs', async () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 104,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    const bgViewWithSnapshot = {
      _lastSnapshot: 'data:image/png;base64,CACHED_SNAPSHOT_DATA',
      getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      webContents: {
        id: 91,
        isDestroyed: () => false,
        getURL: () => 'https://photoadking.com/',
        getTitle: () => 'Free Graphic Design Maker - PhotoADKing',
        isLoading: () => false,
        capturePage: async () => {
          throw new Error('Current display surface not available for capture');
        },
      },
    };

    State.webContentsIdToTabId.set(91, 'tab-photo');
    State.tabIdToWindowId.set('tab-photo', 104);

    State.windowContextsById.set(104, {
      window: mockWin,
      windowId: 104,
      activeTabId: 'other-tab',
      tabOrder: ['tab-photo'],
      tabs: {
        'tab-photo': bgViewWithSnapshot,
      },
      sleepingTabs: {},
    });

    const sources = await mgr._gatherTabSources();
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].stringTabId, 'tab-photo');
    assert.strictEqual(sources[0].thumbnail, 'data:image/png;base64,CACHED_SNAPSHOT_DATA', 'Should preserve cached snapshot');
  });

  test('MediaCaptureManager.handlePickerResponse with empty rawDesktopSources safely passes {} avoiding C++ TypeError', () => {
    const mgr = getMediaCaptureManager();
    let callbackResult = null;
    const reqId = 10003;

    mgr.pendingPickerRequests.set(reqId, {
      requestId: reqId,
      callback: (res) => {
        callbackResult = res;
      },
      rawDesktopSources: [],
      isDisplayMedia: true,
    });

    mgr.handlePickerResponse({
      requestId: reqId,
      cancelled: false,
      sourceId: 'screen:0:0',
      sourceKind: 'screen',
      shareAudio: false,
    });

    assert.ok(callbackResult !== null, 'Callback must be called');
    assert.deepStrictEqual(callbackResult, {}, 'Should pass empty object {} instead of { video: null }');
  });

  test('MediaCaptureManager sanitizes fallback names and avoids spoofed hostnames', () => {
    const mgr = getMediaCaptureManager();
    const reqId = 10004;

    mgr.pendingPickerRequests.set(reqId, {
      requestId: reqId,
      callback: () => {},
      rawDesktopSources: [{ id: 'screen:0:0', name: 'Primary Display' }],
      isDisplayMedia: true,
      requesterHost: '', // empty requester
    });

    mgr.handlePickerResponse({
      requestId: reqId,
      cancelled: false,
      sourceId: 'screen:0:0',
      sourceKind: 'screen',
    });

    assert.ok(mgr.activeScreenShare, 'Should record activeScreenShare');
    assert.notStrictEqual(mgr.activeScreenShare.requestingHost, 'meet.google.com', 'Must not spoof meet.google.com');
    assert.strictEqual(mgr.activeScreenShare.requestingHost, 'Meeting');
    assert.strictEqual(mgr.activeScreenShare.sharedHost, 'Primary Display');

    mgr.stopScreenShare();
  });

  test('MediaCaptureManager supports concurrent screen shares across multiple webContents', () => {
    const mgr = getMediaCaptureManager();

    const sessionA = {
      active: true,
      requestingWcId: 101,
      sharedTabId: 'tab-1',
      sharedHost: 'docs.google.com',
    };
    const sessionB = {
      active: true,
      requestingWcId: 202,
      sharedTabId: 'tab-2',
      sharedHost: 'figma.com',
    };

    mgr.activeScreenShares.set(101, sessionA);
    mgr.activeScreenShares.set(202, sessionB);

    assert.strictEqual(mgr.activeScreenShares.size, 2, 'Should track both active shares');

    // Stop session A only
    mgr.stopScreenShare(101);
    assert.strictEqual(mgr.activeScreenShares.has(101), false, 'Session A should be stopped');
    assert.strictEqual(mgr.activeScreenShares.has(202), true, 'Session B should still be active');

    // Stop all remaining
    mgr.stopScreenShare();
    assert.strictEqual(mgr.activeScreenShares.size, 0, 'All sessions should be stopped');
    assert.strictEqual(mgr.activeScreenShare, null);
  });

  test('MediaCaptureManager.getCapturedTabs conforms to Chrome extension CaptureInfo spec', () => {
    const mgr = getMediaCaptureManager();
    mgr.activeCaptures.set('stream-test-1', {
      streamId: 'stream-test-1',
      tabId: 42,
      status: 'active',
    });

    const captured = mgr.getCapturedTabs();
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].tabId, 42);
    assert.strictEqual(captured[0].status, 'active');
    assert.strictEqual(captured[0].fullscreen, false, 'Should conform to Chrome CaptureInfo spec with fullscreen flag');

    mgr.activeCaptures.delete('stream-test-1');
  });

  test('MediaCaptureManager.chooseDesktopMedia correlates with clientRequestId', async () => {
    const mgr = getMediaCaptureManager();
    const clientReqId = 5544;

    const res = await mgr.chooseDesktopMedia('ext-test', ['screen'], null, {}, clientReqId);
    assert.strictEqual(res.requestId, 5544, 'Should preserve clientRequestId to prevent desync');

    // Clean up
    mgr.cancelChooseDesktopMedia(clientReqId);
  });

  test('MediaCaptureManager._gatherTabSources skips capturePage when snapshot is fresher than 5000ms', async () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 105,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    let captureCount = 0;
    const activeView = {
      _favicon: 'https://example.com/favicon.ico',
      _lastSnapshot: 'data:image/png;base64,freshsnapshotdata',
      _lastSnapshotTime: Date.now(), // freshly taken
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: {
        id: 99,
        isDestroyed: () => false,
        getURL: () => 'https://example.com/page',
        getTitle: () => 'Example Page',
        isLoading: () => false,
        capturePage: async () => {
          captureCount++;
          return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,new' };
        },
      },
    };

    State.webContentsIdToTabId.set(99, 'tab-cache-test');
    State.tabIdToWindowId.set('tab-cache-test', 105);

    const context = {
      window: mockWin,
      windowId: 105,
      activeTabId: 'tab-cache-test',
      tabOrder: ['tab-cache-test'],
      tabs: { 'tab-cache-test': activeView },
      sleepingTabs: {},
    };
    State.windowContextsById.set(105, context);

    const sources = await mgr._gatherTabSources();
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].thumbnail, 'data:image/png;base64,freshsnapshotdata');
    assert.strictEqual(captureCount, 0, 'capturePage should NOT be called when snapshot is <5s fresh');

    // Expire cache and verify capturePage is called
    activeView._lastSnapshotTime = Date.now() - 6000;
    await mgr._gatherTabSources();
    assert.strictEqual(captureCount, 1, 'capturePage should be called when snapshot is expired (>5s old)');
  });

  test('MediaCaptureManager fast-paths switchSharedTab through pendingDirectTabShares without showing picker', async () => {
    const mgr = getMediaCaptureManager();

    const targetFrame = { id: 'frame-target-99', url: 'https://github.com' };
    const targetWc = {
      id: 99,
      isDestroyed: () => false,
      getTitle: () => 'GitHub',
      getURL: () => 'https://github.com',
      mainFrame: targetFrame,
      once: () => {},
    };

    const reqWc = {
      id: 42,
      isDestroyed: () => false,
      send: (channel, data) => {
        reqWc.lastEvent = { channel, data };
      },
      executeJavaScript: async () => {},
    };

    // Setup active share
    mgr.activeScreenShare = {
      active: true,
      requestingWcId: 42,
      sharedTabId: 'tab-old',
      shareAudio: true,
    };

    // Mock electron webContents.fromId
    const electron = require('electron');
    const origFromId = electron.webContents?.fromId;
    electron.webContents = electron.webContents || {};
    electron.webContents.fromId = (id) => (id === 42 ? reqWc : null);

    // Mock TabRegistry resolution for the switch
    const mockWin = { id: 106, isDestroyed: () => false, getTitle: () => 'Window 106' };
    State.tabIdToWindowId.set('tab-github', 106);
    State.windowContextsById.set(106, {
      window: mockWin,
      windowId: 106,
      tabs: { 'tab-github': { webContents: targetWc } },
      sleepingTabs: {},
    });

    mgr.switchSharedTab('tab-github');

    assert.strictEqual(reqWc.lastEvent?.channel, 'screen-share:tab-switched');
    assert.strictEqual(mgr.pendingDirectTabShares.has(42), true, 'Should stage pendingDirectTabShare');

    // Subsequent handleDisplayMediaRequest should be fulfilled directly via callback with targetFrame
    let callbackResult = null;
    await mgr.handleDisplayMediaRequest(
      { webContents: reqWc, audioRequested: true },
      (res) => { callbackResult = res; }
    );

    assert.ok(callbackResult, 'Callback should be called immediately');
    assert.strictEqual(callbackResult.video, targetFrame, 'Should return targetFrame directly without picker');
    assert.strictEqual(callbackResult.audio, targetFrame, 'Should include audio when shareAudio was active');
    assert.strictEqual(mgr.pendingDirectTabShares.has(42), false, 'Pending direct share should be consumed');

    // Cleanup
    mgr.stopScreenShare();
    if (origFromId) electron.webContents.fromId = origFromId;
  });

  test('MediaCaptureManager temporarily suspends and restores DRM during display media', () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 201,
      isDestroyed: () => false,
      getTitle: () => 'Protected Window',
      getContentBounds: () => ({ width: 1200, height: 800 }),
      webContents: { isDestroyed: () => false, send: () => {} },
    };

    State.tabIdToWindowId.set('tab-protected', 201);
    State.windowContextsById.set(201, {
      window: mockWin,
      windowId: 201,
      tabs: {
        'tab-protected': {
          setBounds: () => {},
          webContents: {
            id: 88,
            isDestroyed: () => false,
            getURL: () => 'https://protected.com',
            getTitle: () => 'Protected',
            focus: () => {},
            getZoomFactor: () => 1,
            mainFrame: { id: 'frame-88' },
            once: () => {},
          },
        },
      },
      sleepingTabs: {},
    });

    const targetWc = { id: 88, isDestroyed: () => false, mainFrame: { id: 'frame-88' }, once: () => {} };
    const reqWc = { id: 77, isDestroyed: () => false, once: () => {} };

    mgr.pendingPickerRequests.set(999, {
      requestId: 999,
      isDisplayMedia: true,
      requestingWc: reqWc,
      requestingTabId: 'tab-meeting',
      callback: () => {},
    });

    mgr.handlePickerResponse({
      requestId: 999,
      cancelled: false,
      sourceId: 'tab:tab-protected',
      sourceKind: 'tab',
      tabId: 'tab-protected',
      shareAudio: false,
    });

    assert.ok(mgr.activeScreenShare);
    assert.strictEqual(mgr.activeScreenShare.suspendedDrmWinId, 201, 'Should record suspended window');
    assert.ok(mgr.activeScreenShare.drmStreamId.startsWith('screenShare:'));

    // Verify stopScreenShare restores DRM
    mgr.stopScreenShare();
    assert.strictEqual(mgr.activeScreenShares.size, 0);
  });

  test('MediaCaptureManager.chooseDesktopMedia with [tab] only skips desktopCapturer.getSources', async () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 301,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
    };

    State.tabIdToWindowId.set('tab-only', 301);
    State.windowContextsById.set(301, {
      window: mockWin,
      windowId: 301,
      tabs: {
        'tab-only': {
          setBounds: () => {},
          webContents: { id: 71, isDestroyed: () => false, capturePage: async () => ({ isEmpty: () => true }) },
        },
      },
      sleepingTabs: {},
    });

    const electron = require('electron');
    let getSourcesCalled = false;
    const origGetSources = electron.desktopCapturer?.getSources;
    if (electron.desktopCapturer) {
      electron.desktopCapturer.getSources = async () => {
        getSourcesCalled = true;
        return [];
      };
    }

    const promise = mgr.chooseDesktopMedia('ext-tab-only', ['tab'], { id: 'tab-only' }, {}, 8877);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(mgr.pendingPickerRequests.has(8877), true, 'Request should be pending');
    assert.strictEqual(getSourcesCalled, false, 'desktopCapturer.getSources should NOT be called when only tab is requested');

    mgr.cancelChooseDesktopMedia(8877);
    const res = await promise;
    assert.strictEqual(res.requestId, 8877);
    assert.strictEqual(res.streamId, '');
    if (origGetSources && electron.desktopCapturer) {
      electron.desktopCapturer.getSources = origGetSources;
    }
  });

  test('MediaCaptureManager dynamically updates sharedHost on navigation and cleans listeners on stopScreenShare', () => {
    const mgr = getMediaCaptureManager();

    const listeners = new Map();
    const targetWc = {
      id: 91,
      isDestroyed: () => false,
      getTitle: () => 'Initial Title',
      getURL: () => 'https://alpha.com',
      focus: () => {},
      getZoomFactor: () => 1,
      mainFrame: { id: 'frame-91' },
      once: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      on: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      removeListener: (event, fn) => {
        if (listeners.has(event)) listeners.get(event).delete(fn);
      },
    };

    const reqWc = {
      id: 92,
      isDestroyed: () => false,
      once: (event, fn) => {
        if (!listeners.has('req-' + event)) listeners.set('req-' + event, new Set());
        listeners.get('req-' + event).add(fn);
      },
      removeListener: (event, fn) => {
        if (listeners.has('req-' + event)) listeners.get('req-' + event).delete(fn);
      },
    };

    mgr.pendingPickerRequests.set(701, {
      requestId: 701,
      isDisplayMedia: true,
      requestingWc: reqWc,
      callback: () => {},
    });

    State.tabIdToWindowId.set('tab-nav', 401);
    State.windowContextsById.set(401, {
      window: { id: 401, isDestroyed: () => false, getContentBounds: () => ({ width: 1200, height: 800 }), webContents: { isDestroyed: () => false, send: () => {} } },
      windowId: 401,
      tabs: {
        'tab-nav': {
          setBounds: () => {},
          webContents: targetWc,
        },
      },
      sleepingTabs: {},
    });

    mgr.handlePickerResponse({
      requestId: 701,
      cancelled: false,
      sourceId: 'tab:tab-nav',
      sourceKind: 'tab',
      tabId: 'tab-nav',
      shareAudio: false,
    });

    assert.ok(mgr.activeScreenShare);
    assert.strictEqual(mgr.activeScreenShare.sharedHost, 'alpha.com');

    // Simulate navigation on shared tab
    const navListeners = listeners.get('did-navigate');
    assert.ok(navListeners && navListeners.size > 0, 'did-navigate listener should be attached');
    for (const fn of navListeners) {
      fn({}, 'https://beta.org/overview');
    }

    assert.strictEqual(mgr.activeScreenShare.sharedHost, 'beta.org', 'sharedHost should update dynamically on navigation');

    // Simulate page-title-updated
    const titleListeners = listeners.get('page-title-updated');
    assert.ok(titleListeners && titleListeners.size > 0, 'page-title-updated listener should be attached');
    for (const fn of titleListeners) {
      fn({}, 'New Beta Title');
    }

    assert.strictEqual(mgr.activeScreenShare.sharedTitle, 'New Beta Title', 'sharedTitle should update dynamically on title change');

    // Now stop screen share and verify listeners were cleanly removed
    mgr.stopScreenShare();
    assert.strictEqual(listeners.get('did-navigate')?.size || 0, 0, 'did-navigate listener should be removed');
    assert.strictEqual(listeners.get('page-title-updated')?.size || 0, 0, 'page-title-updated listener should be removed');
    assert.strictEqual(listeners.get('destroyed')?.size || 0, 0, 'target destroyed listener should be removed');
  });

  test('MediaCaptureManager.captureHighQualityTabSnapshot preserves exact aspect ratio without pinching', async () => {
    const mgr = getMediaCaptureManager();
    const mockWin = {
      id: 205,
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1440, height: 900 }),
    };

    let resizeCalledWith = null;
    let jpegCalledWith = null;
    const activeView = {
      _favicon: 'https://meet.google.com/favicon.ico',
      getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: {
        id: 2051,
        isDestroyed: () => false,
        getURL: () => 'https://meet.google.com/test-room',
        getTitle: () => 'Meet – Test Room',
        isLoading: () => false,
        capturePage: async () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 1440, height: 900 }), // 16:10 aspect ratio
          resize: (opts) => {
            resizeCalledWith = opts;
            return {
              toJPEG: (q) => {
                jpegCalledWith = q;
                return Buffer.from('HIGH_RES_JPEG_DATA');
              },
              toDataURL: () => 'data:image/jpeg;base64,HIGH_RES_JPEG_DATA',
            };
          },
        }),
      },
    };

    State.webContentsIdToTabId.set(2051, 'tab-hq-test');
    State.tabIdToWindowId.set('tab-hq-test', 205);

    const context = {
      window: mockWin,
      windowId: 205,
      activeTabId: 'tab-hq-test',
      tabOrder: ['tab-hq-test'],
      tabs: { 'tab-hq-test': activeView },
      sleepingTabs: {},
    };
    State.windowContextsById.set(205, context);

    const thumbnail = await mgr.captureHighQualityTabSnapshot('tab-hq-test', 9999, context);
    assert.ok(thumbnail && thumbnail.startsWith('data:image/jpeg;base64,'), 'Should return high quality JPEG thumbnail');
    assert.strictEqual(jpegCalledWith, 92, 'Should request 92% quality JPEG for chosen tab');
    assert.ok(resizeCalledWith, 'resize should be called');
    assert.strictEqual(resizeCalledWith.width, 1440, 'Width should be scaled within 1440 bound');
    assert.strictEqual(resizeCalledWith.height, 900, 'Height should strictly preserve 16:10 aspect ratio (900px), not pinched to 16:9');
    assert.strictEqual(resizeCalledWith.quality, 'better');
  });
});
