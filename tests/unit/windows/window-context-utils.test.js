'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const State = require('../../../main/state');
const windowUtils = require('../../../main/windows/windowContextUtils');

describe('WindowContextUtils', () => {
  after(() => {
    env.cleanup();
  });

  beforeEach(() => {
    State.windowContextsById.clear();
    State.tabIdToWindowId.clear();
    State.detachedTabWindows.clear();
    State.webContentsIdToTabId.clear();
  });

  test('getWindowContextById retrieves context from State', () => {
    const mockContext = { id: 101, profileId: 'work' };
    State.windowContextsById.set(101, mockContext);

    assert.strictEqual(windowUtils.getWindowContextById(101), mockContext);
    assert.equal(windowUtils.getWindowContextById(999), null);
    assert.equal(windowUtils.getWindowContextById(null), null);
  });

  test('getWindowContextByBrowserWindow retrieves context and rejects destroyed window', () => {
    const mockContext = { id: 202, profileId: 'personal' };
    State.windowContextsById.set(202, mockContext);

    const aliveWindow = { id: 202, isDestroyed: () => false };
    const destroyedWindow = { id: 202, isDestroyed: () => true };

    assert.strictEqual(windowUtils.getWindowContextByBrowserWindow(aliveWindow), mockContext);
    assert.equal(windowUtils.getWindowContextByBrowserWindow(destroyedWindow), null);
    assert.equal(windowUtils.getWindowContextByBrowserWindow(null), null);
  });

  test('getWindowContextByTabId maps tabId to its host window context', () => {
    const mockContext = { id: 303, profileId: 'default' };
    State.windowContextsById.set(303, mockContext);
    State.tabIdToWindowId.set('tab-alpha', 303);

    assert.strictEqual(windowUtils.getWindowContextByTabId('tab-alpha'), mockContext);
    assert.equal(windowUtils.getWindowContextByTabId('tab-unknown'), null);
  });

  test('isViewWebContentsAlive verifies webContents destruction status', () => {
    const aliveView = {
      webContents: { isDestroyed: () => false },
    };
    const deadView = {
      webContents: { isDestroyed: () => true },
    };
    const nullView = null;
    const viewWithoutWebContents = {};

    assert.equal(windowUtils.isViewWebContentsAlive(aliveView), true);
    assert.equal(windowUtils.isViewWebContentsAlive(deadView), false);
    assert.equal(windowUtils.isViewWebContentsAlive(nullView), false);
    assert.equal(windowUtils.isViewWebContentsAlive(viewWithoutWebContents), false);
  });

  test('getWindowContextByChromeOverlaySender locates context by overlay view webContents', () => {
    const mockSender = { isDestroyed: () => false };
    const overlayView = { webContents: mockSender };

    const mockContext = {
      id: 404,
      chromeOverlayView: overlayView,
      chromeShellMenuOverlayView: null,
      chromeOmniboxOverlayView: null,
    };
    State.windowContextsById.set(404, mockContext);

    assert.strictEqual(windowUtils.getWindowContextByChromeOverlaySender(mockSender), mockContext);
    assert.equal(windowUtils.getWindowContextByChromeOverlaySender(null), null);
    assert.equal(windowUtils.getWindowContextByChromeOverlaySender({ isDestroyed: () => true }), null);
  });
});
