const { EventEmitter } = require('events');

/**
 * ActionManager
 * Handles chrome.action and chrome.browserAction metadata:
 * - badgeText, badgeBackgroundColor, badgeTextColor
 * - title / tooltip
 * - popup HTML override per tab or global
 * - enabled / disabled state
 * Emits 'action-updated' events to synchronize with the browser toolbar UI.
 */
class ActionManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map of extensionId -> {
         *   global: { title, badgeText, badgeBgColor, badgeTextColor, popup, enabled },
         *   byTab: Map<tabId, { title, badgeText, badgeBgColor, badgeTextColor, popup, enabled }>
         * }
         */
        this.actionState = new Map();
    }

    _getExtState(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        if (!this.actionState.has(cleanId)) {
            this.actionState.set(cleanId, {
                global: {
                    title: '',
                    badgeText: '',
                    badgeBgColor: '#4688F1',
                    badgeTextColor: '#FFFFFF',
                    popup: '',
                    enabled: true,
                },
                byTab: new Map(),
            });
        }
        return this.actionState.get(cleanId);
    }

    _notify(extensionId, tabId = null) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const state = this.getState(cleanId, tabId);
        this.emit('action-updated', {
            extensionId: cleanId,
            tabId,
            state,
        });
    }

    getState(extensionId, tabId = null) {
        const ext = this._getExtState(extensionId);
        if (tabId !== null && tabId !== undefined && ext.byTab.has(Number(tabId))) {
            return { ...ext.global, ...ext.byTab.get(Number(tabId)) };
        }
        return { ...ext.global };
    }

    setTitle(extensionId, { title = '', tabId = null } = {}) {
        const ext = this._getExtState(extensionId);
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.title = String(title || '');
            ext.byTab.set(num, tabState);
        } else {
            ext.global.title = String(title || '');
        }
        this._notify(extensionId, tabId);
    }

    getTitle(extensionId, { tabId = null } = {}) {
        return this.getState(extensionId, tabId).title;
    }

    setBadgeText(extensionId, { text = '', tabId = null } = {}) {
        const ext = this._getExtState(extensionId);
        const str = String(text != null ? text : '');
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.badgeText = str;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.badgeText = str;
        }
        this._notify(extensionId, tabId);
    }

    getBadgeText(extensionId, { tabId = null } = {}) {
        return this.getState(extensionId, tabId).badgeText;
    }

    setBadgeBackgroundColor(extensionId, { color = '', tabId = null } = {}) {
        const ext = this._getExtState(extensionId);
        const colStr = Array.isArray(color)
            ? `rgba(${color.join(',')})`
            : String(color || '');

        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.badgeBgColor = colStr;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.badgeBgColor = colStr;
        }
        this._notify(extensionId, tabId);
    }

    getBadgeBackgroundColor(extensionId, { tabId = null } = {}) {
        return this.getState(extensionId, tabId).badgeBgColor;
    }

    setBadgeTextColor(extensionId, { color = '', tabId = null } = {}) {
        const ext = this._getExtState(extensionId);
        const colStr = String(color || '#FFFFFF');
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.badgeTextColor = colStr;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.badgeTextColor = colStr;
        }
        this._notify(extensionId, tabId);
    }

    getBadgeTextColor(extensionId, { tabId = null } = {}) {
        return this.getState(extensionId, tabId).badgeTextColor;
    }

    setPopup(extensionId, { popup = '', tabId = null } = {}) {
        console.log(`[DEBUG-EXT] ActionManager.setPopup ext="${extensionId}" tabId=${tabId} popup="${popup}"`);
        const ext = this._getExtState(extensionId);
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.popup = String(popup || '');
            ext.byTab.set(num, tabState);
        } else {
            ext.global.popup = String(popup || '');
        }
        this._notify(extensionId, tabId);
    }

    getPopup(extensionId, { tabId = null } = {}) {
        const p = this.getState(extensionId, tabId).popup;
        console.log(`[DEBUG-EXT] ActionManager.getPopup ext="${extensionId}" tabId=${tabId} -> "${p}"`);
        return p;
    }

    enable(extensionId, tabId = null) {
        const ext = this._getExtState(extensionId);
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.enabled = true;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.enabled = true;
        }
        this._notify(extensionId, tabId);
    }

    disable(extensionId, tabId = null) {
        const ext = this._getExtState(extensionId);
        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.enabled = false;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.enabled = false;
        }
        this._notify(extensionId, tabId);
    }

    setIcon(extensionId, { imageData = null, path = null, tabId = null } = {}) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const ext = this._getExtState(cleanId);
        let iconUrl = null;
        if (typeof path === 'string') {
            iconUrl = path;
        } else if (path && typeof path === 'object') {
            const sizes = Object.keys(path).map(Number).sort((a, b) => b - a);
            if (sizes.length > 0) iconUrl = path[sizes[0]];
        }

        // Convert chrome-extension:// or relative file path to base64 data: URL
        if (iconUrl && typeof iconUrl === 'string') {
            try {
                let cleanRel = null;
                if (iconUrl.startsWith('chrome-extension://')) {
                    const parsed = new URL(iconUrl);
                    cleanRel = parsed.pathname.replace(/^\/+/, '');
                } else if (!iconUrl.startsWith('data:') && !iconUrl.startsWith('http://') && !iconUrl.startsWith('https://')) {
                    cleanRel = iconUrl.replace(/^\/+/, '');
                }

                if (cleanRel) {
                    const fs = require('fs');
                    const pathMod = require('path');
                    const ExtensionStorage = require('../ExtensionStorage');
                    const State = require('../../state');
                    const extState = ExtensionStorage.readState(State.defaultProfileId);
                    const extMeta = extState[cleanId] || Object.values(extState).find(e => e && (e.id === cleanId || e.runtimeId === cleanId));
                    if (extMeta?.path) {
                        const fullPath = pathMod.join(extMeta.path, cleanRel);
                        if (fs.existsSync(fullPath)) {
                            const b64 = fs.readFileSync(fullPath).toString('base64');
                            iconUrl = `data:image/png;base64,${b64}`;
                        }
                    }
                }
            } catch (_) {}
        }

        if (tabId != null) {
            const num = Number(tabId);
            const tabState = ext.byTab.get(num) || {};
            tabState.icon = iconUrl;
            ext.byTab.set(num, tabState);
        } else {
            ext.global.icon = iconUrl;
        }
        this._notify(cleanId, tabId);
        return true;
    }
}

// Singleton
let instance = null;
function getActionManager() {
    if (!instance) {
        instance = new ActionManager();
    }
    return instance;
}

module.exports = {
    ActionManager,
    getActionManager,
};
