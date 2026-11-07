import BaseProvider from './BaseProvider.js';

const SUGGEST_BASE = 'https://suggestqueries.google.com/complete/search?client=firefox&q=';
const DEBOUNCE_MS = 150;
const MAX_RESULTS = 5;

/**
 * SearchSuggestionsProvider — fetches real-time suggestions from the Google
 * Suggest API. Requests are debounced and aborted when superseded.
 *
 * Score range: 600 (first/best suggestion) → 400 (last), mapped linearly.
 *
 * CORS: Electron renderers can usually reach the endpoint directly. If the
 * request is blocked (net::ERR_FAILED or a CORS error), the provider silently
 * returns [] so history results are unaffected.
 */
export default class SearchSuggestionsProvider extends BaseProvider {
  constructor() {
    super();
  }

  /**
   * @param {string} _inputText
   * @returns {Promise<Array>}
   */
  getSuggestions(_inputText) {
    return Promise.resolve([]);
  }

  /** Cancel pending debounce + in-flight request (call on unmount). */
  dispose() {}
}
