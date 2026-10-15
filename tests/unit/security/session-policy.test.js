'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCookieConfig,
  compileCookieConfig,
  shouldBlockCookieForHost,
  cookiePatternMatchesHost,
  getRegisterableDomain,
} = require('../../../runtime/sessionPolicy');
const { getBrowserIdentity } = require('../../../runtime/browserIdentity');

describe('Session Policy & Anti-Tracking Security', () => {
  describe('normalizeCookieConfig', () => {
    test('normalizes global policy and validates exception rules', () => {
      const config = {
        globalPolicy: 'block_third_party',
        exceptions: [
          { pattern: ' [*.]example.com ', setting: 'allow' },
          { pattern: 'tracker.net', setting: 'block' },
          { pattern: 'invalid', setting: 'not-a-setting' }, // should be filtered
        ],
      };

      const normalized = normalizeCookieConfig(config);
      assert.equal(normalized.globalPolicy, 'block_third_party');
      assert.equal(normalized.exceptions.length, 2);
      assert.equal(normalized.exceptions[0].pattern, '[*.]example.com');
      assert.equal(normalized.exceptions[0].setting, 'allow');
    });

    test('falls back to allow for unknown global policy', () => {
      assert.equal(normalizeCookieConfig({ globalPolicy: 'unknown' }).globalPolicy, 'allow');
      assert.equal(normalizeCookieConfig(null).globalPolicy, 'allow');
    });
  });

  describe('cookiePatternMatchesHost & patternToRegExp', () => {
    test('matches exact host and wildcards correctly', () => {
      assert.equal(cookiePatternMatchesHost('example.com', 'example.com'), true);
      assert.equal(cookiePatternMatchesHost('*.example.com', 'sub.example.com'), true);
      assert.equal(cookiePatternMatchesHost('*.example.com', 'deep.sub.example.com'), true);
      assert.equal(cookiePatternMatchesHost('*.example.com', 'notexample.com'), false);
      assert.equal(cookiePatternMatchesHost('example.com', 'other.com'), false);
    });
  });

  describe('shouldBlockCookieForHost', () => {
    const policy = compileCookieConfig({
      globalPolicy: 'block_third_party',
      exceptions: [
        { pattern: 'allowed-tracker.com', setting: 'allow' },
        { pattern: 'blocked-cdn.com', setting: 'block' },
      ],
    });

    test('blocks when host matches an explicit block rule', () => {
      assert.equal(shouldBlockCookieForHost('blocked-cdn.com', policy), true);
    });

    test('allows when host matches an explicit allow rule even if third-party', () => {
      assert.equal(
        shouldBlockCookieForHost('allowed-tracker.com', policy, { isThirdParty: true }),
        false
      );
    });

    test('blocks third-party cookies when globalPolicy is block_third_party', () => {
      assert.equal(
        shouldBlockCookieForHost('random-ad.org', policy, { isThirdParty: true }),
        true
      );
      assert.equal(
        shouldBlockCookieForHost('first-party.org', policy, { isThirdParty: false }),
        false
      );
    });

    test('blocks all cookies when globalPolicy is block_all', () => {
      const blockAllPolicy = compileCookieConfig({ globalPolicy: 'block_all' });
      assert.equal(shouldBlockCookieForHost('any-site.com', blockAllPolicy), true);
    });
  });

  describe('getRegisterableDomain', () => {
    test('extracts top-level registrable domain for standard TLDs', () => {
      assert.equal(getRegisterableDomain('sub.example.com'), 'example.com');
      assert.equal(getRegisterableDomain('a.b.c.example.com'), 'example.com');
      assert.equal(getRegisterableDomain('localhost'), 'localhost');
    });

    test('handles two-letter second-level TLDs (co.uk, com.au, etc.)', () => {
      assert.equal(getRegisterableDomain('shop.bbc.co.uk'), 'bbc.co.uk');
      assert.equal(getRegisterableDomain('portal.gov.in'), 'portal.gov.in');
    });
  });

  describe('getBrowserIdentity', () => {
    test('provides realistic Chrome User-Agent and Accept-Language', () => {
      const identity = getBrowserIdentity();
      assert.ok(identity.userAgent);
      assert.ok(identity.userAgent.includes('Mozilla/5.0'));
      assert.ok(identity.userAgent.includes('Chrome/'));
      assert.ok(identity.userAgent.includes('Safari/'));
      assert.ok(identity.acceptLanguage);
    });
  });
});
