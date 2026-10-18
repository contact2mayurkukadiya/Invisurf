const fs = require('fs');
const path = require('path');
const { session } = require('electron');
const ExtensionStorage = require('../ExtensionStorage');
const State = require('../../state');

/**
 * DeclarativeNetRequestManager
 * Implements chrome.declarativeNetRequest for Manifest V3 extensions:
 * - updateDynamicRules
 * - getDynamicRules
 * - updateSessionRules
 * - getSessionRules
 * - updateEnabledRulesets
 * - getEnabledRulesets
 * 
 * Compiles declarative rule conditions into pattern matchers and intercepts
 * requests via Electron session.webRequest.onBeforeRequest.
 */
class DeclarativeNetRequestManager {
    constructor() {
        /**
         * Dynamic rules per extension: Map<extensionId, Map<ruleId, Rule>>
         */
        this.dynamicRules = new Map();

        /**
         * Session rules per extension: Map<extensionId, Map<ruleId, Rule>>
         */
        this.sessionRules = new Map();

        /**
         * Enabled ruleset IDs per extension: Map<extensionId, Set<string>>
         */
        this.enabledRulesets = new Map();

        /**
         * Static rulesets loaded from extension manifests:
         * Map<extensionId, Map<rulesetId, { id: string, enabled: boolean, rules: CompiledRule[] }>>
         */
        this.staticRulesets = new Map();

        /**
         * Attached Electron sessions: WeakSet<Session>
         */
        this.attachedSessions = new WeakSet();

        /**
         * Cached active rules sorted by priority descending: CompiledRule[] | null
         */
        this._activeRulesCache = null;
    }

    _invalidateCache() {
        this._activeRulesCache = null;
    }

    _getActiveRules() {
        if (this._activeRulesCache) {
            return this._activeRulesCache;
        }

        const activeRules = [];
        for (const map of this.dynamicRules.values()) {
            for (const compiled of map.values()) {
                activeRules.push(compiled);
            }
        }
        for (const map of this.sessionRules.values()) {
            for (const compiled of map.values()) {
                activeRules.push(compiled);
            }
        }
        for (const [extId, rulesetsMap] of this.staticRulesets.entries()) {
            const enabledSet = this.enabledRulesets.get(extId);
            for (const [rulesetId, ruleset] of rulesetsMap.entries()) {
                const isEnabled = enabledSet ? enabledSet.has(rulesetId) : ruleset.enabled;
                if (isEnabled) {
                    for (const compiled of ruleset.rules) {
                        activeRules.push(compiled);
                    }
                }
            }
        }

        activeRules.sort((a, b) => b.priority - a.priority);
        this._activeRulesCache = activeRules;
        return activeRules;
    }

