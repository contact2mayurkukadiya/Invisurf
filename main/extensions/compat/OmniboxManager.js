const { EventEmitter } = require('events');
const crypto = require('crypto');

function stripXmlMarkup(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]+>/g, '');
}

/**
 * OmniboxManager
 * Implements chrome.omnibox:
 * Manages keyword registration, query routing, suggestion collection, and user selection.
 */
class OmniboxManager extends EventEmitter {
    constructor() {
        super();
        /** Map of keyword (lowercase) -> { extensionId, keyword, name, iconDataUrl } */
        this.keywords = new Map();
        /** Map of extensionId -> keyword (lowercase) */
        this.extensionKeywords = new Map();
        /** Map of extensionId -> defaultSuggestion object { description: string } */
        this.defaultSuggestions = new Map();
        /** Set of active extensionId sessions where inputStarted has fired */
        this.activeSessions = new Set();
        /** Map of suggestCallbackId -> { resolve, timer } */
        this.pendingQueries = new Map();
    }

    /**
     * Registers a keyword for an extension from its manifest.json ("omnibox": { "keyword": "..." }).
     */
    registerKeyword(extensionId, keyword, name = '', iconDataUrl = null) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const cleanKw = String(keyword || '').trim().toLowerCase();
        if (!cleanId || !cleanKw) return;

        this.keywords.set(cleanKw, {
            extensionId: cleanId,
            keyword: cleanKw,
            name: name || cleanKw,
            iconDataUrl: iconDataUrl || null,
        });
        this.extensionKeywords.set(cleanId, cleanKw);
    }

    unregisterKeyword(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const kw = this.extensionKeywords.get(cleanId);
        if (kw) {
            this.keywords.delete(kw);
            this.extensionKeywords.delete(cleanId);
        }
        this.defaultSuggestions.delete(cleanId);
        this.activeSessions.delete(cleanId);
    }

    setDefaultSuggestion(extensionId, details = {}) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        this.defaultSuggestions.set(cleanId, details);
        return true;
    }

    getDefaultSuggestion(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        return this.defaultSuggestions.get(cleanId) || null;
    }

    /**
     * Parses input text to see if it matches any registered extension keyword.
     * Matches format: "<keyword> " or "<keyword> <query>"
     */
    findKeywordMatch(inputText) {
        const trimmed = String(inputText || '').trimStart();
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) return null;

        const candidateKeyword = trimmed.slice(0, spaceIdx).toLowerCase();
        const queryText = trimmed.slice(spaceIdx + 1);

        const match = this.keywords.get(candidateKeyword);
        if (!match) return null;

        return {
            ...match,
            queryText,
        };
    }

    /**
     * Queries the extension for suggestions.
     * Returns an array of suggestions formatted for InviSurf's omnibox autocomplete dropdown.
     */
    async query(inputText) {
        const match = this.findKeywordMatch(inputText);
        if (!match) {
            // If user cleared or switched away from an active session, notify cancelled
            if (this.activeSessions.size > 0) {
                this.inputCancelled();
            }
            return [];
        }

        const { extensionId, queryText, name, keyword, iconDataUrl } = match;

        // 1. Emit onInputStarted if not already active in this session
        if (!this.activeSessions.has(extensionId)) {
            this.activeSessions.add(extensionId);
            this.emit('omnibox-input-started', { extensionId });
        }

        const outSuggestions = [];

        // 2. Prepare default suggestion if extension set one
        const defaultDef = this.defaultSuggestions.get(extensionId);
        let defaultDesc = `Search ${name} for "${queryText || '...'}"`;
        if (defaultDef && typeof defaultDef.description === 'string') {
            defaultDesc = defaultDef.description.replace(/%s/g, queryText || '');
        }

        outSuggestions.push({
            text: `${name}: ${queryText}`,
            url: queryText,
            type: 'extension',
            score: 995,
            description: stripXmlMarkup(defaultDesc),
            rawDescription: defaultDesc,
            favicon: iconDataUrl,
            extensionId,
            isDefault: true,
        });

        // If queryText is empty, return default suggestion immediately
        if (!queryText.trim()) {
            return outSuggestions;
        }

        // 3. Request dynamic suggestions via onInputChanged
        const suggestCallbackId = crypto.randomUUID();
        const dynamicSuggestionsPromise = new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingQueries.delete(suggestCallbackId);
                resolve([]);
            }, 650); // 650ms timeout for async extension reply

            this.pendingQueries.set(suggestCallbackId, { resolve, timer });
        });

        this.emit('omnibox-input-changed', {
            extensionId,
            text: queryText,
            suggestCallbackId,
        });

        try {
            const rawItems = await dynamicSuggestionsPromise;
            if (Array.isArray(rawItems)) {
                rawItems.slice(0, 7).forEach((item, idx) => {
                    if (!item) return;
                    const content = String(item.content || '').trim();
                    const desc = item.description ? stripXmlMarkup(String(item.description)) : content;
                    outSuggestions.push({
                        text: content || queryText,
                        url: content || queryText,
                        type: 'extension',
                        score: 990 - idx,
                        description: desc,
                        favicon: iconDataUrl,
                        extensionId,
                        isDefault: false,
                    });
                });
            }
        } catch (_) {}

        return outSuggestions;
    }

    /**
     * Resolves pending suggestion query when extension calls the suggest callback.
     */
    receiveSuggestions(suggestCallbackId, suggestions = []) {
        if (!suggestCallbackId || !this.pendingQueries.has(suggestCallbackId)) return false;
        const pending = this.pendingQueries.get(suggestCallbackId);
        this.pendingQueries.delete(suggestCallbackId);
        clearTimeout(pending.timer);
        pending.resolve(Array.isArray(suggestions) ? suggestions : []);
        return true;
    }

    /**
     * Called when the user picks/enters an extension suggestion.
     */
    inputEntered(extensionId, text, disposition = 'currentTab') {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        if (cleanId) {
            this.emit('omnibox-input-entered', {
                extensionId: cleanId,
                text: String(text || ''),
                disposition,
            });
            this.activeSessions.delete(cleanId);
        }
        return true;
    }

    /**
     * Called when the user cancels/escapes the omnibox query.
     */
    inputCancelled(extensionId = null) {
        if (extensionId) {
            const cleanId = String(extensionId).trim().toLowerCase();
            this.emit('omnibox-input-cancelled', { extensionId: cleanId });
            this.activeSessions.delete(cleanId);
        } else {
            for (const activeId of this.activeSessions) {
                this.emit('omnibox-input-cancelled', { extensionId: activeId });
            }
            this.activeSessions.clear();
        }
        return true;
    }
}

let instance = null;
function getOmniboxManager() {
    if (!instance) instance = new OmniboxManager();
    return instance;
}

module.exports = {
    OmniboxManager,
    getOmniboxManager,
};
