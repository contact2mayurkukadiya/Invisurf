'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const State = require('../../../main/state');
const { PermissionPromptQueue } = require('../../../main/permissions/PermissionPromptQueue');

class MockWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._destroyed = false;
  }
  isDestroyed() { return this._destroyed; }
  destroy() {
    this._destroyed = true;
    this.emit('destroyed');
  }
  send() {}
}

class MockWindow {
  constructor(id) {
    this.id = id;
    this.webContents = new MockWebContents(id + 1000);
  }
  isDestroyed() { return false; }
}

describe('Permission Queue Concurrency Regression', () => {
  test('handles 50 rapid concurrent requests without dropping or leaking callbacks', () => {
    const queue = new PermissionPromptQueue();
    const mockWin = new MockWindow(500);
    const mockWc = new MockWebContents(501);

    State.windowContextsById.set(mockWin.id, { window: mockWin, tabs: { 'tab-501': mockWc } });
    State.webContentsIdToTabId.set(mockWc.id, 'tab-501');
    State.tabIdToWindowId.set('tab-501', mockWin.id);

    const permissions = ['camera', 'microphone', 'geolocation', 'notifications', 'usb'];
    const resolutionResults = [];

    // Enqueue 50 requests
    for (let i = 0; i < 50; i++) {
      const perm = permissions[i % permissions.length];
      const origin = `https://site-${i % 5}.com`;
      queue.enqueue({
        webContents: mockWc,
        origin,
        permission: perm,
        onResolve: (decision) => {
          resolutionResults.push({ index: i, origin, perm, decision });
        },
      });
    }

    // Now resolve all active prompts in order until queue is completely empty
    while (queue.activePrompts.size > 0) {
      const [promptId] = queue.activePrompts.keys();
      queue.resolvePrompt(promptId, 'allow');
    }

    // Every single enqueued request MUST have received an onResolve callback
    assert.equal(resolutionResults.length, 50, 'All 50 callbacks should be resolved');
    for (const res of resolutionResults) {
      assert.equal(res.decision, 'allow');
    }

    // Cleanup
    queue.cancelAllForWebContents(mockWc.id);
    State.windowContextsById.clear();
    State.webContentsIdToTabId.clear();
    State.tabIdToWindowId.clear();
  });
});
