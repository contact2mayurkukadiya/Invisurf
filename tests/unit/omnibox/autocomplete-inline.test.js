'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('AutocompleteController Inline Autocomplete & Suggestions', () => {
  let AutocompleteController;

  test('loads AutocompleteController module', async () => {
    const mod = await import('../../../src/components/omnibox/AutocompleteController.js');
    AutocompleteController = mod.default;
    assert.ok(AutocompleteController);
  });

  test('matches domain prefix and returns inline autocomplete info', () => {
    const ctrl = new AutocompleteController();

    const topSuggestion = {
      text: 'Inbox - mayurkukadiya0@gmail.com - Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
      type: 'history',
      score: 850,
      description: 'mail.google.com/mail/u/0/#inbox',
    };

    const inlineInfo = ctrl._getInlineAutocomplete('ma', topSuggestion);
    assert.ok(inlineInfo !== null);
    assert.equal(inlineInfo.completedText, 'mail.google.com');
    assert.equal(inlineInfo.selectionStart, 2);
    assert.equal(inlineInfo.selectionEnd, 15);
    assert.equal(inlineInfo.ghostSuffix, 'il.google.com');
  });

  test('matches photoadking domain prefix for "photo"', () => {
    const ctrl = new AutocompleteController();

    const topSuggestion = {
      text: 'Free Online Graphic Design Maker - PhotoADKing',
      url: 'https://photoadking.com/templates/youtube-intro-maker/',
      type: 'history',
      score: 900,
      description: 'photoadking.com/templates/youtube-intro-maker',
    };

    const inlineInfo = ctrl._getInlineAutocomplete('photo', topSuggestion);
    assert.ok(inlineInfo !== null);
    assert.equal(inlineInfo.completedText, 'photoadking.com');
    assert.equal(inlineInfo.selectionStart, 5);
    assert.equal(inlineInfo.selectionEnd, 15);
    assert.equal(inlineInfo.ghostSuffix, 'adking.com');
  });

  test('matches clean URL path when typing beyond hostname', () => {
    const ctrl = new AutocompleteController();

    const topSuggestion = {
      text: 'Graph Maker - PhotoADKing',
      url: 'https://photoadking.com/graph-maker/',
      type: 'history',
      score: 750,
      description: 'photoadking.com/graph-maker',
    };

    const inlineInfo = ctrl._getInlineAutocomplete('photoadking.com/gr', topSuggestion);
    assert.ok(inlineInfo !== null);
    assert.equal(inlineInfo.completedText, 'photoadking.com/graph-maker');
    assert.equal(inlineInfo.selectionStart, 18);
    assert.equal(inlineInfo.selectionEnd, 27);
    assert.equal(inlineInfo.ghostSuffix, 'aph-maker');
  });

  test('returns null when query does not match prefix', () => {
    const ctrl = new AutocompleteController();

    const topSuggestion = {
      text: 'How to fix AWS S3 CORS errors',
      url: 'https://zyst.io/how-to-fix-aws-s3-cors-errors',
      type: 'history',
      score: 300,
      description: 'zyst.io/how-to-fix-aws-s3-cors-errors',
    };

    // "how" is in title/path, not hostname prefix
    const inlineInfo = ctrl._getInlineAutocomplete('how', topSuggestion);
    assert.equal(inlineInfo, null);
  });

  test('does not treat "h" or arbitrary text as matching https:// scheme prefix', () => {
    const ctrl = new AutocompleteController();

    const topSuggestion = {
      text: 'PhotoADKing Home',
      url: 'https://photoadking.com/',
      type: 'history',
      score: 800,
      description: 'photoadking.com',
    };

    // 'h' should not match https://photoadking.com
    const inlineH = ctrl._getInlineAutocomplete('h', topSuggestion);
    assert.equal(inlineH, null);

    const inlineHow = ctrl._getInlineAutocomplete('how to render threejs scene', topSuggestion);
    assert.equal(inlineHow, null);

    // Only explicit scheme should match raw URL
    const inlineHttps = ctrl._getInlineAutocomplete('https://photo', topSuggestion);
    assert.ok(inlineHttps !== null);
    assert.equal(inlineHttps.completedText, 'https://photoadking.com/');
  });

  test('includes default search item and sorts high-score history above it', async () => {
    const ctrl = new AutocompleteController({ searchEngine: 'google' });

    // Mock history provider to return prefix match
    ctrl._history.getSuggestions = async () => [
      {
        text: 'PhotoADKing Home',
        url: 'https://photoadking.com/',
        type: 'history',
        score: 800,
        description: 'photoadking.com',
      },
    ];

    let lastMerged = [];
    let lastInlineInfo = null;

    await new Promise((resolve) => {
      ctrl.query('photo', (merged, ghostSuffix, inlineInfo) => {
        lastMerged = merged;
        lastInlineInfo = inlineInfo;
        if (merged.length >= 2) resolve();
      });
      // Allow async promises to resolve
      setTimeout(resolve, 50);
    });

    assert.ok(lastMerged.length >= 2);
    // History (score 800) is ranked first
    assert.equal(lastMerged[0].url, 'https://photoadking.com/');
    assert.equal(lastMerged[0].type, 'history');
    // Default search item (score 400) is present
    const searchItem = lastMerged.find((item) => item.type === 'search');
    assert.ok(searchItem);
    assert.equal(searchItem.text, 'photo');
    assert.ok(searchItem.url.includes('google.com/search?q=photo'));

    // Inline info matches top history item
    assert.ok(lastInlineInfo);
    assert.equal(lastInlineInfo.completedText, 'photoadking.com');
  });
});
