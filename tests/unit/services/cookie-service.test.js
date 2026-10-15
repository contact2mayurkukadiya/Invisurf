const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const cookieService = require('../../../main/services/cookieService');

describe('CookieService', () => {
  after(() => {
    env.cleanup();
  });

  describe('partition and domain utilities', () => {
    test('getProfilePartition generates partitioned storage strings', () => {
      assert.equal(cookieService.getProfilePartition('work'), 'persist:profile-work');
      assert.equal(cookieService.getProfilePartition('test-profile_1'), 'persist:profile-test-profile_1');
      assert.equal(cookieService.getProfilePartition(null), null);
      assert.equal(cookieService.getProfilePartition(''), null);
    });

    test('cookieDomainToHost cleans leading periods and whitespace', () => {
      assert.equal(cookieService.cookieDomainToHost('.Google.Com'), 'google.com');
      assert.equal(cookieService.cookieDomainToHost('  GITHUB.COM  '), 'github.com');
      assert.equal(cookieService.cookieDomainToHost('...sub.example.org'), 'sub.example.org');
      assert.equal(cookieService.cookieDomainToHost(''), '');
      assert.equal(cookieService.cookieDomainToHost(null), '');
    });

    test('cookieMatchesDomain handles exact and subdomain matches', () => {
      const cookie = { domain: '.github.com' };
      assert.equal(cookieService.cookieMatchesDomain(cookie, 'github.com'), true);
      assert.equal(cookieService.cookieMatchesDomain(cookie, 'api.github.com'), true);
      assert.equal(cookieService.cookieMatchesDomain({ domain: 'api.github.com' }, 'github.com'), true);
      assert.equal(cookieService.cookieMatchesDomain(cookie, 'gitlab.com'), false);
      assert.equal(cookieService.cookieMatchesDomain(null, 'github.com'), false);
      assert.equal(cookieService.cookieMatchesDomain(cookie, null), false);
    });

    test('cookieUrlForRemoval constructs appropriate protocol and paths', () => {
      const secureCookie = {
        name: 'session_id',
        domain: '.secure.bank.com',
        path: '/dashboard',
        secure: true,
      };
      assert.equal(cookieService.cookieUrlForRemoval(secureCookie), 'https://secure.bank.com/dashboard');

      const insecureCookie = {
        name: 'tracking_id',
        domain: 'blog.com',
        path: 'posts',
        secure: false,
      };
      assert.equal(cookieService.cookieUrlForRemoval(insecureCookie), 'http://blog.com/posts');
    });

    test('cookieStoreKey creates unique identifier per host, path, and name', () => {
      const c1 = { domain: 'example.com', path: '/', name: 'token' };
      const c2 = { domain: '.example.com', path: '/', name: 'token' };
      const c3 = { domain: 'example.com', path: '/app', name: 'token' };

      assert.equal(cookieService.cookieStoreKey(c1), cookieService.cookieStoreKey(c2));
      assert.notEqual(cookieService.cookieStoreKey(c1), cookieService.cookieStoreKey(c3));
    });

    test('normalizeSinceTimestamp parses valid positive timestamps', () => {
      assert.equal(cookieService.normalizeSinceTimestamp(1700000000000), 1700000000000);
      assert.equal(cookieService.normalizeSinceTimestamp('1700000000000'), 1700000000000);
      assert.equal(cookieService.normalizeSinceTimestamp(0), null);
      assert.equal(cookieService.normalizeSinceTimestamp(-500), null);
      assert.equal(cookieService.normalizeSinceTimestamp('invalid'), null);
      assert.equal(cookieService.normalizeSinceTimestamp(null), null);
    });
  });

  describe('cookie modification tracking in State', () => {
    test('tracks and forgets cookie timestamps per session', () => {
      const mockSession = {};
      const cookie = { domain: 'site.com', path: '/', name: 'sid' };

      const map = cookieService.getCookieModifiedAtMap(mockSession);
      assert.ok(map instanceof Map);

      map.set(cookieService.cookieStoreKey(cookie), 123456789);
      assert.equal(cookieService.getCookieModifiedAt(mockSession, cookie), 123456789);

      cookieService.forgetCookieModifiedAt(mockSession, cookie);
      assert.equal(cookieService.getCookieModifiedAt(mockSession, cookie), 0);
    });
  });
});
