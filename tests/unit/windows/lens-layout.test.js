'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const lensManager = require('../../../main/windows/lensManager');
const { UI_HEIGHT, LENS_PANEL_GAP } = require('../../../main/constants/defaults');

describe('LensManager Layout and Session State', () => {
  after(() => {
    env.cleanup();
  });

  test('getLensSession initializes and retrieves tab session state', () => {
    const mockContext = { lensSessions: new Map() };
    const tabId = 'tab-lens-1';

    // Retrieve without create
    assert.equal(lensManager.getLensSession(mockContext, tabId, false), null);

    // Retrieve with create = true
    const session = lensManager.getLensSession(mockContext, tabId, true);
    assert.ok(session);
    assert.equal(session.tabId, tabId);
    assert.equal(session.selectionActive, false);
    assert.equal(session.pageScale, 1);

    // Second call returns existing
    const existing = lensManager.getLensSession(mockContext, tabId, false);
    assert.strictEqual(existing, session);
  });

  test('getLensLayoutMetrics computes content geometry without sidebar', () => {
    const mockContext = {
      window: {
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed: () => false,
      },
      activeTabId: 'tab-1',
      lensSessions: new Map(),
    };

    const metrics = lensManager.getLensLayoutMetrics(mockContext, 'tab-1');
    assert.ok(metrics);
    assert.equal(metrics.width, 1200);
    assert.equal(metrics.height, 800);
    assert.equal(metrics.contentTop, UI_HEIGHT);
    assert.equal(metrics.contentHeight, 800 - UI_HEIGHT);
    assert.equal(metrics.sidebarWidth, 0);
    assert.equal(metrics.leftPanelBounds.width, 1200);
  });

  test('computeLensChromeOverlayBounds returns full content bounds when no sidebar is open', () => {
    const mockContext = {
      window: {
        getContentBounds: () => ({ width: 1000, height: 700 }),
        isDestroyed: () => false,
      },
      activeTabId: 'tab-2',
      lensSessions: new Map(),
    };

    const bounds = lensManager.computeLensChromeOverlayBounds(mockContext, 'tab-2');
    assert.deepEqual(bounds, {
      x: 0,
      y: UI_HEIGHT,
      width: 1000,
      height: 700 - UI_HEIGHT,
    });
  });

  test('getFirstActiveLensTabId finds tab with active selection', () => {
    const mockContext = {
      tabs: {
        'tab-b': { webContents: { isDestroyed: () => false } },
      },
      lensSessions: new Map([
        ['tab-a', { selectionActive: false }],
        ['tab-b', { selectionActive: true }],
      ]),
    };

    assert.equal(lensManager.getFirstActiveLensTabId(mockContext), 'tab-b');
  });

  test('repairLensChromeOverlayAcquireCount synchronizes overlay counters', () => {
    const mockContext = {
      chromeOverlayAcquireCount: 0,
      lensSessions: new Map([
        ['tab-x', { selectionActive: true, overlayAcquired: true }],
      ]),
    };

    lensManager.repairLensChromeOverlayAcquireCount(mockContext);
    assert.equal(mockContext.chromeOverlayAcquireCount, 1);
  });

  test('isGoogleLensSidebarUrl and extractDestinationUrl handle search results and outbound links', () => {
    const { isGoogleLensSidebarUrl, extractDestinationUrl } = require('../../../main/utils/navigation');

    // Valid Lens sidebar URLs (including regional domains and search paths)
    assert.equal(isGoogleLensSidebarUrl('https://lens.google.com/v3/upload?ep=ccm'), true);
    assert.equal(isGoogleLensSidebarUrl('https://www.google.com/search?vsrid=12345&udm=26'), true);
    assert.equal(isGoogleLensSidebarUrl('https://www.google.co.in/search?vsrid=98765'), true);
    assert.equal(isGoogleLensSidebarUrl('https://www.google.co.uk/search?q=test'), true);
    assert.equal(isGoogleLensSidebarUrl('https://www.google.com/imghp'), true);
    assert.equal(isGoogleLensSidebarUrl('https://www.google.com/lens?hl=en'), true);
    assert.equal(isGoogleLensSidebarUrl('data:text/html;base64,abc'), true);

    // Outbound external links must not stay in sidebar
    assert.equal(isGoogleLensSidebarUrl('https://www.youtube.com/watch?v=123'), false);
    assert.equal(isGoogleLensSidebarUrl('https://photoadking.com/design'), false);
    assert.equal(isGoogleLensSidebarUrl('https://en.wikipedia.org/wiki/Earth'), false);

    // Google /url redirect wrapper is outbound navigation
    const googleRedirect = 'https://www.google.com/url?q=https%3A%2F%2Fphotoadking.com%2Fdesign&sa=U';
    assert.equal(isGoogleLensSidebarUrl(googleRedirect), false);
    assert.equal(extractDestinationUrl(googleRedirect), 'https://photoadking.com/design');
    const googleRegionalRedirect = 'https://www.google.co.in/url?q=https%3A%2F%2Fexample.com%2Fitem&sa=U';
    assert.equal(isGoogleLensSidebarUrl(googleRegionalRedirect), false);
    assert.equal(extractDestinationUrl(googleRegionalRedirect), 'https://example.com/item');
  });

  test('getLensSidebarCurrentUrl retrieves loaded sidebar url and ignores invalid/placeholder', () => {
    const mockContext = {
      activeTabId: 'tab-1',
      lensSessions: new Map([
        ['tab-1', {
          sidebarView: {
            webContents: {
              isDestroyed: () => false,
              getURL: () => 'https://www.google.com/search?vsrid=12345&udm=26',
            },
          },
        }],
      ]),
    };

    const url = lensManager.getLensSidebarCurrentUrl(mockContext, 'tab-1');
    assert.equal(url, 'https://www.google.com/search?vsrid=12345&udm=26');

    // Data url placeholder returns null
    mockContext.lensSessions.get('tab-1').sidebarView.webContents.getURL = () => 'data:text/html;base64,...';
    assert.equal(lensManager.getLensSidebarCurrentUrl(mockContext, 'tab-1'), null);
  });

  test('openLensInNewTab opens active Google Lens search page in new tab', () => {
    const tabManager = require('../../../main/windows/tabManager');
    const originalOpenUrlInNewTab = tabManager.openUrlInNewTab;
    let openedUrl = null;
    let openedOptions = null;
    tabManager.openUrlInNewTab = (url, opts) => {
      openedUrl = url;
      openedOptions = opts;
      return true;
    };

    try {
      const mockContext = {
        activeTabId: 'tab-lens',
        lensSessions: new Map([
          ['tab-lens', {
            sidebarView: {
              webContents: {
                isDestroyed: () => false,
                getURL: () => 'https://www.google.com/search?vsrid=99999',
              },
            },
          }],
        ]),
      };

      const result = lensManager.openLensInNewTab(mockContext, 'tab-lens');
      assert.equal(result, true);
      assert.equal(openedUrl, 'https://www.google.com/search?vsrid=99999');
      assert.equal(openedOptions.background, false);
    } finally {
      tabManager.openUrlInNewTab = originalOpenUrlInNewTab;
    }
  });

  test('applyLensSidebarMobileViewport disables emulation and adjusts zoom factor for narrow sidebar', () => {
    let disabledEmulationCalled = false;
    let zoomFactorSet = null;
    const mockSidebarView = {
      webContents: {
        isDestroyed: () => false,
        disableDeviceEmulation: () => {
          disabledEmulationCalled = true;
        },
        setZoomFactor: (zoom) => {
          zoomFactorSet = zoom;
        },
      },
    };

    const mockContext = {
      activeTabId: 'tab-1',
      window: {
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed: () => false,
      },
      lensSessions: new Map([
        ['tab-1', {
          selectionActive: true,
          sidebarWidth: 346,
          sidebarView: mockSidebarView,
        }],
      ]),
    };

    lensManager.applyLensSidebarMobileViewport(mockContext, 'tab-1', { immediate: true });
    assert.equal(disabledEmulationCalled, true);
    assert.ok(zoomFactorSet !== null);
    assert.ok(zoomFactorSet >= 0.75 && zoomFactorSet <= 1.0);
  });

  test('reloadLensSidebar reloads webContents of active Lens sidebar view', () => {
    let reloadCalled = false;
    const mockContext = {
      activeTabId: 'tab-lens-reload',
      lensSessions: new Map([
        ['tab-lens-reload', {
          sidebarView: {
            webContents: {
              isDestroyed: () => false,
              reload: () => {
                reloadCalled = true;
              },
            },
          },
        }],
      ]),
    };

    const res = lensManager.reloadLensSidebar(mockContext, 'tab-lens-reload');
    assert.equal(res, true);
    assert.equal(reloadCalled, true);

    // Destroyed or missing view returns false
    mockContext.lensSessions.get('tab-lens-reload').sidebarView.webContents.isDestroyed = () => true;
    assert.equal(lensManager.reloadLensSidebar(mockContext, 'tab-lens-reload'), false);
    assert.equal(lensManager.reloadLensSidebar(mockContext, 'non-existent'), false);
  });

  test('suspendLensSessionPresentation resets snapshotSentToOverlay so next presentation re-sends snapshot', () => {
    const mockContext = {
      activeTabId: 'tab-lens-suspend',
      chromeOverlayAcquireCount: 1,
      chromeOverlayView: {
        webContents: {
          isDestroyed: () => false,
          send: () => {},
        },
        setBounds: () => {},
      },
      lensSessions: new Map([
        ['tab-lens-suspend', {
          selectionActive: true,
          overlayAcquired: true,
          snapshotSentToOverlay: true,
          snapshotDataUrl: 'data:image/png;base64,abc123',
        }],
      ]),
    };

    const session = mockContext.lensSessions.get('tab-lens-suspend');
    assert.equal(session.snapshotSentToOverlay, true);

    lensManager.suspendLensSessionPresentation(mockContext, 'tab-lens-suspend');
    assert.equal(session.snapshotSentToOverlay, false);
    assert.equal(session.overlayAcquired, false);
  });
});

