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
});
