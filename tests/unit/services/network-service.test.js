'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const networkService = require('../../../main/services/networkService');

describe('NetworkService', () => {
  after(() => {
    env.cleanup();
  });

  describe('pickResponseHeadersForDiag', () => {
    test('extracts and normalizes target diagnostic response headers', () => {
      const headers = {
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': ['max-age=31536000', 'includeSubDomains'],
        'X-Powered-By': 'Express',
        'Content-Type': 'text/html',
      };

      const picked = networkService.pickResponseHeadersForDiag(headers);

      assert.equal(picked['content-security-policy'], "default-src 'self'");
      assert.equal(picked['x-frame-options'], 'DENY');
      assert.equal(picked['strict-transport-security'], 'max-age=31536000, includeSubDomains');
      assert.equal(picked['x-powered-by'], undefined); // Non-diagnostic header filtered out
      assert.equal(picked['content-type'], undefined);
    });

    test('handles empty or null headers safely', () => {
      assert.deepEqual(networkService.pickResponseHeadersForDiag(null), {});
      assert.deepEqual(networkService.pickResponseHeadersForDiag({}), {});
    });
  });

  describe('getSessionPolicyDeps', () => {
    test('constructs policy dependencies with profile and stealth flags', () => {
      const deps = networkService.getSessionPolicyDeps({
        profileId: 'stealth-user',
        isStealthSession: true,
      });

      assert.equal(deps.profileId, 'stealth-user');
      assert.equal(deps.isStealthSession, true);
      assert.ok(typeof deps.isLikelyTrackingRedirectUrl === 'function');
      assert.ok(typeof deps.getCookieConfig === 'function');
      assert.ok(deps.maxMainFrameRedirects > 0);
      assert.ok(deps.redirectWindowMs > 0);
    });
  });

  describe('clearAppAssetCache', () => {
    test('clears in-memory prewarmed assets without throwing', () => {
      assert.doesNotThrow(() => {
        networkService.clearAppAssetCache();
      });
    });
  });
});
