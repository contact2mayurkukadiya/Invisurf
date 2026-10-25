'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const bookmarkService = require('../../../main/services/bookmarkService');

describe('BookmarkService', () => {
  after(() => {
    env.cleanup();
  });

  const profileId = 'test-profile-1';

  test('returns empty default bookmarks when file does not exist', () => {
    const data = bookmarkService.loadBookmarks('non-existent-profile');
    assert.deepEqual(data, { bar: [] });
  });

  test('saves and loads encrypted bookmarks correctly', () => {
    const initial = {
      bar: [
        { id: 'b1', type: 'bookmark', title: 'Google', url: 'https://google.com' },
        {
          id: 'f1',
          type: 'folder',
          title: 'Dev',
          children: [
            { id: 'b2', type: 'bookmark', title: 'GitHub', url: 'https://github.com' },
          ],
        },
      ],
      other: [],
      mobile: [],
    };

    bookmarkService.saveBookmarks(profileId, initial);
    const loaded = bookmarkService.loadBookmarks(profileId);

    assert.equal(loaded.bar.length, 2);
    assert.equal(loaded.bar[0].title, 'Google');
    assert.equal(loaded.bar[1].children[0].title, 'GitHub');
  });

  test('supports legacy plaintext bookmarks format', () => {
    const legacyPath = bookmarkService.getBookmarksPath('legacy-profile');
    const legacyData = { bar: [{ id: 'leg-1', title: 'Legacy Site', url: 'https://legacy.org' }] };
    fs.writeFileSync(legacyPath, JSON.stringify(legacyData), 'utf-8');

    const loaded = bookmarkService.loadBookmarks('legacy-profile');
    assert.equal(loaded.bar[0].title, 'Legacy Site');
  });

  test('getFolderItems returns paginated results', () => {
    const manyBookmarks = Array.from({ length: 15 }, (_, i) => ({
      id: `item-${i}`,
      title: `Site ${i}`,
      url: `https://site${i}.com`,
    }));

    bookmarkService.saveBookmarks(profileId, { bar: manyBookmarks });

    // Page 1: limit 10
    const page1 = bookmarkService.getFolderItems(profileId, '1', 10, 0);
    assert.equal(page1.items.length, 10);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextCursor, 10);

    // Page 2: limit 10 from cursor 10
    const page2 = bookmarkService.getFolderItems(profileId, '1', 10, page1.nextCursor);
    assert.equal(page2.items.length, 5);
    assert.equal(page2.hasMore, false);
    assert.equal(page2.nextCursor, null);
  });

  test('searches bookmarks by title or URL across folders with pagination', () => {
    const data = {
      bar: [
        { id: 's1', title: 'Playwright Documentation', url: 'https://playwright.dev' },
        {
          id: 'f-search',
          title: 'Work',
          children: [
            { id: 's2', title: 'Electron Docs', url: 'https://electronjs.org' },
            { id: 's3', title: 'Playwright Github', url: 'https://github.com/microsoft/playwright' },
          ],
        },
      ],
    };

    bookmarkService.saveBookmarks(profileId, data);

    const results = bookmarkService.searchBookmarks(profileId, 'playwright');
    assert.equal(results.items.length, 2);
    assert.ok(results.items.some((i) => i.id === 's1'));
    assert.ok(results.items.some((i) => i.id === 's3'));
  });

  test('updates bookmark title and url', () => {
    const updated = bookmarkService.updateBookmark(profileId, {
      id: 's1',
      title: 'Playwright Official Site',
      url: 'https://playwright.dev/docs',
    });

    assert.equal(updated, true);
    const loaded = bookmarkService.loadBookmarks(profileId);
    const item = loaded.bar.find((b) => b.id === 's1');
    assert.equal(item.title, 'Playwright Official Site');
    assert.equal(item.url, 'https://playwright.dev/docs');

    // Updating non-existent id
    assert.equal(bookmarkService.updateBookmark(profileId, { id: 'non-existent' }), false);
  });

  test('deletes bookmarks by IDs across nested folders', () => {
    const deleted = bookmarkService.deleteBookmarks(profileId, ['s1', 's2']);
    assert.equal(deleted, true);

    const loaded = bookmarkService.loadBookmarks(profileId);
    assert.equal(loaded.bar.some((b) => b.id === 's1'), false);
    const workFolder = loaded.bar.find((b) => b.id === 'f-search');
    assert.equal(workFolder.children.some((b) => b.id === 's2'), false);

    // Empty list returns false
    assert.equal(bookmarkService.deleteBookmarks(profileId, []), false);
  });

  test('broadcastBookmarks notifies both window webContents and open tab views', () => {
    const State = require('../../../main/state');
    const sentMessages = [];
    const mockWindow = {
      webContents: {
        isDestroyed: () => false,
        send: (channel) => sentMessages.push({ target: 'window', channel }),
      },
    };
    const mockTab = {
      webContents: {
        isDestroyed: () => false,
        send: (channel) => sentMessages.push({ target: 'tab', channel }),
      },
    };

    State.windowContextsById.set(999, {
      profileId,
      window: mockWindow,
      tabs: { 'tab-1': mockTab },
    });

    try {
      bookmarkService.broadcastBookmarks(profileId);
      assert.equal(sentMessages.length, 2);
      assert.deepEqual(sentMessages[0], { target: 'window', channel: 'bookmarks:updated' });
      assert.deepEqual(sentMessages[1], { target: 'tab', channel: 'bookmarks:updated' });
    } finally {
      State.windowContextsById.delete(999);
    }
  });
});
