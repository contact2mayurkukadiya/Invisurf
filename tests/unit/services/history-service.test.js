'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { HistoryService } = require('../../../historyService');

describe('HistoryService (SQLCipher Encrypted)', () => {
  let tempUserData;
  let historyService;

  beforeEach(() => {
    tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-history-test-'));
    historyService = new HistoryService({ userDataPath: tempUserData });
  });

  afterEach(async () => {
    if (historyService) {
      await historyService.closeAll();
    }
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch (_) {}
  });

  test('records visits and retrieves them via search', async () => {
    const profileId = 'test-prof';

    await historyService.recordVisit(profileId, {
      url: 'https://github.com/microsoft/playwright',
      title: 'GitHub - microsoft/playwright',
      transition: 'LINK',
      tabId: 't1',
    });

    await historyService.recordVisit(profileId, {
      url: 'https://electronjs.org',
      title: 'Electron | Build cross-platform apps',
      transition: 'TYPED',
      tabId: 't2',
    });

    // Search by keyword
    const searchResults = await historyService.search(profileId, { query: 'playwright' });
    assert.equal(searchResults.items.length, 1);
    assert.equal(searchResults.items[0].url, 'https://github.com/microsoft/playwright');
    assert.equal(searchResults.items[0].title, 'GitHub - microsoft/playwright');

    // Search without query returns all
    const allResults = await historyService.search(profileId);
    assert.equal(allResults.items.length, 2);
  });

  test('calculates suggestions and scores based on visit counts and recency', async () => {
    const profileId = 'suggest-prof';

    // Record multiple typed visits
    for (let i = 0; i < 3; i++) {
      await historyService.recordVisit(profileId, {
        url: 'https://invisurf.com/docs',
        title: 'InviSurf Documentation',
        transition: 'TYPED',
        tabId: 't1',
      });
    }

    const suggestions = await historyService.getSuggestions(profileId, { query: 'invisurf' });
    assert.ok(suggestions.length > 0);
    assert.equal(suggestions[0].url, 'https://invisurf.com/docs');
    assert.ok(suggestions[0].score > 0);
  });

  test('ranks and returns top visited sites by domain', async () => {
    const profileId = 'top-prof';

    await historyService.recordVisit(profileId, { url: 'https://site-a.com/page1' });
    await historyService.recordVisit(profileId, { url: 'https://site-a.com/page1' });
    await historyService.recordVisit(profileId, { url: 'https://site-b.com/home' });

    const topSites = await historyService.getTopSites(profileId, 5);
    assert.equal(topSites.length, 2);
    assert.equal(topSites[0].domain, 'site-a.com');
  });

  test('updates titles for existing URLs', async () => {
    const profileId = 'title-prof';

    await historyService.recordVisit(profileId, {
      url: 'https://example.com',
      title: 'Initial Title',
    });

    const updated = await historyService.updateTitle(profileId, 'https://example.com', 'Updated Title');
    assert.equal(updated, true);

    const results = await historyService.search(profileId, { query: 'example.com' });
    assert.equal(results.items[0].title, 'Updated Title');
  });

  test('deletes individual visits and clears history completely', async () => {
    const profileId = 'delete-prof';

    await historyService.recordVisit(profileId, { url: 'https://to-delete.com', title: 'Delete Me' });
    await historyService.recordVisit(profileId, { url: 'https://to-keep.com', title: 'Keep Me' });

    const before = await historyService.search(profileId);
    assert.equal(before.items.length, 2);

    // Delete single visit
    const visitToDelete = before.items.find((i) => i.url === 'https://to-delete.com');
    await historyService.deleteVisits(profileId, [visitToDelete.visitId]);

    const afterDelete = await historyService.search(profileId);
    assert.equal(afterDelete.items.length, 1);
    assert.equal(afterDelete.items[0].url, 'https://to-keep.com');

    // Clear all history
    await historyService.clear(profileId);
    const afterClear = await historyService.search(profileId);
    assert.equal(afterClear.items.length, 0);
  });
});
