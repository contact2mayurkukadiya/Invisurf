import { URL as URL_C } from '../constants/conditionStrings.js';

/**
 * Tabs that should show the InvSurf wordmark favicon (theme-aware) instead of a generic globe.
 */
export function isInvsurfBrandedInternalTab(tab) {
  if (!tab) return false;
  if (tab.isNewTab) return true;
  const raw = (tab.url || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === URL_C.NTP_DISPLAY || lower.startsWith(URL_C.NTP_LOCALHOST_PREFIX)) return true;
  if (lower.includes(URL_C.PATH_NEWTAB_HTML)) return true;
  if (lower === URL_C.HISTORY_DISPLAY || lower.startsWith(URL_C.HISTORY_DISPLAY)) return true;
  if (lower === URL_C.BOOKMARK_DISPLAY || lower.startsWith(URL_C.BOOKMARK_DISPLAY)) return true;
  if (lower === URL_C.STEALTH_HISTORY || lower.startsWith(URL_C.STEALTH_HISTORY)) return true;
  if (lower === URL_C.SETTINGS_DISPLAY || lower.startsWith(URL_C.SETTINGS_DISPLAY)) return true;
  if (lower === URL_C.STEALTH_SETTINGS || lower.startsWith(URL_C.STEALTH_SETTINGS)) return true;
  if (lower.includes(URL_C.PATH_HISTORY_HTML)) return true;
  if (lower.includes(URL_C.PATH_BOOKMARK_HTML)) return true;
  if (lower.includes(URL_C.PATH_SETTINGS_HTML)) return true;
  return false;
}

/**
 * Checks whether two URLs correspond to the same internal browser page
 * (e.g. invisurf://bookmark, invisurf://bookmarks, app://localhost/dist/bookmark.html).
 */
export function isSameInternalPage(tabUrl, targetUrl) {
  if (!tabUrl || !targetUrl) return false;
  const t = String(tabUrl).trim().toLowerCase();
  const target = String(targetUrl).trim().toLowerCase();

  if (t === target) return true;

  // History page matching
  const isHistoryTarget =
    target === URL_C.HISTORY_DISPLAY ||
    target === URL_C.STEALTH_HISTORY ||
    target.includes('history.html');
  if (isHistoryTarget) {
    return (
      t === URL_C.HISTORY_DISPLAY ||
      t === URL_C.STEALTH_HISTORY ||
      t === 'chrome://history' ||
      t.includes('history.html')
    );
  }

  // Bookmark page matching
  const isBookmarkTarget =
    target === URL_C.BOOKMARK_DISPLAY ||
    target === 'invisurf://bookmarks' ||
    target === URL_C.STEALTH_BOOKMARK ||
    target === 'stealth://bookmarks' ||
    target.includes('bookmark.html') ||
    target.includes('bookmarks.html');
  if (isBookmarkTarget) {
    return (
      t === URL_C.BOOKMARK_DISPLAY ||
      t === 'invisurf://bookmarks' ||
      t === URL_C.STEALTH_BOOKMARK ||
      t === 'stealth://bookmarks' ||
      t === 'chrome://bookmarks' ||
      t === 'chrome://bookmark' ||
      t.includes('bookmark.html') ||
      t.includes('bookmarks.html')
    );
  }

  // Settings page matching
  const isSettingsTarget =
    target === URL_C.SETTINGS_DISPLAY ||
    target === URL_C.STEALTH_SETTINGS ||
    target.includes('settings.html');
  if (isSettingsTarget) {
    return (
      t === URL_C.SETTINGS_DISPLAY ||
      t === URL_C.STEALTH_SETTINGS ||
      t === 'chrome://settings' ||
      t.includes('settings.html')
    );
  }

  // Downloads page matching
  const isDownloadsTarget =
    target === URL_C.DOWNLOADS_DISPLAY ||
    target === 'invisurf://download' ||
    target === URL_C.STEALTH_DOWNLOADS ||
    target === 'stealth://download' ||
    target.includes('downloads.html');
  if (isDownloadsTarget) {
    return (
      t === URL_C.DOWNLOADS_DISPLAY ||
      t === 'invisurf://download' ||
      t === URL_C.STEALTH_DOWNLOADS ||
      t === 'stealth://download' ||
      t === 'chrome://downloads' ||
      t.includes('downloads.html')
    );
  }

  // Extensions page matching
  const isExtensionsTarget =
    target === URL_C.EXTENSIONS_DISPLAY ||
    target === URL_C.STEALTH_EXTENSIONS ||
    target.includes('extensions.html');
  if (isExtensionsTarget) {
    return (
      t === URL_C.EXTENSIONS_DISPLAY ||
      t === URL_C.STEALTH_EXTENSIONS ||
      t === 'chrome://extensions' ||
      t.includes('extensions.html')
    );
  }

  return false;
}

