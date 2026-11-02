'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const splitTabManager = require('../../../main/windows/splitTabManager');
const { UI_HEIGHT } = require('../../../main/constants/defaults');

describe('SplitTabManager Unit Tests', () => {
  after(() => {
    env.cleanup();
  });

  function createMockView() {
    let bounds = { x: 0, y: 0, width: 0, height: 0 };
    return {
      setBounds: (b) => { bounds = { ...b }; },
      getBounds: () => ({ ...bounds }),
      webContents: {
        id: Math.floor(Math.random() * 1000) + 1,
        isDestroyed: () => false,
        focus: () => {},
        getZoomFactor: () => 1.0,
        getURL: () => 'https://example.com',
      },
    };
  }

  function createMockContext() {
    const leftView = createMockView();
    const rightView = createMockView();
    const tab1 = 'tab-1';
    const tab2 = 'tab-2';

    const childViews = new Set();

    const mockWindow = {
      isDestroyed: () => false,
      isFullScreen: () => false,
      getContentBounds: () => ({ width: 1200, height: 800 }),
      webContents: {
        isDestroyed: () => false,
        send: () => {},
      },
    };

    const tabContentView = {
      addChildView: (v) => childViews.add(v),
      removeChildView: (v) => childViews.delete(v),
      setBounds: () => {},
    };

    return {
      window: mockWindow,
      tabContentView,
      childViews,
      tabs: {
        [tab1]: leftView,
        [tab2]: rightView,
      },
      activeTabId: tab1,
      tabOrder: [tab1, tab2],
      sleepingTabs: {},
    };
  }

  test('enterSplitView creates pair, mounts views, and sets initial ratio', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2');

    assert.ok(pair);
    assert.equal(pair.leftTabId, 'tab-1');
    assert.equal(pair.rightTabId, 'tab-2');
    assert.equal(pair.ratio, 0.5);
    assert.ok(context.splitPairs.has(pair.id));
    assert.ok(splitTabManager.isTabInSplit(context, 'tab-1'));
    assert.ok(splitTabManager.isTabInSplit(context, 'tab-2'));

    // Check bounds
    const leftBounds = context.tabs['tab-1'].getBounds();
    const rightBounds = context.tabs['tab-2'].getBounds();

    assert.equal(leftBounds.x, 8);
    assert.equal(leftBounds.y, UI_HEIGHT + 4);
    assert.ok(leftBounds.width > 0);
    assert.ok(rightBounds.x > leftBounds.width);
    assert.ok(rightBounds.width > 0);
  });

  test('setSplitRatio clamps values and adjusts layout', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2');

    // Test clamped below 0.2
    splitTabManager.setSplitRatio(context, pair.id, 0.05);
    assert.equal(pair.ratio, 0.2);

    // Test clamped above 0.8
    splitTabManager.setSplitRatio(context, pair.id, 0.95);
    assert.equal(pair.ratio, 0.8);

    // Test valid 0.35 ratio
    splitTabManager.setSplitRatio(context, pair.id, 0.35);
    assert.equal(pair.ratio, 0.35);

    const leftBounds = context.tabs['tab-1'].getBounds();
    const rightBounds = context.tabs['tab-2'].getBounds();
    assert.ok(rightBounds.width > leftBounds.width);
  });

  test('swapSplitSides sets isSwapped, swaps content view bounds, and flips focus while preserving tab bar slot', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2', { focusedSide: 'left' });

    assert.equal(pair.leftTabId, 'tab-1');
    assert.equal(pair.rightTabId, 'tab-2');
    assert.equal(pair.focusedSide, 'left');
    assert.equal(pair.isSwapped, false);

    const initialLeftX = context.tabs['tab-1'].getBounds().x;
    const initialRightX = context.tabs['tab-2'].getBounds().x;
    assert.ok(initialRightX > initialLeftX);

    splitTabManager.swapSplitSides(context, pair.id);

    // Tab ids in pair remain stable to protect tab bar position
    assert.equal(pair.leftTabId, 'tab-1');
    assert.equal(pair.rightTabId, 'tab-2');
    assert.equal(pair.isSwapped, true);
    assert.equal(pair.focusedSide, 'right');

    // Content view bounds are swapped
    const swappedLeftX = context.tabs['tab-1'].getBounds().x;
    const swappedRightX = context.tabs['tab-2'].getBounds().x;
    assert.equal(swappedLeftX, initialRightX);
    assert.equal(swappedRightX, initialLeftX);
  });

  test('enterSplitView in choosing mode and selectTabForSplit', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'choose-tab');

    assert.ok(pair);
    assert.equal(pair.leftTabId, 'tab-1');
    assert.equal(pair.rightTabId, null);
    assert.equal(pair.isChoosing, true);

    const chosen = splitTabManager.selectTabForSplit(context, pair.id, 'tab-2');
    assert.ok(chosen);
    assert.equal(pair.rightTabId, 'tab-2');
    assert.equal(pair.isChoosing, false);
    assert.equal(pair.focusedSide, 'right');
    assert.ok(context.tabs['tab-2'].getBounds().width > 0);
  });

  test('setFocusedSplitSide changes active focus and context activeTabId', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2', { focusedSide: 'left' });

    assert.equal(context.activeTabId, 'tab-1');

    splitTabManager.setFocusedSplitSide(context, pair.id, 'right');
    assert.equal(pair.focusedSide, 'right');
    assert.equal(context.activeTabId, 'tab-2');

    splitTabManager.setFocusedSplitSide(context, pair.id, 'left');
    assert.equal(pair.focusedSide, 'left');
    assert.equal(context.activeTabId, 'tab-1');
  });

  test('exitSplitView removes pair, keeps both tabs adjacent in tabOrder when separating', () => {
    const context = createMockContext();
    // tab-3 at the end
    context.tabs['tab-3'] = createMockView();
    context.tabOrder = ['tab-1', 'tab-3', 'tab-2'];
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2');

    assert.ok(splitTabManager.isTabInSplit(context, 'tab-1'));

    const success = splitTabManager.exitSplitView(context, pair.id, { activateRemaining: false });
    assert.ok(success);
    assert.ok(!splitTabManager.isTabInSplit(context, 'tab-1'));
    assert.ok(!splitTabManager.isTabInSplit(context, 'tab-2'));
    // On separate, tab-2 is placed immediately adjacent to tab-1
    assert.deepEqual(context.tabOrder, ['tab-1', 'tab-2', 'tab-3']);
  });

  test('selectTabForSplit places chosen tab immediately adjacent to left tab in tabOrder', () => {
    const context = createMockContext();
    context.tabs['tab-3'] = createMockView();
    context.tabOrder = ['tab-1', 'tab-3', 'tab-2'];
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'choose-tab');

    const chosen = splitTabManager.selectTabForSplit(context, pair.id, 'tab-2');
    assert.ok(chosen);
    assert.equal(pair.rightTabId, 'tab-2');
    assert.deepEqual(context.tabOrder, ['tab-1', 'tab-2', 'tab-3']);
  });

  test('handleTabDestroyed un-splits and preserves remaining tab', () => {
    const context = createMockContext();
    const pair = splitTabManager.enterSplitView(context, 'tab-1', 'tab-2');

    // Simulate tab-1 being destroyed
    splitTabManager.handleTabDestroyed(context, 'tab-1');

    assert.ok(!splitTabManager.isTabInSplit(context, 'tab-1'));
    assert.ok(!splitTabManager.isTabInSplit(context, 'tab-2'));
    assert.equal(context.splitPairs.size, 0);
  });
});
