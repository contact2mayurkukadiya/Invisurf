import BaseProvider from './BaseProvider.js';

/**
 * BookmarkProvider — stub implementation.
 *
 * To wire in real bookmarks:
 *   1. Call `window.electronAPI.bookmarksGet()` (or equivalent IPC channel)
 *      to retrieve the flat/tree bookmark list.
 *   2. Filter by URL/title match against inputText.
 *   3. Return suggestions with type: 'bookmark', score: 700–800.
 */
export default class BookmarkProvider extends BaseProvider {
  async getSuggestions(inputText) {
    const query = String(inputText || '').trim().toLowerCase();
    if (!query) return [];
    if (!window.electronAPI?.bookmarksGet) return [];

    try {
      const data = await window.electronAPI.bookmarksGet();
      const allBookmarks = [];
      const collect = (items) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (item && item.url) allBookmarks.push(item);
          if (Array.isArray(item?.children)) collect(item.children);
        }
      };
      if (data?.bar) collect(data.bar);
      if (data?.other) collect(data.other);

      const matches = [];
      for (const b of allBookmarks) {
        const urlLower = String(b.url || '').toLowerCase();
        const titleLower = String(b.title || '').toLowerCase();
        if (urlLower.includes(query) || titleLower.includes(query)) {
          let domain = '';
          try { domain = new URL(b.url).hostname; } catch (_) {}
          const cleanUrl = String(b.url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
          const title = (b.title && b.title.trim()) ? b.title.trim() : cleanUrl;
          matches.push({
            text: title,
            url: b.url,
            type: 'bookmark',
            score: urlLower.startsWith(query) ? 750 : 650,
            description: cleanUrl,
            favicon: domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : null,
          });
        }
      }
      return matches.slice(0, 5);
    } catch (err) {
      console.warn('[BookmarkProvider] Query error:', err);
      return [];
    }
  }
}