    _getRulesFilePath(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const dir = path.join(ExtensionStorage.getProfileExtensionsDir(pId), 'dnr');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, `${cleanExtId}.json`);
    }

    _loadDynamicRules(profileId, extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        if (this.dynamicRules.has(cleanExtId)) {
            return this.dynamicRules.get(cleanExtId);
        }

        const map = new Map();
        this.dynamicRules.set(cleanExtId, map);

        const filePath = this._getRulesFilePath(profileId, cleanExtId);
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    for (const rule of list) {
                        if (rule && rule.id) {
                            map.set(rule.id, this._compileRule(rule));
                        }
                    }
                }
            } catch (err) {
                console.warn(`[DNR] Failed to load rules for ${cleanExtId}:`, err?.message || err);
            }
        }
        this._invalidateCache();
        return map;
    }

    _saveDynamicRules(profileId, extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const map = this.dynamicRules.get(cleanExtId);
        const filePath = this._getRulesFilePath(profileId, cleanExtId);

        try {
            const list = map ? Array.from(map.values()).map(r => r.raw) : [];
            fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
        } catch (err) {
            console.warn(`[DNR] Failed to save rules for ${cleanExtId}:`, err?.message || err);
        }
    }

    /**
     * Compiles a declarative rule condition into a regex and fast matcher.
     */
    _compileRule(rule) {
        const cond = rule.condition || {};
        let urlRegex = null;

        if (cond.regexFilter) {
            try {
                const flags = cond.isUrlFilterCaseSensitive ? '' : 'i';
                urlRegex = new RegExp(cond.regexFilter, flags);
            } catch (_) {}
        } else if (cond.urlFilter) {
            urlRegex = this._compileUrlFilter(cond.urlFilter, !!cond.isUrlFilterCaseSensitive);
        }

        const resourceTypes = Array.isArray(cond.resourceTypes) ? new Set(cond.resourceTypes.map(t => t.toLowerCase())) : null;
        const excludedResourceTypes = Array.isArray(cond.excludedResourceTypes) ? new Set(cond.excludedResourceTypes.map(t => t.toLowerCase())) : null;
        const initiatorDomains = Array.isArray(cond.initiatorDomains || cond.domains) ? new Set((cond.initiatorDomains || cond.domains).map(d => d.toLowerCase())) : null;
        const excludedInitiatorDomains = Array.isArray(cond.excludedInitiatorDomains || cond.excludedDomains) ? new Set((cond.excludedInitiatorDomains || cond.excludedDomains).map(d => d.toLowerCase())) : null;

        return {
            raw: rule,
            id: rule.id,
            priority: rule.priority || 1,
            action: rule.action || { type: 'block' },
            urlRegex,
            resourceTypes,
            excludedResourceTypes,
            initiatorDomains,
            excludedInitiatorDomains,
        };
    }

    /**
     * Converts a Chrome urlFilter pattern to a RegExp.
     * Supports:
     * - '||' prefix (matches beginning of domain)
     * - '*' (wildcard matching anything)
     * - '^' (separator matching : / ? # or start/end of string)
     */
    _compileUrlFilter(filter, caseSensitive) {
        try {
            let pattern = filter;
            let fromDomainStart = false;

            if (pattern.startsWith('||')) {
                fromDomainStart = true;
                pattern = pattern.slice(2);
            }

            // Escape special regex chars except * and ^
            let regexStr = pattern.replace(/[.+?${}()|[\]\\]/g, '\\$&');
            // Wildcard *
            regexStr = regexStr.replace(/\*/g, '.*');
            // Separator ^
            regexStr = regexStr.replace(/\^/g, '([/:?#]|$)');

            if (fromDomainStart) {
                regexStr = '^https?://([a-zA-Z0-9.-]+\\.)?' + regexStr;
            }

            return new RegExp(regexStr, caseSensitive ? '' : 'i');
        } catch (_) {
            return null;
        }
    }

    /**
     * Evaluates whether a request matches a compiled rule.
     */
    _matchesRule(rule, details) {
        const { url, resourceType, initiator } = details;

        // Check resource type
        if (rule.resourceTypes && !rule.resourceTypes.has(resourceType)) {
            return false;
        }
        if (rule.excludedResourceTypes && rule.excludedResourceTypes.has(resourceType)) {
            return false;
        }

        // Check initiator domain
        if (initiator) {
            let initHost = '';
            try { initHost = new URL(initiator).hostname.toLowerCase(); } catch (_) {}

            if (rule.initiatorDomains && !rule.initiatorDomains.has(initHost)) {
                return false;
            }
            if (rule.excludedInitiatorDomains && rule.excludedInitiatorDomains.has(initHost)) {
                return false;
            }
        }

        // Check URL pattern
        if (rule.urlRegex && !rule.urlRegex.test(url)) {
            return false;
        }

        return true;
    }

    /**
     * Attaches the DNR request interceptor to an Electron session.
     */
    attachToSession(ses) {
        if (!ses || this.attachedSessions.has(ses)) return;
        this.attachedSessions.add(ses);

        ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            // Ignore internal InviSurf and extension requests
            if (details.url.startsWith('app://') || details.url.startsWith('chrome-extension://') || details.url.startsWith('invisurf-ext://')) {
                return callback({});
            }

            try {
                const { getWebRequestManager } = require('./WebRequestManager');
                getWebRequestManager().forwardBeforeRequest(details);
            } catch (_) {}

            const activeRules = this._getActiveRules();
            if (activeRules.length === 0) {
                return callback({});
            }

            const electronResourceType = (details.resourceType || 'other').toLowerCase();
            const dnrDetails = {
                url: details.url,
                resourceType: electronResourceType === 'xhr' ? 'xmlhttprequest' : electronResourceType,
                initiator: details.initiator || '',
            };

            for (const rule of activeRules) {
                if (this._matchesRule(rule, dnrDetails)) {
                    const actionType = rule.action.type;

                    if (actionType === 'block') {
                        return callback({ cancel: true });
                    }

                    if (actionType === 'redirect' && rule.action.redirect?.url) {
                        return callback({ redirectURL: rule.action.redirect.url });
                    }

                    if (actionType === 'allow') {
                        return callback({});
                    }

                    if (actionType === 'upgradeScheme') {
                        if (details.url.startsWith('http://')) {
                            return callback({ redirectURL: details.url.replace(/^http:/, 'https:') });
                        }
                    }
                }
            }

            callback({});
        });
    }

    /**
     * chrome.declarativeNetRequest.updateDynamicRules(options)
     */
    async updateDynamicRules(profileId, extensionId, options = {}) {
        const { addRules = [], removeRuleIds = [] } = options;
        const rulesMap = this._loadDynamicRules(profileId, extensionId);

        // Remove rules
        if (Array.isArray(removeRuleIds)) {
            for (const id of removeRuleIds) {
                rulesMap.delete(Number(id));
            }
        }

        // Add rules
        if (Array.isArray(addRules)) {
            for (const rule of addRules) {
                if (rule && rule.id) {
                    rulesMap.set(Number(rule.id), this._compileRule(rule));
                }
            }
        }

        this._saveDynamicRules(profileId, extensionId);
        this._invalidateCache();
    }

    /**
     * chrome.declarativeNetRequest.getDynamicRules()
     */
    async getDynamicRules(profileId, extensionId) {
        const rulesMap = this._loadDynamicRules(profileId, extensionId);
        return Array.from(rulesMap.values()).map(r => r.raw);
    }

    /**
     * chrome.declarativeNetRequest.updateSessionRules(options)
     */
    async updateSessionRules(extensionId, options = {}) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        if (!this.sessionRules.has(cleanExtId)) {
            this.sessionRules.set(cleanExtId, new Map());
        }
        const rulesMap = this.sessionRules.get(cleanExtId);

        const { addRules = [], removeRuleIds = [] } = options;
        if (Array.isArray(removeRuleIds)) {
            for (const id of removeRuleIds) {
                rulesMap.delete(Number(id));
            }
        }
        if (Array.isArray(addRules)) {
            for (const rule of addRules) {
                if (rule && rule.id) {
                    rulesMap.set(Number(rule.id), this._compileRule(rule));
                }
            }
        }
        this._invalidateCache();
    }

    /**
     * chrome.declarativeNetRequest.getSessionRules()
     */
    async getSessionRules(extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const map = this.sessionRules.get(cleanExtId);
        return map ? Array.from(map.values()).map(r => r.raw) : [];
    }

    /**
     * chrome.declarativeNetRequest.updateEnabledRulesets(options)
     */
    async updateEnabledRulesets(extensionId, options = {}) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        if (!this.enabledRulesets.has(cleanExtId)) {
            this.enabledRulesets.set(cleanExtId, new Set());
        }
        const set = this.enabledRulesets.get(cleanExtId);

        if (Array.isArray(options.disableRulesetIds)) {
            for (const id of options.disableRulesetIds) set.delete(id);
        }
        if (Array.isArray(options.enableRulesetIds)) {
            for (const id of options.enableRulesetIds) set.add(id);
        }
        this._invalidateCache();
    }

    /**
     * chrome.declarativeNetRequest.getEnabledRulesets()
     */
    async getEnabledRulesets(extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const set = this.enabledRulesets.get(cleanExtId);
        return set ? Array.from(set.values()) : [];
    }

    /**
     * Loads static rulesets declared in an extension's manifest (manifest.declarative_net_request.rule_resources).
     */
    loadStaticRulesets(extensionId, extensionDir, ruleResources = []) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        if (!this.staticRulesets.has(cleanExtId)) {
            this.staticRulesets.set(cleanExtId, new Map());
        }
        const rulesetsMap = this.staticRulesets.get(cleanExtId);

        if (!this.enabledRulesets.has(cleanExtId)) {
            this.enabledRulesets.set(cleanExtId, new Set());
        }
        const enabledSet = this.enabledRulesets.get(cleanExtId);

        for (const res of ruleResources) {
            if (!res || !res.id || !res.path) continue;
            const fullPath = path.join(extensionDir, res.path);
            if (!fs.existsSync(fullPath)) continue;

            try {
                const raw = fs.readFileSync(fullPath, 'utf-8');
                const list = JSON.parse(raw);
                const compiledRules = [];
                if (Array.isArray(list)) {
                    for (const rule of list) {
                        if (rule && rule.id) {
                            compiledRules.push(this._compileRule(rule));
                        }
                    }
                }

                const isEnabledByDefault = res.enabled !== false;
                rulesetsMap.set(res.id, {
                    id: res.id,
                    enabled: isEnabledByDefault,
                    rules: compiledRules,
                });

                if (isEnabledByDefault && !enabledSet.has(res.id)) {
                    enabledSet.add(res.id);
                }
                console.log(`[DNR] Loaded static ruleset "${res.id}" (${compiledRules.length} rules) for ${cleanExtId}`);
            } catch (err) {
                console.warn(`[DNR] Failed to load static ruleset "${res.id}" for ${cleanExtId}:`, err?.message || err);
            }
        }
        this._invalidateCache();
    }

    /**
     * Unloads static rulesets when an extension is disabled or uninstalled.
     */
    unloadStaticRulesets(extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        this.staticRulesets.delete(cleanExtId);
        this.enabledRulesets.delete(cleanExtId);
        this._invalidateCache();
    }
}

// Singleton
let instance = null;
function getDeclarativeNetRequestManager() {
    if (!instance) {
        instance = new DeclarativeNetRequestManager();
    }
    return instance;
}

module.exports = {
    DeclarativeNetRequestManager,
    getDeclarativeNetRequestManager,
};
