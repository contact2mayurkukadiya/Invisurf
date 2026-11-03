'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const State = require('../../../main/state');
const C = require('../../../src/constants/conditionStrings.cjs');
const tabDragManager = require('../../../main/windows/tabDragManager');

describe('TabDragManager Unit Tests', () => {
  after(() => {
    env.cleanup();
  });

  beforeEach(() => {
    State.windowContextsById.clear();
    State.tabIdToWindowId.clear();
    State.detachedTabWindows.clear();
    State.webContentsIdToTabId.clear();
    tabDragManager.handleDragEnd(); // reset activeDrag
  });

  test('findTargetWindowForReattach matches candidate window inside tab bar bounds', () => {
    const mockWin = {
      id: 201,
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      getBounds: () => ({ x: 100, y: 100, width: 1000, height: 700 }),
    };

    const targetContext = {
      window: mockWin,
      profileId: 'default',
      stealthWindow: false,
    };
    State.windowContextsById.set(201, targetContext);

    const sourceContext = { profileId: 'default', stealthWindow: false };

    // Point inside tab bar (x=500, y=120: y is within 100 to 155)
    const match = tabDragManager.findTargetWindowForReattach(999, 500, 120, sourceContext);
    assert.ok(match);
    assert.strictEqual(match.targetContext, targetContext);

    // Point outside horizontally (x=50)
    const outsideX = tabDragManager.findTargetWindowForReattach(999, 50, 120, sourceContext);
    assert.equal(outsideX, null);

    // Point outside vertically (below tab bar at y=250)
    const outsideY = tabDragManager.findTargetWindowForReattach(999, 500, 250, sourceContext);
    assert.equal(outsideY, null);

    // Point inside, but window is excluded (it is the current drag window)
    const excluded = tabDragManager.findTargetWindowForReattach(201, 500, 120, sourceContext);
    assert.equal(excluded, null);
  });

  test('findTargetWindowForReattach enforces profile and stealth isolation', () => {
    const normalWin = {
      id: 301,
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 1000, height: 600 }),
    };
    State.windowContextsById.set(301, {
      window: normalWin,
      profileId: 'profile-a',
      stealthWindow: false,
    });

    // Stealth drag should NOT attach to normal window
    const stealthSource = { profileId: 'profile-a', stealthWindow: true };
    const stealthMatch = tabDragManager.findTargetWindowForReattach(999, 100, 20, stealthSource);
    assert.equal(stealthMatch, null);

    // Different profile should NOT attach
    const otherProfileSource = { profileId: 'profile-b', stealthWindow: false };
    const diffProfileMatch = tabDragManager.findTargetWindowForReattach(999, 100, 20, otherProfileSource);
    assert.equal(diffProfileMatch, null);
  });

  test('startDetach handles single tab drag by translating current window', () => {
    let positionSet = null;
    const singleWin = {
      id: 401,
      isDestroyed: () => false,
      setPosition: (x, y) => { positionSet = { x, y }; },
    };

    const sourceContext = {
      window: singleWin,
      tabOrder: ['tab-only-one'],
      tabs: { 'tab-only-one': {} },
      profileId: 'default',
      stealthWindow: false,
    };

    const res = tabDragManager.startDetach(sourceContext, {
      tabId: 'tab-only-one',
      screenX: 200,
      screenY: 200,
      grabOffsetX: 40,
      grabOffsetY: 15,
      isSingleTab: true,
    });

    assert.ok(res.ok);
    assert.strictEqual(res.isSingleTab, true);

    const active = tabDragManager.getActiveDrag();
    assert.ok(active);
    assert.strictEqual(active.isSingleTabDrag, true);

    // Drag move updates window position
    tabDragManager.handleDragMove({ screenX: 300, screenY: 350 });
    assert.ok(positionSet);
    assert.strictEqual(positionSet.x, 300 - 40);
    assert.strictEqual(positionSet.y, 350 - 15);

    // Drag end clears active drag
    tabDragManager.handleDragEnd();
    assert.equal(tabDragManager.getActiveDrag(), null);
  });

  test('startDetach sets alwaysOnTop and moveTop on detached window, and restores on endDrag', () => {
    const windowManager = require('../../../main/windows/windowManager');
    const origCreateWindow = windowManager.createWindow;

    const calls = [];
    const mockDetachedWin = {
      id: 501,
      isDestroyed: () => false,
      setAlwaysOnTop: (flag, level) => { calls.push(['setAlwaysOnTop', flag, level]); },
      setFocusable: (flag) => { calls.push(['setFocusable', flag]); },
      showInactive: () => { calls.push(['showInactive']); },
      moveTop: () => { calls.push(['moveTop']); },
      setPosition: (x, y) => { calls.push(['setPosition', x, y]); },
      focus: () => { calls.push(['focus']); },
    };

    windowManager.createWindow = (opts) => {
      calls.push(['createWindow', opts]);
      return {
        window: mockDetachedWin,
        windowId: 'win-detached-501',
        tabs: {},
      };
    };

    try {
      const sourceContext = {
        window: {
          id: 101,
          isDestroyed: () => false,
          getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
          getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
        },
        tabOrder: ['tab-1', 'tab-2'],
        tabs: {
          'tab-1': { webContents: { isDestroyed: () => false, getURL: () => 'https://example.com', getTitle: () => 'Example' } },
          'tab-2': { webContents: { isDestroyed: () => false, getURL: () => 'https://test.com', getTitle: () => 'Test' } },
        },
        profileId: 'default',
        stealthWindow: false,
      };

      const res = tabDragManager.startDetach(sourceContext, {
        tabId: 'tab-1',
        screenX: 400,
        screenY: 200,
        grabOffsetX: 50,
        grabOffsetY: 20,
        isSingleTab: false,
      });

      assert.ok(res.ok);
      // Verify createWindow received alwaysOnTop: true, show: false, focusable: false
      const createCall = calls.find(c => c[0] === 'createWindow');
      assert.ok(createCall);
      assert.strictEqual(createCall[1].alwaysOnTop, true);
      assert.strictEqual(createCall[1].show, false);
      assert.strictEqual(createCall[1].focusable, false);

      // Verify setAlwaysOnTop(true, 'floating') and moveTop were called on detached window
      assert.ok(calls.some(c => c[0] === 'setAlwaysOnTop' && c[1] === true && c[2] === 'floating'));
      assert.ok(calls.some(c => c[0] === 'moveTop'));

      // Move drag - should call moveTop to maintain top-most z-order
      calls.length = 0;
      tabDragManager.handleDragMove({ screenX: 450, screenY: 250 });
      assert.ok(calls.some(c => c[0] === 'moveTop'));

      // End drag (not docked) - should restore setAlwaysOnTop(false) and focusable(true)
      calls.length = 0;
      tabDragManager.handleDragEnd();
      assert.ok(calls.some(c => c[0] === 'setAlwaysOnTop' && c[1] === false));
      assert.ok(calls.some(c => c[0] === 'setFocusable' && c[1] === true));
      assert.ok(calls.some(c => c[0] === 'focus'));
    } finally {
      windowManager.createWindow = origCreateWindow;
    }
  });

  test('startDetach detaches split tabs as a compound pair in multi-tab window', () => {
    const windowManager = require('../../../main/windows/windowManager');
    const origCreateWindow = windowManager.createWindow;

    let createdPayload = null;
    const mockDetachedWin = {
      id: 601,
      isDestroyed: () => false,
      getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      isFullScreen: () => false,
      setAlwaysOnTop: () => {},
      setFocusable: () => {},
      showInactive: () => {},
      moveTop: () => {},
      setPosition: () => {},
      focus: () => {},
    };

    windowManager.createWindow = (opts) => {
      createdPayload = opts.bootstrapPayload;
      return {
        window: mockDetachedWin,
        windowId: 'win-detached-601',
        tabs: {},
      };
    };

    try {
      const splitPair = { id: 'pair-1', leftTabId: 'left-1', rightTabId: 'right-1', ratio: 0.5 };
      const leftView = {
        setBounds: () => {},
        webContents: { isDestroyed: () => false, getURL: () => 'https://left.com', getTitle: () => 'Left', id: 701 },
      };
      const rightView = {
        setBounds: () => {},
        webContents: { isDestroyed: () => false, getURL: () => 'https://right.com', getTitle: () => 'Right', id: 702 },
      };

      const sourceContext = {
        window: {
          id: 101,
          isDestroyed: () => false,
          isFullScreen: () => false,
          getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
          getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
          webContents: {
            isDestroyed: () => false,
            send: () => {},
          },
        },
        tabOrder: ['left-1', 'right-1', 'normal-3'],
        tabs: {
          'left-1': leftView,
          'right-1': rightView,
          'normal-3': {
            setBounds: () => {},
            webContents: {
              isDestroyed: () => false,
              getURL: () => 'https://other.com',
              getTitle: () => 'Other',
              id: 703,
              focus: () => {},
              getZoomFactor: () => 1.0,
            },
          },
        },
        splitPairs: new Map([['pair-1', splitPair]]),
        profileId: 'default',
        stealthWindow: false,
        activeTabId: 'left-1',
      };

      const res = tabDragManager.startDetach(sourceContext, {
        tabId: 'left-1',
        splitPair,
        rightTabData: { id: 'right-1', title: 'Right', url: 'https://right.com' },
        screenX: 400,
        screenY: 200,
      });

      assert.ok(res.ok);
      assert.ok(createdPayload);
      assert.ok(createdPayload.detachedSplit);
      assert.strictEqual(createdPayload.detachedSplit.splitPair.id, 'pair-1');
      assert.strictEqual(createdPayload.detachedSplit.leftTab.id, 'left-1');
      assert.strictEqual(createdPayload.detachedSplit.rightTab.id, 'right-1');

      // Both tabs and splitPair should be removed from sourceContext
      assert.strictEqual(sourceContext.tabs['left-1'], undefined);
      assert.strictEqual(sourceContext.tabs['right-1'], undefined);
      assert.deepStrictEqual(sourceContext.tabOrder, ['normal-3']);
      assert.strictEqual(sourceContext.splitPairs.has('pair-1'), false);
      assert.strictEqual(sourceContext.activeTabId, 'normal-3');

      // Active drag should hold splitPair info
      const active = tabDragManager.getActiveDrag();
      assert.ok(active);
      assert.ok(active.splitPair);
      assert.strictEqual(active.splitPair.id, 'pair-1');
      assert.strictEqual(active.leftTabId, 'left-1');
      assert.strictEqual(active.rightTabId, 'right-1');
    } finally {
      windowManager.createWindow = origCreateWindow;
      tabDragManager.handleDragEnd();
    }
  });

  test('startDetach handles single split tab window by translating window directly', () => {
    let positionSet = null;
    const singleWin = {
      id: 701,
      isDestroyed: () => false,
      setPosition: (x, y) => { positionSet = { x, y }; },
    };

    const splitPair = { id: 'pair-single', leftTabId: 's-left', rightTabId: 's-right', ratio: 0.5 };
    const sourceContext = {
      window: singleWin,
      tabOrder: ['s-left', 's-right'],
      tabs: {
        's-left': { webContents: { isDestroyed: () => false, getURL: () => 'https://a.com', getTitle: () => 'A', id: 801 } },
        's-right': { webContents: { isDestroyed: () => false, getURL: () => 'https://b.com', getTitle: () => 'B', id: 802 } },
      },
      splitPairs: new Map([['pair-single', splitPair]]),
      profileId: 'default',
      stealthWindow: false,
    };

    const res = tabDragManager.startDetach(sourceContext, {
      tabId: 's-left',
      splitPair,
      rightTabData: { id: 's-right', title: 'B', url: 'https://b.com' },
      screenX: 200,
      screenY: 200,
      grabOffsetX: 40,
      grabOffsetY: 15,
      isSingleTab: true,
    });

    assert.ok(res.ok);
    assert.strictEqual(res.isSingleTab, true);

    const active = tabDragManager.getActiveDrag();
    assert.ok(active);
    assert.strictEqual(active.isSingleTabDrag, true);
    assert.ok(active.splitPair);
    assert.strictEqual(active.splitPair.id, 'pair-single');

    tabDragManager.handleDragEnd();
  });

  test('dockTabIntoWindow docks split tab into target window as a split pair', () => {
    const splitPair = { id: 'pair-dock', leftTabId: 'd-left', rightTabId: 'd-right', ratio: 0.5 };
    const leftView = {
      setBounds: () => {},
      webContents: { isDestroyed: () => false, getURL: () => 'https://left.com', getTitle: () => 'Left', id: 901 },
    };
    const rightView = {
      setBounds: () => {},
      webContents: { isDestroyed: () => false, getURL: () => 'https://right.com', getTitle: () => 'Right', id: 902 },
    };

    const detachedWin = {
      id: 888,
      isDestroyed: () => false,
      isFullScreen: () => false,
      getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      hide: () => {},
      setAlwaysOnTop: () => {},
    };

    const detachedContext = {
      window: detachedWin,
      windowId: 'win-detached-888',
      tabs: { 'd-left': leftView, 'd-right': rightView },
      tabOrder: ['d-left', 'd-right'],
      splitPairs: new Map([['pair-dock', splitPair]]),
    };

    const sentIpc = [];
    const targetWin = {
      id: 999,
      isDestroyed: () => false,
      isFullScreen: () => false,
      getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
      webContents: {
        isDestroyed: () => false,
        send: (channel, data) => { sentIpc.push({ channel, data }); },
      },
    };

    const targetContext = {
      window: targetWin,
      windowId: 'win-target-999',
      tabs: { 'existing-1': { webContents: { isDestroyed: () => false, id: 903 } } },
      tabOrder: ['existing-1'],
      splitPairs: new Map(),
      profileId: 'default',
      stealthWindow: false,
    };

    const windowManager = require('../../../main/windows/windowManager');
    const origCreateWindow = windowManager.createWindow;
    windowManager.createWindow = () => detachedContext;

    try {
      const sourceContext = {
        window: {
          id: 101,
          isDestroyed: () => false,
          getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
          getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
        },
        tabOrder: ['d-left', 'd-right', 'extra'],
        tabs: { 'd-left': leftView, 'd-right': rightView, 'extra': {} },
        splitPairs: new Map([['pair-dock', splitPair]]),
      };

      tabDragManager.startDetach(sourceContext, {
        tabId: 'd-left',
        splitPair,
        rightTabData: { id: 'd-right', title: 'Right', url: 'https://right.com' },
        screenX: 100,
        screenY: 100,
      });

      tabDragManager.dockTabIntoWindow(targetContext, 250, 50);

      const active = tabDragManager.getActiveDrag();
      assert.ok(active);
      assert.strictEqual(active.isDocked, true);
      assert.strictEqual(active.currentContext, targetContext);

      // Verify targetContext has both tabs and split pair
      assert.ok(targetContext.tabs['d-left']);
      assert.ok(targetContext.tabs['d-right']);
      assert.ok(targetContext.tabOrder.includes('d-left'));
      assert.ok(targetContext.tabOrder.includes('d-right'));
      assert.ok(targetContext.splitPairs.has('pair-dock'));

      // Verify TAB_REATTACHED IPC was sent with splitPair
      const reattachMsg = sentIpc.find(m => m.channel === C.IPC_EVENT.TAB_REATTACHED);
      assert.ok(reattachMsg);
      assert.ok(reattachMsg.data.splitPair);
      assert.strictEqual(reattachMsg.data.splitPair.id, 'pair-dock');
      assert.strictEqual(reattachMsg.data.leftTab.id, 'd-left');
      assert.strictEqual(reattachMsg.data.rightTab.id, 'd-right');
    } finally {
      windowManager.createWindow = origCreateWindow;
      tabDragManager.handleDragEnd();
    }
  });
});
