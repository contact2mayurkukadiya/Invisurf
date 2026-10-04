import BaseProvider from './BaseProvider.js';

/**
 * ExtensionOmniboxProvider
 * Connects InviSurf's omnibox autocomplete to installed Chrome Extensions
 * that define an "omnibox" keyword in their manifest.json and listen to
 * chrome.omnibox.onInputChanged.
 */
export default class ExtensionOmniboxProvider extends BaseProvider {
  async getSuggestions(inputText) {
    const trimmed = (inputText || '').trimStart();
    // Extension omnibox triggers require "<keyword> " (space after keyword)
    if (!trimmed.includes(' ')) return [];
    if (!window.electronAPI?.omniboxExtensionQuery) return [];

    try {
      const results = await window.electronAPI.omniboxExtensionQuery({ text: inputText });
      return Array.isArray(results) ? results : [];
    } catch (err) {
      console.warn('[ExtensionOmniboxProvider] Query error:', err);
      return [];
    }
  }
}
