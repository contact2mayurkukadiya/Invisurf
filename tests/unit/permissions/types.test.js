'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOrigin,
  isValidPermission,
  isValidState,
  PERMISSION_NAMES,
  PERMISSION_STATES,
  PERMISSION_METADATA,
} = require('../../../main/permissions/types');

describe('Permission Types & Origin Normalization', () => {
  describe('normalizeOrigin', () => {
    test('normalizes standard https origin', () => {
      assert.equal(normalizeOrigin('https://example.com/path?query=1'), 'https://example.com');
    });

    test('normalizes standard http origin with port', () => {
      assert.equal(normalizeOrigin('http://localhost:8080/app'), 'http://localhost:8080');
    });

    test('prepends https:// when no protocol scheme is given', () => {
      assert.equal(normalizeOrigin('invisurf.com'), 'https://invisurf.com');
      assert.equal(normalizeOrigin('localhost:3000'), 'https://localhost:3000');
    });

    test('normalizes uppercase letters in origin to lowercase', () => {
      assert.equal(normalizeOrigin('HTTPS://EXAMPLE.COM:443/'), 'https://example.com');
      assert.equal(normalizeOrigin('HTTP://MY-SERVER.ORG/PAGE'), 'http://my-server.org');
    });

    test('handles edge cases: null, undefined, empty, invalid strings', () => {
      assert.equal(normalizeOrigin(null), '');
      assert.equal(normalizeOrigin(undefined), '');
      assert.equal(normalizeOrigin(''), '');
      assert.equal(normalizeOrigin('   '), '');
      assert.equal(normalizeOrigin('null'), '');
      assert.equal(normalizeOrigin(12345), '');
      assert.equal(normalizeOrigin({}), '');
    });

    test('handles custom app and file schemes', () => {
      const fileOrigin = normalizeOrigin('file:///Users/mayurkukadiya/index.html');
      assert.ok(fileOrigin === 'file://' || fileOrigin.startsWith('file://'));
    });
  });

  describe('isValidPermission', () => {
    test('returns true for all registered permission names', () => {
      for (const perm of PERMISSION_NAMES) {
        assert.equal(isValidPermission(perm), true, `Expected ${perm} to be valid`);
      }
    });

    test('returns false for unknown or invalid permission names', () => {
      assert.equal(isValidPermission('unsupported-sensor'), false);
      assert.equal(isValidPermission(''), false);
      assert.equal(isValidPermission(null), false);
      assert.equal(isValidPermission(undefined), false);
      assert.equal(isValidPermission(123), false);
      assert.equal(isValidPermission({}), false);
    });
  });

  describe('isValidState', () => {
    test('returns true for all registered permission states', () => {
      for (const state of PERMISSION_STATES) {
        assert.equal(isValidState(state), true, `Expected ${state} to be valid`);
      }
    });

    test('returns false for unknown permission states', () => {
      assert.equal(isValidState('granted'), false); // W3C state, not InviSurf internal
      assert.equal(isValidState('blocked'), false);
      assert.equal(isValidState(''), false);
      assert.equal(isValidState(null), false);
      assert.equal(isValidState(undefined), false);
    });
  });

  describe('PERMISSION_METADATA', () => {
    test('provides human-readable labels and descriptions for core permissions', () => {
      assert.ok(PERMISSION_METADATA.camera.label);
      assert.ok(PERMISSION_METADATA.microphone.label);
      assert.ok(PERMISSION_METADATA.geolocation.label);
      assert.ok(PERMISSION_METADATA.notifications.label);
      assert.equal(PERMISSION_METADATA.camera.category, 'hardware');
      assert.equal(PERMISSION_METADATA.geolocation.category, 'privacy');
    });

    test('metadata is immutable / frozen', () => {
      assert.ok(Object.isFrozen(PERMISSION_METADATA));
      assert.throws(() => {
        PERMISSION_METADATA.newProperty = 'test';
      });
    });
  });
});
