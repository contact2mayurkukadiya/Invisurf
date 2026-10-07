const { EventEmitter } = require('events');
const State = require('../../state');

/**
 * SessionManager
 * Bridges Chrome's chrome.sessions extension API to InviSurf's sessionService.
 * Supports:
 * - getRecentlyClosed: listing closed tabs and windows
 * - restore: reopening a closed tab or window by sessionId or most recent
 * - getDevices: synced remote devices (returns empty list)
 * - setTabValue / getTabValue: extension-specific tab metadata
 * - setWindowValue / getWindowValue: extension-specific window metadata
 * - onChanged: event emitted whenever sessions stack or session values change
 */
class SessionManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Key-value metadata per tab:
         * Map<stringTabId, Map<stringKey, any>>
         */
        this.tabValues = new Map();

        /**
         * Key-value metadata per window:
         * Map<stringWindowId, Map<stringKey, any>>
         */
        this.windowValues = new Map();
    }

    _getSessionService() {
        return require('../../services/sessionService');
    }

    _getTabRegistry() {
        const { getTabRegistry } = require('./TabRegistry');
        return getTabRegistry();
    }

    _getWindowManager() {
        const { getWindowManager } = require('./WindowManager');
        return getWindowManager();
    }

    notifySessionsChanged() {
        this.emit('sessions-changed');
    }

    /**
     * Gets the list of recently closed tabs and/or windows.
     * @param {string} profileId
     * @param {object} filter { maxResults?: number }
     * @returns {Promise<Array<object>>} Array of Chrome Session objects
     */
    async getRecentlyClosed(profileId, filter = {}) {
        const sessionService = this._getSessionService();
        const pId = profileId || State.defaultProfileId;
        const stack = sessionService.getOrCreateRecentlyClosedForProfile(pId) || [];
        const maxResults = Math.min(Math.max(1, Number(filter?.maxResults || 25)), 25);

        const results = [];
        const limit = Math.min(stack.length, maxResults);

        for (let i = 0; i < limit; i++) {
            const entry = stack[i];
            if (!entry) continue;

            const lastModified = Math.round((entry.closedAt || Date.now()) / 1000);

            if (entry.type === 'window') {
                const tabs = (entry.tabs || []).map((t, idx) => ({
                    sessionId: t.sessionId || `session_tab_${t.id || Date.now()}_${idx}`,
                    index: idx,
                    windowId: entry.windowId ?? 1,
                    url: t.url || '',
                    title: t.title || t.url || '',
                    favIconUrl: t.favicon || '',
                    active: entry.activeTabId === t.id,
                    pinned: false,
                    selected: entry.activeTabId === t.id,
                    incognito: !!entry.ghostWindow,
                }));

                results.push({
                    lastModified,
                    window: {
                        sessionId: entry.sessionId || `session_win_${Date.now()}_${i}`,
                        tabs,
                        focused: false,
                        incognito: !!entry.ghostWindow,
                        type: 'normal',
                        state: 'normal',
                        alwaysOnTop: false,
                        width: entry.bounds?.width || 1280,
                        height: entry.bounds?.height || 800,
                        top: entry.bounds?.y || 100,
                        left: entry.bounds?.x || 100,
                    },
                });
            } else {
                results.push({
                    lastModified,
                    tab: {
                        sessionId: entry.sessionId || `session_tab_${entry.id || Date.now()}_${i}`,
                        index: 0,
                        windowId: entry.windowId ?? 1,
                        url: entry.url || '',
                        title: entry.title || entry.url || '',
                        favIconUrl: entry.favicon || '',
                        active: false,
                        pinned: false,
                        selected: false,
                        incognito: !!entry.ghostWindow,
                    },
                });
            }
        }

        return results;
    }

    /**
     * Reopens a closed tab or window.
     * @param {string} profileId
     * @param {string} [sessionId] If not provided, restores the most recently closed entry
     * @param {object} [sender] IPC sender info for window context resolution
     * @returns {Promise<object>} The restored Session object
     */
    async restore(profileId, sessionId = null, sender = {}) {
        const sessionService = this._getSessionService();
        const pId = profileId || State.defaultProfileId;
        const stack = sessionService.getOrCreateRecentlyClosedForProfile(pId) || [];

        if (stack.length === 0) {
            throw new Error('No recently closed sessions available to restore');
        }

        let entryToRestore = null;
        let isTabFromWindow = false;

        if (!sessionId) {
            // Restore most recent entry
            entryToRestore = stack.shift();
        } else {
            // Find by sessionId at the entry level
            const entryIndex = stack.findIndex((e) => e && e.sessionId === sessionId);
            if (entryIndex !== -1) {
                [entryToRestore] = stack.splice(entryIndex, 1);
            } else {
                // Check if sessionId matches a tab inside one of the window entries
                for (let i = 0; i < stack.length; i++) {
                    const winEntry = stack[i];
                    if (winEntry && winEntry.type === 'window' && Array.isArray(winEntry.tabs)) {
                        const tabIndex = winEntry.tabs.findIndex((t) => t && t.sessionId === sessionId);
                        if (tabIndex !== -1) {
                            const [matchedTab] = winEntry.tabs.splice(tabIndex, 1);
                            if (winEntry.tabs.length === 0) {
                                stack.splice(i, 1);
                            }
                            entryToRestore = {
                                type: 'tab',
                                title: matchedTab.title,
                                url: matchedTab.url,
                                history: matchedTab.history,
                                favicon: matchedTab.favicon,
                                ghostWindow: winEntry.ghostWindow,
                                closedAt: winEntry.closedAt,
                                sessionId: matchedTab.sessionId,
                            };
                            isTabFromWindow = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!entryToRestore) {
            throw new Error(`No session found with id: ${sessionId}`);
        }

        // Trigger menu rebuild
        const menuUI = require('../../ui/menu');
        if (menuUI && typeof menuUI.rebuildApplicationMenu === 'function') {
            menuUI.rebuildApplicationMenu();
        }

        const lastModified = Math.round((entryToRestore.closedAt || Date.now()) / 1000);

        if (entryToRestore.type === 'window' && !isTabFromWindow) {
            const targetContext = sessionService.restoreRecentlyClosedWindowEntry(entryToRestore);
            this.notifySessionsChanged();

            let formattedWindow = null;
            if (targetContext?.window && !targetContext.window.isDestroyed()) {
                formattedWindow = await this._getWindowManager().get(targetContext.window.id, { populate: true }).catch(() => null);
            }

            return {
                lastModified,
                window: formattedWindow || {
                    sessionId: entryToRestore.sessionId,
                    tabs: [],
                    type: 'normal',
                    state: 'normal',
                    alwaysOnTop: false,
                    incognito: !!entryToRestore.ghostWindow,
                    focused: true,
                },
            };
        }

        // Restoring a tab
        let callerContext = null;
        if (sender?.senderWebContents && !sender.senderWebContents.isDestroyed()) {
            const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
            callerContext = getWindowContextByEventSender(sender.senderWebContents);
        }

        const targetContext = sessionService.resolveRestoreTargetContext(entryToRestore.profileId || pId, callerContext);
        const tabManager = require('../../windows/tabManager');
        const newTabId = tabManager.generateTabId();
        const stealthTab = !!targetContext.stealthWindow;
        const { resolveTabLoadUrl, toDisplayUrl } = require('../../utils/navigation');
        const resolvedUrl = resolveTabLoadUrl(entryToRestore.url);

        tabManager.createTab(targetContext, newTabId, resolvedUrl, stealthTab, {
            activate: true,
            navigationHistory: entryToRestore.history,
        });

        if (targetContext?.window && (!targetContext.window.isDestroyed || !targetContext.window.isDestroyed()) && targetContext.window.webContents && (!targetContext.window.webContents.isDestroyed || !targetContext.window.webContents.isDestroyed())) {
            const C = require('../../../src/constants/conditionStrings.cjs');
            targetContext.window.webContents.send(C.IPC_EVENT.TAB_CREATED, {
                id: newTabId,
                isStealth: stealthTab,
                url: toDisplayUrl(entryToRestore.url),
                title: entryToRestore.title || '',
            });
        }

        this.notifySessionsChanged();

        // Format restored tab
        const view = targetContext.tabs[newTabId];
        let formattedTab = null;
        if (view && view.webContents && !view.webContents.isDestroyed()) {
            formattedTab = this._getTabRegistry().formatTab(targetContext, newTabId, view, view.webContents);
        }

        return {
            lastModified,
            tab: formattedTab || {
                id: 1,
                sessionId: entryToRestore.sessionId,
                windowId: targetContext.window?.id || 1,
                url: entryToRestore.url,
                title: entryToRestore.title || '',
                active: true,
                pinned: false,
                selected: true,
                incognito: stealthTab,
            },
        };
    }

    /**
     * Retrieves all devices with synced sessions. Returns empty array as remote sync is not configured.
     */
    async getDevices(profileId, filter = {}) {
        return [];
    }

    /**
     * Associates a custom key-value pair with a tab.
     */
    async setTabValue(tabId, key, value) {
        if (!tabId || key == null) return;
        const idStr = String(tabId);
        if (!this.tabValues.has(idStr)) {
            this.tabValues.set(idStr, new Map());
        }
        this.tabValues.get(idStr).set(String(key), value);
        this.notifySessionsChanged();
    }

    /**
     * Retrieves a custom key-value pair for a tab.
     */
    async getTabValue(tabId, key) {
        if (!tabId || key == null) return undefined;
        const idStr = String(tabId);
        const map = this.tabValues.get(idStr);
        if (!map || !map.has(String(key))) return undefined;
        return map.get(String(key));
    }

    /**
     * Associates a custom key-value pair with a window.
     */
    async setWindowValue(windowId, key, value) {
        if (!windowId || key == null) return;
        const idStr = String(windowId);
        if (!this.windowValues.has(idStr)) {
            this.windowValues.set(idStr, new Map());
        }
        this.windowValues.get(idStr).set(String(key), value);
        this.notifySessionsChanged();
    }

    /**
     * Retrieves a custom key-value pair for a window.
     */
    async getWindowValue(windowId, key) {
        if (!windowId || key == null) return undefined;
        const idStr = String(windowId);
        const map = this.windowValues.get(idStr);
        if (!map || !map.has(String(key))) return undefined;
        return map.get(String(key));
    }
}

let instance = null;
function getSessionManager() {
    if (!instance) {
        instance = new SessionManager();
    }
    return instance;
}

module.exports = {
    SessionManager,
    getSessionManager,
};
