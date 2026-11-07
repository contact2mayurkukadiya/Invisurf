import HistoryProvider from './providers/HistoryProvider.js';
import SearchSuggestionsProvider from './providers/SearchSuggestionsProvider.js';
import BookmarkProvider from './providers/BookmarkProvider.js';
import KeywordProvider from './providers/KeywordProvider.js';
import ExtensionOmniboxProvider from './providers/ExtensionOmniboxProvider.js';
import { buildSearchUrl } from './AutocompleteInput.js';
import { OMNIBOX_SUGGESTION } from '../../constants/conditionStrings.js';

const MAX_SUGGESTIONS = 8;

/**
 * AutocompleteController — orchestrates all suggestion providers.
 */
export default class AutocompleteController {
  constructor(options = {}) {
    this._searchEngine = options.searchEngine || 'google';
    this._history = new HistoryProvider();
    this._search = new SearchSuggestionsProvider();
    this._bookmarks = new BookmarkProvider();
    this._keywords = new KeywordProvider();
    this._extension = new ExtensionOmniboxProvider();

    /** @type {Array} */
    this._lockedResults = null;
    /** @type {number} — increments on each new query to discard stale callbacks */
    this._queryId = 0;
  }

  setSearchEngine(engine) {
    if (engine) this._searchEngine = engine;
  }

  /** Prevent async updates from reordering the list while user navigates. */
  lockList() {
    this._locked = true;
  }

  /** Re-enable live updates (call when user resumes typing). */
  unlockList() {
    this._locked = false;
    this._lockedResults = null;
  }

  /**
   * Fan out to all providers, merge progressively, invoke callback on each update.
   *
   * @param {string} inputText
   * @param {function(suggestions: Array, ghostSuffix: string|null, inlineInfo: object|null): void} callback
   */
  query(inputText, callback) {
    const queryId = ++this._queryId;
    this.unlockList();

    const accumulated = [];
    const trimmed = (inputText || '').trim();

    if (trimmed) {
      accumulated.push({
        text: trimmed,
        url: buildSearchUrl(this._searchEngine, trimmed),
        type: 'search',
        score: 400,
        description: `Search with ${this._searchEngine === 'google' ? 'Google' : this._searchEngine}`,
        favicon: null,
      });
    }

    const publish = (newResults) => {
      if (queryId !== this._queryId) return; // superseded
      if (this._locked) return;             // user is navigating, don't reorder

      if (Array.isArray(newResults)) {
        newResults.forEach(r => accumulated.push(r));
      }
      const merged = this._mergeResults(accumulated);
      const inlineInfo = this._getInlineAutocomplete(inputText, merged[0] ?? null);
      callback(merged, null, inlineInfo);
    };

    if (trimmed) {
      publish([]);
    }

    // Fire all providers; history and bookmarks respond quickly
    Promise.all([
      this._history.getSuggestions(inputText).then(publish),
      this._extension.getSuggestions(inputText).then(publish),
      this._keywords.getSuggestions(inputText).then(publish),
      this._bookmarks.getSuggestions(inputText).then(publish),
      this._search.getSuggestions(inputText).then(publish),
    ]).catch(() => {
      // Individual provider errors are caught inside each provider
    });
  }

  /**
   * Deduplicate by URL (keep highest score), sort descending, cap at MAX_SUGGESTIONS.
   * @param {Array} allResults
   * @returns {Array}
   */
  _mergeResults(allResults) {
    const byUrl = new Map();

    for (const suggestion of allResults) {
      if (!suggestion || !suggestion.url) continue;
      const existing = byUrl.get(suggestion.url);
      if (!existing || (suggestion.score || 0) > (existing.score || 0)) {
        byUrl.set(suggestion.url, suggestion);
      }
    }

    return Array.from(byUrl.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Returns inline autocomplete info if the top suggestion extends the current input.
   *
   * @param {string} input
   * @param {object|null} topSuggestion
   * @returns {{ completedText: string, selectionStart: number, selectionEnd: number, ghostSuffix: string }|null}
   */
  _getInlineAutocomplete(input, topSuggestion) {
    if (!topSuggestion || !input) return null;
    if (!OMNIBOX_SUGGESTION.DEFAULT_TYPES.includes(topSuggestion.type)) return null;

    const rawUrl = String(topSuggestion.url || '');
    if (!rawUrl) return null;

    const lowerInput = input.trim().toLowerCase();
    if (!lowerInput) return null;

    let hostname = '';
    try {
      hostname = new URL(rawUrl).hostname.replace(/^www\./i, '');
    } catch (_) {}

    const cleanUrl = rawUrl
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '');

    // 1. Hostname prefix match (e.g., input "photo" matches "photoadking.com", or "ma" matches "mail.google.com")
    if (hostname && hostname.toLowerCase().startsWith(lowerInput) && hostname.length > lowerInput.length) {
      const ghostSuffix = hostname.slice(input.length);
      return {
        completedText: hostname,
        selectionStart: input.length,
        selectionEnd: hostname.length,
        ghostSuffix,
      };
    }

    // 2. Clean URL prefix match (e.g., input "photoadking.com/gr" matches "photoadking.com/graph-maker")
    if (cleanUrl.toLowerCase().startsWith(lowerInput) && cleanUrl.length > lowerInput.length) {
      const ghostSuffix = cleanUrl.slice(input.length);
      return {
        completedText: cleanUrl,
        selectionStart: input.length,
        selectionEnd: cleanUrl.length,
        ghostSuffix,
      };
    }

    // 3. Raw URL prefix match (only if input starts with "http://" or "https://")
    if ((lowerInput.startsWith('http://') || lowerInput.startsWith('https://')) &&
        rawUrl.toLowerCase().startsWith(lowerInput) && rawUrl.length > lowerInput.length) {
      const ghostSuffix = rawUrl.slice(input.length);
      return {
        completedText: rawUrl,
        selectionStart: input.length,
        selectionEnd: rawUrl.length,
        ghostSuffix,
      };
    }

    return null;
  }

  /** Free resources held by async providers. Call on component unmount. */
  dispose() {
    this._queryId = -1;
    this._search.dispose();
  }
}
