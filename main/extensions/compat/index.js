const { getIpcBridge } = require('./IpcBridge');
const { getStorageManager } = require('./StorageManager');
const { getTabRegistry } = require('./TabRegistry');
const { getActionManager } = require('./ActionManager');
const { getScriptingManager } = require('./ScriptingManager');
const { getCookieManager } = require('./CookieManager');
const { getWindowManager } = require('./WindowManager');
const { getAlarmManager } = require('./AlarmManager');
const { getContextMenuManager } = require('./ContextMenuManager');
const { getDownloadManager } = require('./DownloadManager');
const { getWebRequestManager } = require('./WebRequestManager');
const { getBookmarkManager } = require('./BookmarkManager');
const { getHistoryManager } = require('./HistoryManager');
const { getIdentityManager } = require('./IdentityManager');
const { getOffscreenManager } = require('./OffscreenManager');
const { getOmniboxManager } = require('./OmniboxManager');
const { getMediaCaptureManager } = require('./MediaCaptureManager');
const { generateWorkerPolyfill } = require('./workerPolyfill');

/**
 * Initializes the Chrome extension compatibility layer.
 */
function initExtensionCompatLayer() {
    const bridge = getIpcBridge();
    bridge.initialize();
    return bridge;
}

module.exports = {
    initExtensionCompatLayer,
    getIpcBridge,
    getStorageManager,
    getTabRegistry,
    getActionManager,
    getScriptingManager,
    getCookieManager,
    getWindowManager,
    getAlarmManager,
    getContextMenuManager,
    getDownloadManager,
    getWebRequestManager,
    getBookmarkManager,
    getHistoryManager,
    getIdentityManager,
    getOffscreenManager,
    getOmniboxManager,
    getMediaCaptureManager,
    generateWorkerPolyfill,
};
