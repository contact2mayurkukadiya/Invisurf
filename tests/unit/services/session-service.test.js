'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const State = require('../../../main/state');
const sessionService = require('../../../main/services/sessionService');
const { MAX_RECENTLY_CLOSED_TABS } = require('../../../main/constants/defaults');

describe('SessionService & Recently Closed Tabs', () => {
  after(() => {
    env.cleanup();
  });

  beforeEach(() => {
    State.recentlyClosedTabsByProfile.clear();
  });

  describe('truncateMenuLabel', () => {
    test('truncates strings exceeding maxLength with an ellipsis', () => {
      assert.equal(sessionService.truncateMenuLabel('Short string', 20), 'Short string');
      assert.equal(sessionService.truncateMenuLabel('A very long page title that exceeds the limit', 15), 'A very long pa…');
      assert.equal(sessionService.truncateMenuLabel('', 10), '');
      assert.equal(sessionService.truncateMenuLabel(null, 10), '');
    });
  });

  describe('recentlyClosedEntryLabel and Tooltip', () => {
    test('formats single tab labels and tooltips', () => {
      const tabEntry = {
        type: 'tab',
        title: 'GitHub - invisurf/invisurf',
        url: 'https://github.com/invisurf/invisurf',
      };

      assert.equal(sessionService.recentlyClosedEntryLabel(tabEntry), 'GitHub - invisurf/invisurf');
      assert.equal(sessionService.recentlyClosedEntryTooltip(tabEntry), 'https://github.com/invisurf/invisurf');
    });

    test('formats multi-tab window labels and tooltips', () => {
      const windowEntry = {
        type: 'window',
        tabs: [
          { url: 'https://site-a.com', title: 'Site A' },
          { url: 'https://site-b.com', title: 'Site B' },
        ],
      };

      assert.equal(sessionService.recentlyClosedEntryLabel(windowEntry), 'Window (2 tabs)');
      assert.equal(
        sessionService.recentlyClosedEntryTooltip(windowEntry),
        'https://site-a.com\nhttps://site-b.com',
      );
    });

    test('formats ghost window labels and tooltips', () => {
      const ghostEntry = {
        type: 'window',
        ghostWindow: true,
        tabs: [
          { url: 'https://docs.google.com', title: 'Secret Doc' },
        ],
      };

      assert.equal(sessionService.recentlyClosedEntryLabel(ghostEntry), 'Ghost: Secret Doc');
      assert.equal(
        sessionService.recentlyClosedEntryTooltip(ghostEntry),
        '[Ghost Window]\nhttps://docs.google.com',
      );
    });
  });

  describe('pushRecentlyClosedEntry stack management', () => {
    test('pushes entries and limits to MAX_RECENTLY_CLOSED_TABS', () => {
      const profileId = 'prof-closed-1';

      for (let i = 1; i <= MAX_RECENTLY_CLOSED_TABS + 5; i++) {
        sessionService.pushRecentlyClosedEntry(profileId, {
          type: 'tab',
          url: `https://example.com/page-${i}`,
          title: `Page ${i}`,
        });
      }

      const stack = sessionService.getOrCreateRecentlyClosedForProfile(profileId);
      assert.equal(stack.length, MAX_RECENTLY_CLOSED_TABS);
      // Most recent should be at the top
      assert.equal(stack[0].url, `https://example.com/page-${MAX_RECENTLY_CLOSED_TABS + 5}`);
    });

    test('rejects non-storable URLs', () => {
      const profileId = 'prof-closed-2';

      sessionService.pushRecentlyClosedEntry(profileId, {
        type: 'tab',
        url: 'data:text/html,<h1>Hello</h1>',
        title: 'Data URL',
      });

      const stack = sessionService.getOrCreateRecentlyClosedForProfile(profileId);
      assert.equal(stack.length, 0);
    });
  });

  describe('buildRecentlyClosedMenuItems', () => {
    test('returns disabled item when stack is empty', () => {
      State.defaultProfileId = 'default';
      const items = sessionService.buildRecentlyClosedMenuItems();
      assert.equal(items.length, 1);
      assert.equal(items[0].label, 'No recently closed tabs');
      assert.equal(items[0].enabled, false);
    });

    test('returns mapped menu items when recently closed tabs exist', () => {
      State.defaultProfileId = 'default';
      sessionService.pushRecentlyClosedEntry('default', {
        type: 'tab',
        url: 'https://electronjs.org',
        title: 'Electron App',
      });

      const items = sessionService.buildRecentlyClosedMenuItems();
      assert.equal(items.length, 1);
      assert.equal(items[0].label, 'Electron App');
      assert.equal(items[0].toolTip, 'https://electronjs.org');
      assert.ok(typeof items[0].click === 'function');
    });
  });
});
