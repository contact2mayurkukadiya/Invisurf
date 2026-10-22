const { WebContentsView } = require('electron');
const { EventEmitter } = require('events');
const { buildExtensionWebPreferences } = require('../../../runtime/webPreferences');
const State = require('../../state');

/**
 * OffscreenManager
 * Implements chrome.offscreen (Manifest V3):
 * Allows background service workers to spawn invisible DOM contexts (e.g. for audio, DOM parsing, clipboard).
 */
class OffscreenManager extends EventEmitter {
    constructor() {
        super();
        /** Map of extensionId -> WebContentsView */
        this.documents = new Map();
    }

    async createDocument(extensionId, details = {}) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        if (this.documents.has(cleanId)) {
            const existing = this.documents.get(cleanId);
            if (existing && !existing.webContents.isDestroyed()) {
                throw new Error('Only a single offscreen document may be created per extension.');
            }
            this.documents.delete(cleanId);
        }

        const { url, reasons = [], justification = '' } = details;
        if (!url) {
            throw new Error('chrome.offscreen.createDocument: details.url is required.');
        }

        const targetUrl = url.startsWith('chrome-extension://') ? url : `chrome-extension://${cleanId}/${url.replace(/^\/+/, '')}`;
        const targetContext = State.windowContextsById.values().next().value;
        const partition = targetContext?.partition || `persist:profile-${State.defaultProfileId}`;

        const view = new WebContentsView({
            webPreferences: buildExtensionWebPreferences({ partition }),
        });

        this.documents.set(cleanId, view);

        try {
            await view.webContents.loadURL(targetUrl);
        } catch (err) {
            this.documents.delete(cleanId);
            try { view.webContents.destroy(); } catch (_) {}
            throw err;
        }

        return true;
    }

    async closeDocument(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const view = this.documents.get(cleanId);
        if (!view) {
            throw new Error('No active offscreen document to close.');
        }
        this.documents.delete(cleanId);
        try {
            if (!view.webContents.isDestroyed()) {
                view.webContents.destroy();
            }
        } catch (_) {}
        return true;
    }

    async hasDocument(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const view = this.documents.get(cleanId);
        return !!(view && !view.webContents.isDestroyed());
    }
}

let instance = null;
function getOffscreenManager() {
    if (!instance) instance = new OffscreenManager();
    return instance;
}

module.exports = {
    OffscreenManager,
    getOffscreenManager,
};
