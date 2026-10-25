'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const State = require('../../../main/state');
const sidePanelManager = require('../../../main/windows/sidePanelManager');
const tabManager = require('../../../main/windows/tabManager');
const { UI_HEIGHT } = require('../../../main/constants/defaults');

describe('SidePanelManager Layout and Bounds', () => {
  after(() => {
    env.cleanup();
  });

  test('getSidePanelState initializes default side panel state on context', () => {
    const mockContext = {};
    const state = sidePanelManager.getSidePanelState(mockContext);
    assert.ok(state);
    assert.equal(state.isOpen, false);
    assert.equal(state.width, sidePanelManager.SIDE_PANEL_DEFAULT_WIDTH);
    assert.equal(state.activePanelId, 'reading-list');
  });

  test('getSidePanelWidth returns 0 when closed and clamped width when open', () => {
    const mockContext = {
      window: {
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed: () => false,
        isFullScreen: () => false,
      },
      sidePanelState: {
        isOpen: false,
        width: 380,
      },
    };

    assert.equal(sidePanelManager.getSidePanelWidth(mockContext), 0);
    assert.equal(sidePanelManager.isSidePanelOpen(mockContext), false);

    mockContext.sidePanelState.isOpen = true;
    assert.equal(sidePanelManager.getSidePanelWidth(mockContext), 380);
    assert.equal(sidePanelManager.isSidePanelOpen(mockContext), true);
  });

  test('getSidePanelWidth clamps to minimum and maximum constraints', () => {
    const mockContext = {
      window: {
        getContentBounds: () => ({ width: 1000, height: 800 }),
        isDestroyed: () => false,
        isFullScreen: () => false,
      },
      sidePanelState: {
        isOpen: true,
        width: 100, // below min (260)
      },
    };

    assert.equal(sidePanelManager.getSidePanelWidth(mockContext), sidePanelManager.SIDE_PANEL_MIN_WIDTH);

    // Test above max (bounds.width - WEB_CONTENTS_MIN_WIDTH = 1000 - 360 = 640)
    mockContext.sidePanelState.width = 900;
    assert.equal(sidePanelManager.getSidePanelWidth(mockContext), 640);
  });

  test('getSidePanelWidth yields to fullscreen mode', () => {
    const mockContext = {
      activeTabId: 'tab-fs-1',
      window: {
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed: () => false,
        isFullScreen: () => true,
      },
      sidePanelState: {
        isOpen: true,
        width: 360,
      },
    };

    assert.equal(sidePanelManager.getSidePanelWidth(mockContext), 0);
    assert.equal(sidePanelManager.isSidePanelOpen(mockContext), false);
  });

  test('layoutActiveTabView shrinks tab into card view with corner radius when open', () => {
    let capturedBounds = null;
    let capturedRadius = null;
    const mockTab = {
      webContents: {
        isDestroyed: () => false,
        setVisualZoomLevelLimits: () => Promise.resolve(),
      },
      setBounds: (b) => {
        capturedBounds = b;
      },
      setBorderRadius: (r) => {
        capturedRadius = r;
      },
    };

    const mockContext = {
      activeTabId: 'tab-1',
      tabs: {
        'tab-1': mockTab,
      },
      window: {
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed: () => false,
        isFullScreen: () => false,
      },
      sidePanelState: {
        isOpen: false,
        width: 360,
      },
    };

    // When closed: full content width and zero corner radius
    tabManager.layoutActiveTabView(mockContext, 'tab-1');
    assert.ok(capturedBounds);
    assert.equal(capturedBounds.x, 0);
    assert.equal(capturedBounds.y, UI_HEIGHT);
    assert.equal(capturedBounds.width, 1200);
    assert.equal(capturedBounds.height, 800 - UI_HEIGHT);
    assert.equal(capturedRadius, 0);

    // When open: card bounds with 14px corner radius and gaps
    mockContext.sidePanelState.isOpen = true;
    tabManager.layoutActiveTabView(mockContext, 'tab-1');
    assert.equal(capturedBounds.x, 8);
    assert.equal(capturedBounds.y, UI_HEIGHT + 4);
    assert.equal(capturedBounds.width, 826);
    assert.equal(capturedBounds.height, 800 - UI_HEIGHT - 12);
    assert.equal(capturedRadius, 14);
  });
});
