'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const navUtils = require('../../../main/utils/navigation');
const C = require('../../../src/constants/conditionStrings.cjs');

describe('Navigation Utils', () => {
  after(() => {
    env.cleanup();
  });

  describe('getHostnameSafe', () => {
    test('extracts hostname safely from valid urls', () => {
      assert.equal(navUtils.getHostnameSafe('https://GitHub.com/user/repo'), 'github.com');
      assert.equal(navUtils.getHostnameSafe('http://sub.Domain.org:8080/path'), 'sub.domain.org');
    });

    test('returns empty string for invalid URLs', () => {
      assert.equal(navUtils.getHostnameSafe('not-a-valid-url'), '');
      assert.equal(navUtils.getHostnameSafe(''), '');
      assert.equal(navUtils.getHostnameSafe(null), '');
    });
  });

  describe('isLikelyTrackingRedirectUrl', () => {
    test('detects tracking redirect markers on recognized domains', () => {
      assert.equal(
        navUtils.isLikelyTrackingRedirectUrl('https://adservice.google.com/page?redirect_url=https://example.com'),
        true,
      );
      assert.equal(
        navUtils.isLikelyTrackingRedirectUrl('https://ad.doubleclick.net/ddm/clk?dest=https://external.com'),
        true,
      );
    });

    test('returns false for ordinary URLs without tracking redirect queries', () => {
      assert.equal(navUtils.isLikelyTrackingRedirectUrl('https://google.com/search?q=playwright'), false);
      assert.equal(navUtils.isLikelyTrackingRedirectUrl('https://example.com/page?id=123'), false);
      assert.equal(navUtils.isLikelyTrackingRedirectUrl('invalid-url'), false);
    });
  });

  describe('classifyNavigationError', () => {
    test('classifies certificate error -201', () => {
      const err = navUtils.classifyNavigationError(-201, 'ERR_CERT_COMMON_NAME_INVALID');
      assert.equal(err.title, 'Secure connection failed');
      assert.ok(err.details.includes('certificate'));
    });

    test('classifies connection refused -102', () => {
      const err = navUtils.classifyNavigationError(-102, 'ERR_CONNECTION_REFUSED');
      assert.equal(err.title, 'Connection refused');
    });

    test('classifies site not found DNS error -105', () => {
      const err = navUtils.classifyNavigationError(-105, 'ERR_NAME_NOT_RESOLVED');
      assert.equal(err.title, 'Site not found');
      assert.ok(err.details.includes('DNS'));
    });

    test('provides generic fallback error', () => {
      const err = navUtils.classifyNavigationError(-999, 'UNKNOWN_ERROR');
      assert.equal(err.title, 'This site cannot be reached');
    });
  });

  describe('isAllowedTabNavigationUrl', () => {
    test('allows standard web protocols', () => {
      assert.equal(navUtils.isAllowedTabNavigationUrl('https://github.com'), true);
      assert.equal(navUtils.isAllowedTabNavigationUrl('http://localhost:3000'), true);
      assert.equal(navUtils.isAllowedTabNavigationUrl('app://dist/newtab.html'), true);
      assert.equal(navUtils.isAllowedTabNavigationUrl('view-source:https://example.com'), true);
    });

    test('rejects unsafe or non-allowed schemes', () => {
      assert.equal(navUtils.isAllowedTabNavigationUrl('javascript:alert(1)'), false);
      assert.equal(navUtils.isAllowedTabNavigationUrl('file:///etc/passwd'), false);
      assert.equal(navUtils.isAllowedTabNavigationUrl('data:text/html,test'), false);
      assert.equal(navUtils.isAllowedTabNavigationUrl(''), false);
      assert.equal(navUtils.isAllowedTabNavigationUrl(null), false);
    });
  });

  describe('internal scheme resolution and display URL', () => {
    test('normalizes stealth and invisurf schemes', () => {
      assert.equal(navUtils.normalizeInternalSchemeUrl('stealth://history'), C.URL.HISTORY_DISPLAY);
      assert.equal(navUtils.normalizeInternalSchemeUrl('invisurf://history'), C.URL.HISTORY_DISPLAY);
      assert.equal(navUtils.normalizeInternalSchemeUrl('stealth://settings'), C.URL.SETTINGS_DISPLAY);
    });

    test('resolves internal URLs to local application assets', () => {
      assert.equal(navUtils.resolveInternalPageUrl('invisurf://history'), C.URL.HISTORY_LOAD);
      assert.equal(navUtils.resolveInternalPageUrl('invisurf://settings'), C.URL.SETTINGS_LOAD);
      assert.equal(navUtils.resolveInternalPageUrl(C.URL.NTP_DISPLAY), C.URL.NTP_CANONICAL_HTML);
    });

    test('toDisplayUrl cleans app asset paths into friendly pseudo-schemes', () => {
      assert.equal(navUtils.toDisplayUrl('app://dist/history.html'), C.URL.HISTORY_DISPLAY);
      assert.equal(navUtils.toDisplayUrl('app://dist/bookmarks.html'), C.URL.BOOKMARK_DISPLAY);
      assert.equal(navUtils.toDisplayUrl('app://dist/settings.html'), C.URL.SETTINGS_DISPLAY);
      assert.equal(navUtils.toDisplayUrl('app://dist/newtab.html'), '');
      assert.equal(navUtils.toDisplayUrl('https://example.com'), 'https://example.com');
      assert.equal(navUtils.toDisplayUrl(null), '');
    });
  });

  describe('isBlankTab and isGoogleLensSearchableUrl', () => {
    test('identifies blank and newtab states for omnibox autofocus', () => {
      assert.equal(navUtils.isBlankTab(''), true);
      assert.equal(navUtils.isBlankTab(C.URL.ABOUT_BLANK), true);
      assert.equal(navUtils.isBlankTab(C.URL.NTP_DISPLAY), true);
      assert.equal(navUtils.isBlankTab('https://github.com'), false);
    });

    test('isGoogleLensSearchableUrl only allows http/https pages', () => {
      assert.equal(navUtils.isGoogleLensSearchableUrl('https://unsplash.com/photos/1'), true);
      assert.equal(navUtils.isGoogleLensSearchableUrl('http://my-blog.org'), true);
      assert.equal(navUtils.isGoogleLensSearchableUrl('invisurf://history'), false);
      assert.equal(navUtils.isGoogleLensSearchableUrl('app://dist/index.html'), false);
      assert.equal(navUtils.isGoogleLensSearchableUrl('about:blank'), false);
      assert.equal(navUtils.isGoogleLensSearchableUrl(null), false);
    });
  });

  describe('transitionFromNavigationSource', () => {
    test('maps sources correctly to transitions', () => {
      assert.equal(navUtils.transitionFromNavigationSource('typed'), C.HISTORY_TRANSITION.TYPED);
      assert.equal(navUtils.transitionFromNavigationSource('search'), C.HISTORY_TRANSITION.TYPED);
      assert.equal(navUtils.transitionFromNavigationSource('bookmark'), C.HISTORY_TRANSITION.BOOKMARK);
      assert.equal(navUtils.transitionFromNavigationSource('link'), C.HISTORY_TRANSITION.LINK);
      assert.equal(navUtils.transitionFromNavigationSource(null), C.HISTORY_TRANSITION.LINK);
    });
  });
});
