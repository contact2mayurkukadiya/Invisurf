'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ghostNative = require('../../../main/native/index');

describe('Ghost Native Mode Router', () => {
  test('applyGhostMode returns false for null or undefined window', () => {
    assert.equal(ghostNative.applyGhostMode(null), false);
    assert.equal(ghostNative.applyGhostMode(undefined), false);
  });

  test('applyGhostMode returns false for destroyed window', () => {
    const mockWindow = {
      isDestroyed: () => true,
      getNativeWindowHandle: () => Buffer.alloc(8),
    };
    assert.equal(ghostNative.applyGhostMode(mockWindow), false);
  });

  test('applyGhostMode catches exceptions in getNativeWindowHandle gracefully', () => {
    const mockWindow = {
      isDestroyed: () => false,
      getNativeWindowHandle: () => {
        throw new Error('Native handle failure');
      },
    };
    assert.equal(ghostNative.applyGhostMode(mockWindow), false);
  });

  test('hookWindowChildren returns false for destroyed window or null', () => {
    assert.equal(ghostNative.hookWindowChildren(null), false);
    assert.equal(ghostNative.hookWindowChildren({ isDestroyed: () => true }), false);
  });

  test('setClickThrough returns false for null or destroyed window', () => {
    assert.equal(ghostNative.setClickThrough(null, true), false);
    assert.equal(ghostNative.setClickThrough({ isDestroyed: () => true }, true), false);
  });
});
