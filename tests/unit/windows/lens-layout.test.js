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
});
