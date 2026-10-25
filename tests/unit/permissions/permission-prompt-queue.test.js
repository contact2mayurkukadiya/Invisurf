'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { setupTestEnvironment } = require('../../helpers/setupUnitTests');

let testEnv;
before(() => {
  testEnv = setupTestEnvironment();
});
after(() => {
  if (testEnv && testEnv.cleanup) testEnv.cleanup();
});

const State = require('../../../main/state');
const { PermissionPromptQueue } = require('../../../main/permissions/PermissionPromptQueue');

class MockWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._destroyed = false;
  }

  isDestroyed() {
    return this._destroyed;
  }

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
    this._destroyed = false;
  }

  isDestroyed() {
    return this._destroyed;
  }
}

describe('PermissionPromptQueue', () => {
  let queue;
  let mockWc1;
  let mockWc2;
  let mockWin;

  beforeEach(() => {
    queue = new PermissionPromptQueue();
    mockWc1 = new MockWebContents(1);
    mockWc2 = new MockWebContents(2);
    mockWin = new MockWindow(100);

    // Wire up State so getWindowContextByEventSender resolves
    State.windowContextsById.set(mockWin.id, {
      window: mockWin,
      tabs: { 'tab-1': mockWc1, 'tab-2': mockWc2 },
    });
    State.webContentsIdToTabId.set(mockWc1.id, 'tab-1');
    State.webContentsIdToTabId.set(mockWc2.id, 'tab-2');
    State.tabIdToWindowId.set('tab-1', mockWin.id);
    State.tabIdToWindowId.set('tab-2', mockWin.id);
  });

  afterEach(() => {
    queue.cancelAllForWebContents(mockWc1.id);
    queue.cancelAllForWebContents(mockWc2.id);
    State.windowContextsById.clear();
    State.webContentsIdToTabId.clear();
    State.tabIdToWindowId.clear();
  });

  test('resolves deny immediately when webContents is already destroyed', () => {
    mockWc1.destroy();
    let resolvedDecision = null;

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://example.com',
      permission: 'camera',
      onResolve: (decision) => {
        resolvedDecision = decision;
      },
    });

    assert.equal(resolvedDecision, 'deny');
  });

  test('resolves deny when window context is missing or destroyed', () => {
    // Break the window context
    State.windowContextsById.delete(mockWin.id);
    let resolvedDecision = null;

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://example.com',
      permission: 'camera',
      onResolve: (decision) => {
        resolvedDecision = decision;
      },
    });

    assert.equal(resolvedDecision, 'deny');
  });

  test('enqueues and presents prompt immediately for first request', () => {
    let resolved = false;

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://example.com',
      permission: 'camera',
      onResolve: (decision, persist) => {
        assert.equal(decision, 'allow');
        assert.equal(persist, true);
        resolved = true;
      },
    });

    assert.equal(queue.activePrompts.size, 1);
    const [promptId] = queue.activePrompts.keys();
    assert.ok(promptId.startsWith('perm-prompt-'));

    queue.resolvePrompt(promptId, 'allow', true);
    assert.equal(resolved, true);
    assert.equal(queue.activePrompts.size, 0);
  });

  test('queues subsequent requests and processes them in FIFO order', () => {
    const resolutions = [];

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://example.com',
      permission: 'camera',
      onResolve: (decision) => resolutions.push(`camera:${decision}`),
    });

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://example.com',
      permission: 'microphone',
      onResolve: (decision) => resolutions.push(`mic:${decision}`),
    });

    // Only 1 prompt active initially
    assert.equal(queue.activePrompts.size, 1);
    const firstPrompt = Array.from(queue.activePrompts.values())[0];
    assert.equal(firstPrompt.permission, 'camera');

    // Resolve first prompt
    queue.resolvePrompt(firstPrompt.promptId, 'allow');
    assert.deepEqual(resolutions, ['camera:allow']);

    // Next prompt (mic) becomes active
    assert.equal(queue.activePrompts.size, 1);
    const secondPrompt = Array.from(queue.activePrompts.values())[0];
    assert.equal(secondPrompt.permission, 'microphone');

    // Resolve second prompt
    queue.resolvePrompt(secondPrompt.promptId, 'deny');
    assert.deepEqual(resolutions, ['camera:allow', 'mic:deny']);
    assert.equal(queue.activePrompts.size, 0);
  });

  test('deduplicates simultaneous identical requests by chaining onResolve', () => {
    const resolutions = [];

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://zoom.us',
      permission: 'camera',
      onResolve: (d) => resolutions.push(`call1:${d}`),
    });

    // Identical request from same origin
    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://zoom.us',
      permission: 'camera',
      onResolve: (d) => resolutions.push(`call2:${d}`),
    });

    // Queue size should still be 1
    const wcQueue = queue.queuesByWebContents.get(mockWc1.id);
    assert.equal(wcQueue.length, 1);

    const [promptId] = queue.activePrompts.keys();
    queue.resolvePrompt(promptId, 'allow');

    // Both callbacks were triggered with the decision
    assert.deepEqual(resolutions, ['call1:allow', 'call2:allow']);
  });

  test('cancels all pending requests on webContents navigation', () => {
    const resolutions = [];

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://site-a.com',
      permission: 'camera',
      onResolve: (d) => resolutions.push(`req1:${d}`),
    });

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://site-a.com',
      permission: 'microphone',
      onResolve: (d) => resolutions.push(`req2:${d}`),
    });

    // Simulate navigation event
    mockWc1.emit('did-start-navigation');

    assert.deepEqual(resolutions, ['req1:deny', 'req2:deny']);
    assert.equal(queue.activePrompts.size, 0);
    assert.equal(queue.queuesByWebContents.has(mockWc1.id), false);
  });

  test('cancels all pending requests when webContents is destroyed', () => {
    let resolved = null;

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://site.com',
      permission: 'geolocation',
      onResolve: (d) => {
        resolved = d;
      },
    });

    mockWc1.destroy();

    assert.equal(resolved, 'deny');
    assert.equal(queue.activePrompts.size, 0);
  });

  test('isolates queues across multiple distinct webContents', () => {
    let wc1Resolved = null;
    let wc2Resolved = null;

    queue.enqueue({
      webContents: mockWc1,
      origin: 'https://site1.com',
      permission: 'camera',
      onResolve: (d) => { wc1Resolved = d; },
    });

    queue.enqueue({
      webContents: mockWc2,
      origin: 'https://site2.com',
      permission: 'camera',
      onResolve: (d) => { wc2Resolved = d; },
    });

    // Both have active prompts because they belong to different tabs/webContents
    assert.equal(queue.activePrompts.size, 2);

    // Cancel only wc1
    queue.cancelAllForWebContents(mockWc1.id);
    assert.equal(wc1Resolved, 'deny');
    assert.equal(wc2Resolved, null); // wc2 untouched
    assert.equal(queue.activePrompts.size, 1);
  });
});
