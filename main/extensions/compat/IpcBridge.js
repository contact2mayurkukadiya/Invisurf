const { ipcMain, protocol, webContents, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const State = require('../../state');
const { getStorageManager } = require('./StorageManager');
const { getTabRegistry } = require('./TabRegistry');
const { getActionManager } = require('./ActionManager');
const { getScriptingManager } = require('./ScriptingManager');
const { getCookieManager } = require('./CookieManager');
const { getWindowManager } = require('./WindowManager');
const { getAlarmManager } = require('./AlarmManager');
const { getContextMenuManager } = require('./ContextMenuManager');
const { getDeclarativeNetRequestManager } = require('./DeclarativeNetRequestManager');
const { getNotificationManager } = require('./NotificationManager');
const { getWebNavigationManager } = require('./WebNavigationManager');
const { getDownloadManager } = require('./DownloadManager');
const { getWebRequestManager } = require('./WebRequestManager');
const { getBookmarkManager } = require('./BookmarkManager');
const { getHistoryManager } = require('./HistoryManager');
const { getIdentityManager } = require('./IdentityManager');
const { getOffscreenManager } = require('./OffscreenManager');
const { getOmniboxManager } = require('./OmniboxManager');
const { getMediaCaptureManager } = require('./MediaCaptureManager');
const ExtensionStorage = require('../ExtensionStorage');

/**
 * IpcBridge
 * Central dispatch router for all chrome.* compatibility layer APIs.
 * Supports:
 * 1. Background Service Workers via custom fetch protocol: invisurf-ext://
 * 2. Extension Popups & Content Scripts via ipcMain ('invisurf-ext-api')
 */
class IpcBridge {
    constructor() {
        /**
         * Long-poll pending event responders for Service Workers:
         * Map<extensionId, Array<(events) => void>>
         */
        this.pendingPolls = new Map();

        /**
         * Queued events for extensions when worker is not actively polling:
         * Map<extensionId, Array<any>>
         */
        this.queuedEvents = new Map();

        /**
         * Active connected ports: Map<portId, PortInfo>
         */
        this.activePorts = new Map();

        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;
        this.initialized = true;

        this._registerProtocolHandler();
        this._registerIpcMainHandler();
        this._wireManagerEvents();
    }

    _wireManagerEvents() {
        // Forward storage change events
        getStorageManager().on('storage-changed', ({ profileId, extensionId, areaName, changes }) => {
            this.broadcastEvent(extensionId, 'chrome.storage.onChanged', [changes, areaName]);
        });

        // Forward action update events to renderer shell
        getActionManager().on('action-updated', ({ extensionId, tabId, state }) => {
            for (const ctx of State.windowContextsById.values()) {
                if (ctx.window?.webContents && !ctx.window.webContents.isDestroyed()) {
                    ctx.window.webContents.send('extensions:action-state-updated', { extensionId, tabId, state });
                }
            }
        });

        // Forward cookie change events
        getCookieManager().on('cookie-changed', ({ changeInfo }) => {
            this.broadcastToAllExtensions('chrome.cookies.onChanged', [changeInfo]);
        });

        // Forward alarms
        getAlarmManager().on('alarm-triggered', ({ extensionId, alarm }) => {
            this.broadcastEvent(extensionId, 'chrome.alarms.onAlarm', [alarm]);
        });

        // Forward context menu clicks
        getContextMenuManager().on('item-clicked', ({ extensionId, clickInfo, tab }) => {
            this.broadcastEvent(extensionId, 'chrome.contextMenus.onClicked', [clickInfo, tab]);
        });

        // Forward notification events
        getNotificationManager().on('notification-clicked', ({ extensionId, notificationId }) => {
            this.broadcastEvent(extensionId, 'chrome.notifications.onClicked', [notificationId]);
        });
        getNotificationManager().on('notification-closed', ({ extensionId, notificationId, byUser }) => {
            this.broadcastEvent(extensionId, 'chrome.notifications.onClosed', [notificationId, byUser]);
        });

        // Forward webNavigation events
        getWebNavigationManager().on('nav-event', ({ eventName, details }) => {
            this.broadcastToAllExtensions(eventName, [details]);
        });

        // Forward download events
        getDownloadManager().on('download-created', (downloadItem) => {
            this.broadcastToAllExtensions('chrome.downloads.onCreated', [downloadItem]);
        });
        getDownloadManager().on('download-changed', (delta) => {
            this.broadcastToAllExtensions('chrome.downloads.onChanged', [delta]);
        });
        getDownloadManager().on('download-erased', (downloadId) => {
            this.broadcastToAllExtensions('chrome.downloads.onErased', [downloadId]);
        });

        // Forward webRequest events
        getWebRequestManager().on('web-request-event', ({ eventName, details }) => {
            this.broadcastToAllExtensions(eventName, [details]);
        });

        // Forward bookmark events
        getBookmarkManager().on('bookmark-created', ({ id, bookmark }) => {
            this.broadcastToAllExtensions('chrome.bookmarks.onCreated', [id, bookmark]);
        });
        getBookmarkManager().on('bookmark-removed', ({ id, removeInfo }) => {
            this.broadcastToAllExtensions('chrome.bookmarks.onRemoved', [id, removeInfo]);
        });
        getBookmarkManager().on('bookmark-changed', ({ id, changeInfo }) => {
            this.broadcastToAllExtensions('chrome.bookmarks.onChanged', [id, changeInfo]);
        });

        // Forward history events
        getHistoryManager().on('history-visited', ({ result }) => {
            this.broadcastToAllExtensions('chrome.history.onVisited', [result]);
        });
        getHistoryManager().on('history-visit-removed', ({ removed }) => {
            this.broadcastToAllExtensions('chrome.history.onVisitRemoved', [removed]);
        });

        // Forward omnibox events
        getOmniboxManager().on('omnibox-input-started', ({ extensionId }) => {
            this.broadcastEvent(extensionId, 'chrome.omnibox.onInputStarted', []);
        });
        getOmniboxManager().on('omnibox-input-changed', ({ extensionId, text, suggestCallbackId }) => {
            this.broadcastEvent(extensionId, 'chrome.omnibox.onInputChanged', [text, suggestCallbackId]);
        });
        getOmniboxManager().on('omnibox-input-entered', ({ extensionId, text, disposition }) => {
            this.broadcastEvent(extensionId, 'chrome.omnibox.onInputEntered', [text, disposition]);
        });
        getOmniboxManager().on('omnibox-input-cancelled', ({ extensionId }) => {
            this.broadcastEvent(extensionId, 'chrome.omnibox.onInputCancelled', []);
        });

        // Forward tab capture status events
        getMediaCaptureManager().on('tab-capture-status-changed', ({ info }) => {
            this.broadcastToAllExtensions('chrome.tabCapture.onStatusChanged', [info]);
        });
    }

    /**
     * Shared request handler for the invisurf-ext protocol scheme.
     * Fully handles CORS headers and OPTIONS preflights for web page content scripts.
     */
    async _handleProtocolRequest(request) {
        const corsHeaders = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }

        try {
            const parsedUrl = new URL(request.url);
            const fullPath = `${parsedUrl.host || ''}${parsedUrl.pathname || ''}`.replace(/^\/+|\/+$/g, '');

            // 1. Long-polling events endpoint: invisurf-ext://poll-events?extId=xxx
            if (fullPath === 'poll-events' || parsedUrl.host === 'poll-events' || fullPath.startsWith('poll-events') || parsedUrl.pathname.includes('poll-events')) {
                const extId = parsedUrl.searchParams.get('extId');
                if (!extId) {
                    return new Response(JSON.stringify([]), { headers: corsHeaders });
                }

                const cleanId = ExtensionStorage.sanitizeExtensionId(extId);

                // If events already queued, return them immediately
                const queue = this.queuedEvents.get(cleanId);
                if (queue && queue.length > 0) {
                    const events = [...queue];
                    this.queuedEvents.delete(cleanId);
                    return new Response(JSON.stringify(events), { headers: corsHeaders });
                }

                // Otherwise wait for next event (timeout after 25s)
                const events = await new Promise((resolve) => {
                    if (!this.pendingPolls.has(cleanId)) {
                        this.pendingPolls.set(cleanId, []);
                    }

                    const timer = setTimeout(() => {
                        const list = this.pendingPolls.get(cleanId) || [];
                        const idx = list.indexOf(resolver);
                        if (idx !== -1) list.splice(idx, 1);
                        resolve([]);
                    }, 25000);

                    const resolver = (evList) => {
                        clearTimeout(timer);
                        resolve(evList);
                    };

                    this.pendingPolls.get(cleanId).push(resolver);
                });

                return new Response(JSON.stringify(events || []), { headers: corsHeaders });
            }

            // 2. API invocation endpoint: invisurf-ext://api/call (POST)
            if (fullPath === 'api/call' || fullPath === 'call' || parsedUrl.host === 'api' || parsedUrl.host === 'call' || fullPath.includes('call')) {
                let bodyText = '';
                if (request.body) {
                    bodyText = await request.text();
                }
                const payload = bodyText ? JSON.parse(bodyText) : {};
                const { method, args, extensionId, profileId, tabId } = payload;

                const result = await this.dispatch(method, args, {
                    extensionId,
                    profileId: profileId || State.defaultProfileId,
                    senderTabId: tabId,
                });

                return new Response(JSON.stringify({ ok: true, result }), { headers: corsHeaders });
            }

            return new Response('Not found', { status: 404, headers: corsHeaders });
        } catch (err) {
            console.error('[IpcBridge] Protocol request error:', err);
            return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
                status: 500,
                headers: corsHeaders,
            });
        }
    }

    /**
     * Registers the invisurf-ext protocol scheme handler on defaultSession and global protocol.
     */
    _registerProtocolHandler() {
        try {
            if (!protocol.isProtocolHandled('invisurf-ext')) {
                protocol.handle('invisurf-ext', (request) => this._handleProtocolRequest(request));
            }
        } catch (err) {
            console.warn('[IpcBridge] Failed to register invisurf-ext on default protocol:', err?.message || err);
        }
    }

    /**
     * Attaches the invisurf-ext protocol handler to a specific Electron Session (partition).
     * Critical for profile partitions and WebContentsViews where requests originate from web tabs.
     */
    attachToSession(electronSession) {
        if (!electronSession || !electronSession.protocol) return;
        try {
            if (typeof electronSession.protocol.isProtocolHandled === 'function' &&
                electronSession.protocol.isProtocolHandled('invisurf-ext')) {
                return;
            }
            electronSession.protocol.handle('invisurf-ext', (request) => this._handleProtocolRequest(request));
            console.log('[IpcBridge] Attached invisurf-ext protocol handler to session');
        } catch (err) {
            console.warn('[IpcBridge] Failed to register invisurf-ext on session:', err?.message || err);
        }
    }

    /**
     * Registers ipcMain handler for renderers (popups, options, content scripts).
     */
    _registerIpcMainHandler() {
        ipcMain.handle('invisurf-ext-api', async (event, { method, args, extensionId, profileId } = {}) => {
            const senderWc = event.sender;
            const senderTabId = senderWc ? senderWc.id : null;

            // Resolve context & profile from sender
            const resolvedProfile = profileId || State.defaultProfileId;

            return this.dispatch(method, args, {
                extensionId,
                profileId: resolvedProfile,
                senderTabId,
                senderWebContents: senderWc,
            });
        });
    }

    /**
     * Broadcasts an event to an extension's service worker, popups, and tab content scripts.
     */
    broadcastEvent(extensionId, eventName, args = []) {
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const eventPayload = { eventName, args, timestamp: Date.now() };

        // 1. Deliver to Service Worker via long-polling
        const pollers = this.pendingPolls.get(cleanId);
        if (pollers && pollers.length > 0) {
            const resolver = pollers.shift();
            resolver([eventPayload]);
        } else {
            if (!this.queuedEvents.has(cleanId)) {
                this.queuedEvents.set(cleanId, []);
            }
            const q = this.queuedEvents.get(cleanId);
            q.push(eventPayload);
            // Cap queued events at 100 to prevent unbounded memory growth
            if (q.length > 100) q.shift();
        }

        // 2. Deliver to any active WebContents for this extension (popups, background page, options)
        try {
            const allWc = typeof webContents?.getAllWebContents === 'function' ? webContents.getAllWebContents() : [];
            if (Array.isArray(allWc)) {
                for (const wc of allWc) {
                    try {
                        if (!wc || wc.isDestroyed()) continue;
                        const url = wc.getURL() || '';
                        if (url.includes(`chrome-extension://${cleanId}`)) {
                            wc.send('invisurf-ext-event', eventPayload);
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    /**
     * Broadcasts an event to all installed and enabled extensions across all profiles.
     */
    broadcastToAllExtensions(eventName, args = []) {
        const { getExtensionController } = require('../ExtensionController');
        const controller = getExtensionController();
        const notifiedExtIds = new Set();

        for (const profileId of controller.activeSessions.keys()) {
            const exts = controller.getInstalledExtensions(profileId);
            for (const ext of exts) {
                if (ext.enabled && ext.id && !notifiedExtIds.has(ext.id)) {
                    notifiedExtIds.add(ext.id);
                    this.broadcastEvent(ext.id, eventName, args);
                }
            }
        }

        for (const extId of this.pendingPolls.keys()) {
            if (!notifiedExtIds.has(extId)) {
                notifiedExtIds.add(extId);
                this.broadcastEvent(extId, eventName, args);
            }
        }
    }

    /**
     * Central API Dispatcher.
     */
    async dispatch(method, args = {}, sender = {}) {
        const { extensionId, profileId, senderTabId } = sender;
        const pId = profileId || State.defaultProfileId;
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);

        // Resolve extension path
        const extState = ExtensionStorage.readState(pId);
        const extMeta = extState[cleanExtId] || null;
        const extensionPath = extMeta?.path || null;

        const storageMgr = getStorageManager();
        const tabReg = getTabRegistry();
        const actionMgr = getActionManager();
        const scriptMgr = getScriptingManager();

        switch (method) {
            // ==================== STORAGE ====================
            case 'storage.get':
                return storageMgr.get(pId, cleanExtId, args.area || 'local', args.keys);

            case 'storage.set':
                return storageMgr.set(pId, cleanExtId, args.area || 'local', args.items);

            case 'storage.remove':
                return storageMgr.remove(pId, cleanExtId, args.area || 'local', args.keys);

            case 'storage.clear':
                return storageMgr.clear(pId, cleanExtId, args.area || 'local');

            case 'storage.getBytesInUse':
                return storageMgr.getBytesInUse(pId, cleanExtId, args.area || 'local', args.keys);

            // ==================== TABS ====================
            case 'tabs.query':
                return tabReg.query(args.queryInfo || {}, sender);

            case 'tabs.get':
                return tabReg.get(args.tabId);

            case 'tabs.getCurrent':
                return tabReg.getCurrent(senderTabId);

            case 'tabs.create':
                return tabReg.create(args.createProperties || {}, sender);

            case 'tabs.update':
                return tabReg.update(args.tabId, args.updateProperties || {});

            case 'tabs.remove':
                return tabReg.remove(args.tabIds);

            case 'tabs.reload':
                return tabReg.reload(args.tabId, args.reloadProperties || {});

            case 'tabs.goBack':
                return tabReg.goBack(args.tabId);

            case 'tabs.goForward':
                return tabReg.goForward(args.tabId);

            case 'tabs.sendMessage': {
                const senderObj = {
                    id: cleanExtId,
                    url: `chrome-extension://${cleanExtId}/`,
                    tab: senderTabId ? await tabReg.get(senderTabId).catch(() => null) : null,
                };
                return tabReg.sendMessage(args.tabId, args.message, args.options || {}, senderObj);
            }

            case 'tabs.connect': {
                const { tabId, portId, name } = args;
                const senderObj = {
                    id: cleanExtId,
                    url: `chrome-extension://${cleanExtId}/`,
                    tab: senderTabId ? await tabReg.get(senderTabId).catch(() => null) : null,
                };
                this.activePorts.set(portId, {
                    portId,
                    name: name || '',
                    targetExtId: cleanExtId,
                    sourceExtId: cleanExtId,
                    targetTabId: tabId,
                    sender: senderObj,
                });
                const resolved = tabReg.resolveTab(tabId);
                if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                    resolved.webContents.send('invisurf-ext-event', {
                        eventName: 'chrome.runtime.onConnect',
                        args: [{ portId, name: name || '', sender: senderObj }],
                    });
                }
                return { portId, name: name || '' };
            }

            case 'tabs.executeScript':
                return scriptMgr.executeScript(cleanExtId, extensionPath, {
                    target: { tabId: args.tabId },
                    files: args.details?.file ? [args.details.file] : (args.files || undefined),
                    func: args.details?.code || args.code || undefined,
                });

            case 'tabs.insertCSS':
                return scriptMgr.insertCSS(cleanExtId, extensionPath, {
                    target: { tabId: args.tabId },
                    files: args.details?.file ? [args.details.file] : (args.files || undefined),
                    css: args.details?.code || args.code || undefined,
                });

            case 'tabs.duplicate':
                return tabReg.duplicate(args.tabId, sender);

            case 'tabs.captureVisibleTab':
                return tabReg.captureVisibleTab(null, args.windowId, args.options);

            case 'tabs.getZoom':
                return tabReg.getZoom(args.tabId);

            case 'tabs.setZoom':
                return tabReg.setZoom(args.tabId, args.zoomFactor);

            case 'tabs.discard':
                return tabReg.discard(args.tabId);

            case 'tabs.highlight':
                return tabReg.highlight(args.highlightInfo || {}, sender);

            case 'tabs.move':
                return tabReg.move(args.tabIds, args.moveProperties || {});

            // ==================== ACTION ====================
            case 'action.closePopup': {
                const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
                const { hideExtensionPopup } = require('../../windows/overlayManager');
                const ctx = sender.senderWebContents ? getWindowContextByEventSender(sender.senderWebContents) : null;
                if (ctx) {
                    hideExtensionPopup(ctx);
                } else {
                    for (const c of State.windowContextsById.values()) {
                        if (c.activeExtensionPopup) hideExtensionPopup(c);
                    }
                }
                return true;
            }

            case 'action.setTitle':
                return actionMgr.setTitle(cleanExtId, args);

            case 'action.getTitle':
                return actionMgr.getTitle(cleanExtId, args);

            case 'action.setBadgeText':
                return actionMgr.setBadgeText(cleanExtId, args);

            case 'action.getBadgeText':
                return actionMgr.getBadgeText(cleanExtId, args);

            case 'action.setBadgeBackgroundColor':
                return actionMgr.setBadgeBackgroundColor(cleanExtId, args);

            case 'action.getBadgeBackgroundColor':
                return actionMgr.getBadgeBackgroundColor(cleanExtId, args);

            case 'action.setBadgeTextColor':
                return actionMgr.setBadgeTextColor(cleanExtId, args);

            case 'action.getBadgeTextColor':
                return actionMgr.getBadgeTextColor(cleanExtId, args);

            case 'action.setPopup':
                return actionMgr.setPopup(cleanExtId, args);

            case 'action.getPopup':
                return actionMgr.getPopup(cleanExtId, args);

            case 'action.enable':
                return actionMgr.enable(cleanExtId, args.tabId);

            case 'action.disable':
                return actionMgr.disable(cleanExtId, args.tabId);

            // ==================== SCRIPTING ====================
            case 'scripting.executeScript':
                return scriptMgr.executeScript(cleanExtId, extensionPath, args);

            case 'scripting.insertCSS':
                return scriptMgr.insertCSS(cleanExtId, extensionPath, args);

            case 'scripting.removeCSS':
                return scriptMgr.removeCSS(cleanExtId, extensionPath, args);

            case 'scripting.registerContentScripts':
                return scriptMgr.registerContentScripts(cleanExtId, extensionPath, args.scripts);

            case 'scripting.getRegisteredContentScripts':
                return scriptMgr.getRegisteredContentScripts(cleanExtId, args.filter);

            case 'scripting.unregisterContentScripts':
                return scriptMgr.unregisterContentScripts(cleanExtId, args.filter);

            case 'scripting.updateContentScripts':
                return scriptMgr.updateContentScripts(cleanExtId, extensionPath, args.scripts);

            // ==================== RUNTIME ====================
            case 'runtime.getManifest': {
                if (extMeta?.manifest) return extMeta.manifest;
                if (extensionPath) {
                    const manifestPath = path.join(extensionPath, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        try {
                            return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                        } catch (_) {}
                    }
                }
                return { name: cleanExtId, version: '1.0.0', manifest_version: 3 };
            }

            case 'runtime.getPlatformInfo': {
                const os = process.platform === 'darwin' ? 'mac' : (process.platform === 'win32' ? 'win' : 'linux');
                const arch = process.arch === 'arm64' ? 'arm64' : 'x86-64';
                return { os, arch, nacl_arch: arch };
            }

            case 'runtime.getURL': {
                const rel = (args.path || '').replace(/^\//, '');
                return `chrome-extension://${cleanExtId}/${rel}`;
            }

            case 'runtime.sendMessage': {
                const targetId = args.targetExtId || cleanExtId;
                const message = args.message;
                const senderObj = {
                    id: cleanExtId,
                    url: senderTabId ? (await tabReg.get(senderTabId).catch(() => null))?.url : `chrome-extension://${cleanExtId}/`,
                    tab: senderTabId ? await tabReg.get(senderTabId).catch(() => null) : null,
                };

                // Dispatch to the extension's worker and pages
                this.broadcastEvent(targetId, 'chrome.runtime.onMessage', [message, senderObj]);
                return { success: true };
            }

            case 'runtime.connect': {
                const targetId = args.targetExtId || cleanExtId;
                const portId = args.portId || `port_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const senderTab = senderTabId ? await tabReg.get(senderTabId).catch(() => null) : null;
                const senderObj = {
                    id: cleanExtId,
                    url: senderTab ? senderTab.url : `chrome-extension://${cleanExtId}/`,
                    tab: senderTab,
                };
                this.activePorts.set(portId, {
                    portId,
                    name: args.name || '',
                    targetExtId: targetId,
                    sourceExtId: cleanExtId,
                    sender: senderObj,
                });
                this.broadcastEvent(targetId, 'chrome.runtime.onConnect', [{
                    portId,
                    name: args.name || '',
                    sender: senderObj,
                }]);
                return { portId, name: args.name || '' };
            }

            case 'runtime.portPostMessage': {
                const { portId, message } = args;
                if (!portId) return false;
                const portInfo = this.activePorts.get(portId);
                const targetExt = portInfo ? portInfo.targetExtId : cleanExtId;
                this.broadcastEvent(targetExt, `chrome.runtime.portOnMessage_${portId}`, [message]);
                if (portInfo && portInfo.sourceExtId && portInfo.sourceExtId !== targetExt) {
                    this.broadcastEvent(portInfo.sourceExtId, `chrome.runtime.portOnMessage_${portId}`, [message]);
                }
                if (portInfo?.targetTabId) {
                    const resolved = tabReg.resolveTab(portInfo.targetTabId);
                    if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                        resolved.webContents.send('invisurf-ext-event', {
                            eventName: `chrome.runtime.portOnMessage_${portId}`,
                            args: [message],
                        });
                    }
                }
                return true;
            }

            case 'runtime.portDisconnect': {
                const { portId } = args;
                if (!portId) return false;
                const portInfo = this.activePorts.get(portId);
                const targetExt = portInfo ? portInfo.targetExtId : cleanExtId;
                this.broadcastEvent(targetExt, `chrome.runtime.portOnDisconnect_${portId}`, []);
                if (portInfo && portInfo.sourceExtId && portInfo.sourceExtId !== targetExt) {
                    this.broadcastEvent(portInfo.sourceExtId, `chrome.runtime.portOnDisconnect_${portId}`, []);
                }
                if (portInfo?.targetTabId) {
                    const resolved = tabReg.resolveTab(portInfo.targetTabId);
                    if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                        resolved.webContents.send('invisurf-ext-event', {
                            eventName: `chrome.runtime.portOnDisconnect_${portId}`,
                            args: [],
                        });
                    }
                }
                this.activePorts.delete(portId);
                return true;
            }

            case 'runtime.openOptionsPage': {
                let optionsPage = 'options.html';
                if (extMeta?.manifest) {
                    optionsPage = extMeta.manifest.options_ui?.page || extMeta.manifest.options_page || 'options.html';
                } else if (extensionPath) {
                    const manifestPath = path.join(extensionPath, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        try {
                            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                            optionsPage = manifest.options_ui?.page || manifest.options_page || 'options.html';
                        } catch (_) {}
                    }
                }
                const targetUrl = `chrome-extension://${cleanExtId}/${String(optionsPage).replace(/^\//, '')}`;
                const { openUrlInNewTab } = require('../../windows/tabManager');
                openUrlInNewTab(targetUrl, { background: false });
                return true;
            }

            case 'runtime.reload': {
                const { getExtensionController } = require('../ExtensionController');
                return getExtensionController().reloadExtension(pId, cleanExtId);
            }

            // ==================== MANAGEMENT ====================
            case 'management.getSelf': {
                const { getExtensionController } = require('../ExtensionController');
                const exts = getExtensionController().getInstalledExtensions(pId);
                const me = exts.find(e => e.id === cleanExtId);
                return me || { id: cleanExtId, name: cleanExtId, enabled: true, installType: 'normal', type: 'extension' };
            }

            case 'management.getAll': {
                const { getExtensionController } = require('../ExtensionController');
                return getExtensionController().getInstalledExtensions(pId);
            }

            case 'management.get': {
                const { getExtensionController } = require('../ExtensionController');
                const targetClean = ExtensionStorage.sanitizeExtensionId(args.id);
                const exts = getExtensionController().getInstalledExtensions(pId);
                const target = exts.find(e => e.id === targetClean);
                if (!target) throw new Error(`No extension with id: ${args.id}`);
                return target;
            }

            case 'management.setEnabled': {
                const { getExtensionController } = require('../ExtensionController');
                const targetClean = ExtensionStorage.sanitizeExtensionId(args.id);
                return getExtensionController().toggleExtension(pId, targetClean);
            }

            case 'management.uninstall': {
                const { getExtensionController } = require('../ExtensionController');
                const targetClean = ExtensionStorage.sanitizeExtensionId(args.id);
                return getExtensionController().uninstallExtension(pId, targetClean);
            }

            case 'management.uninstallSelf': {
                const { getExtensionController } = require('../ExtensionController');
                return getExtensionController().uninstallExtension(pId, cleanExtId);
            }

            case 'management.getPermissionWarningsById': {
                return [];
            }

            // ==================== DOWNLOADS ====================
            case 'downloads.download': {
                const session = State.windowContextsById.values().next().value?.partition ?
                    require('electron').session.fromPartition(State.windowContextsById.values().next().value.partition) :
                    require('electron').session.defaultSession;
                return getDownloadManager().download(session, args.options);
            }

            case 'downloads.search':
                return getDownloadManager().search(args.query);

            case 'downloads.pause':
                return getDownloadManager().pause(args.downloadId);

            case 'downloads.resume':
                return getDownloadManager().resume(args.downloadId);

            case 'downloads.cancel':
                return getDownloadManager().cancel(args.downloadId);

            case 'downloads.show':
                return getDownloadManager().show(args.downloadId);

            case 'downloads.open':
                return getDownloadManager().open(args.downloadId);

            case 'downloads.erase':
                return getDownloadManager().erase(args.query);

            // ==================== COMMANDS ====================
            case 'commands.getAll': {
                let manifest = extMeta?.manifest;
                if (!manifest && extensionPath) {
                    const manifestPath = path.join(extensionPath, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch (_) {}
                    }
                }
                const commands = [];
                if (manifest?.commands && typeof manifest.commands === 'object') {
                    for (const [name, cmd] of Object.entries(manifest.commands)) {
                        commands.push({
                            name,
                            description: cmd.description || '',
                            shortcut: cmd.suggested_key?.default || cmd.suggested_key?.mac || '',
                        });
                    }
                }
                return commands;
            }

            // ==================== COOKIES ====================
            case 'cookies.get':
                return getCookieManager().get(pId, args);
            case 'cookies.getAll':
                return getCookieManager().getAll(pId, args);
            case 'cookies.set':
                return getCookieManager().set(pId, args);
            case 'cookies.remove':
                return getCookieManager().remove(pId, args);

            // ==================== WINDOWS ====================
            case 'windows.get':
                return getWindowManager().get(args.windowId, args.queryOptions);
            case 'windows.getCurrent':
                return getWindowManager().getCurrent(args.queryOptions, sender);
            case 'windows.getAll':
                return getWindowManager().getAll(args.queryOptions);
            case 'windows.create':
                return getWindowManager().create(args.createData, sender);
            case 'windows.update':
                return getWindowManager().update(args.windowId, args.updateInfo);
            case 'windows.remove':
                return getWindowManager().remove(args.windowId);

            // ==================== ALARMS ====================
            case 'alarms.create':
                return getAlarmManager().create(cleanExtId, args.name, args.alarmInfo);
            case 'alarms.get':
                return getAlarmManager().get(cleanExtId, args.name);
            case 'alarms.getAll':
                return getAlarmManager().getAll(cleanExtId);
            case 'alarms.clear':
                return getAlarmManager().clear(cleanExtId, args.name);
            case 'alarms.clearAll':
                return getAlarmManager().clearAll(cleanExtId);

            // ==================== CONTEXT MENUS ====================
            case 'contextMenus.create':
                return getContextMenuManager().create(cleanExtId, args.createProperties);
            case 'contextMenus.update':
                return getContextMenuManager().update(cleanExtId, args.id, args.updateProperties);
            case 'contextMenus.remove':
                return getContextMenuManager().remove(cleanExtId, args.id);
            case 'contextMenus.removeAll':
                return getContextMenuManager().removeAll(cleanExtId);

            // ==================== DECLARATIVE NET REQUEST ====================
            case 'declarativeNetRequest.updateDynamicRules':
                return getDeclarativeNetRequestManager().updateDynamicRules(pId, cleanExtId, args);
            case 'declarativeNetRequest.getDynamicRules':
                return getDeclarativeNetRequestManager().getDynamicRules(pId, cleanExtId);
            case 'declarativeNetRequest.updateSessionRules':
                return getDeclarativeNetRequestManager().updateSessionRules(cleanExtId, args);
            case 'declarativeNetRequest.getSessionRules':
                return getDeclarativeNetRequestManager().getSessionRules(cleanExtId);
            case 'declarativeNetRequest.updateEnabledRulesets':
                return getDeclarativeNetRequestManager().updateEnabledRulesets(cleanExtId, args);
            case 'declarativeNetRequest.getEnabledRulesets':
                return getDeclarativeNetRequestManager().getEnabledRulesets(cleanExtId);

            // ==================== NOTIFICATIONS ====================
            case 'notifications.create':
                return getNotificationManager().create(cleanExtId, args.notificationId, args.options);
            case 'notifications.clear':
                return getNotificationManager().clear(cleanExtId, args.notificationId);
            case 'notifications.getAll':
                return getNotificationManager().getAll(cleanExtId);

            // ==================== BOOKMARKS ====================
            case 'bookmarks.get':
                return getBookmarkManager().get(args.idOrIdList);
            case 'bookmarks.getChildren':
                return getBookmarkManager().getChildren(args.id);
            case 'bookmarks.getRecent':
                return getBookmarkManager().getRecent(args.numberOfItems);
            case 'bookmarks.getTree':
                return getBookmarkManager().getTree();
            case 'bookmarks.getSubTree':
                return getBookmarkManager().getSubTree(args.id);
            case 'bookmarks.search':
                return getBookmarkManager().search(args.query);
            case 'bookmarks.create':
                return getBookmarkManager().create(args.bookmark);
            case 'bookmarks.update':
                return getBookmarkManager().update(args.id, args.changes);
            case 'bookmarks.remove':
                return getBookmarkManager().remove(args.id);
            case 'bookmarks.removeTree':
                return getBookmarkManager().removeTree(args.id);

            // ==================== HISTORY ====================
            case 'history.search':
                return getHistoryManager().search(args.query);
            case 'history.getVisits':
                return getHistoryManager().getVisits(args.details);
            case 'history.addUrl':
                return getHistoryManager().addUrl(args.details);
            case 'history.deleteUrl':
                return getHistoryManager().deleteUrl(args.details);
            case 'history.deleteRange':
                return getHistoryManager().deleteRange(args.range);
            case 'history.deleteAll':
                return getHistoryManager().deleteAll();

            // ==================== IDENTITY ====================
            case 'identity.getRedirectURL':
                return getIdentityManager().getRedirectURL(cleanExtId, args.path);
            case 'identity.launchWebAuthFlow':
                return getIdentityManager().launchWebAuthFlow(cleanExtId, args.details);
            case 'identity.getProfileUserInfo':
                return getIdentityManager().getProfileUserInfo(cleanExtId, args.details);
            case 'identity.clearAllCachedAuthTokens':
                return getIdentityManager().clearAllCachedAuthTokens(cleanExtId);

            // ==================== OFFSCREEN ====================
            case 'offscreen.createDocument':
                return getOffscreenManager().createDocument(cleanExtId, args.parameters);
            case 'offscreen.closeDocument':
                return getOffscreenManager().closeDocument(cleanExtId);
            case 'offscreen.hasDocument':
                return getOffscreenManager().hasDocument(cleanExtId);

            // ==================== OMNIBOX ====================
            case 'omnibox.setDefaultSuggestion':
                return getOmniboxManager().setDefaultSuggestion(cleanExtId, args.suggestion);
            case 'omnibox.sendSuggestions':
                return getOmniboxManager().receiveSuggestions(args.suggestCallbackId, args.suggestions);

            // ==================== MEDIA CAPTURE ====================
            case 'desktopCapture.chooseDesktopMedia':
                return getMediaCaptureManager().chooseDesktopMedia(cleanExtId, args.sources, args.targetTab, sender);
            case 'desktopCapture.cancelChooseDesktopMedia':
                return getMediaCaptureManager().cancelChooseDesktopMedia(args.requestId);
            case 'tabCapture.getMediaStreamId':
                return getMediaCaptureManager().getMediaStreamId(args.options, sender);
            case 'tabCapture.capture':
                return getMediaCaptureManager().captureTab(args.options, sender);
            case 'tabCapture.getCapturedTabs':
                return getMediaCaptureManager().getCapturedTabs();
            case 'tabCapture.stopCapture':
                return getMediaCaptureManager().stopCapture(args.streamId);

            // ==================== SYSTEM PERMISSIONS ====================
            case 'system.openScreenCaptureSettings': {
                const { shell } = require('electron');
                if (process.platform === 'darwin') {
                    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
                }
                return { ok: true };
            }
            case 'system.getMediaAccessStatus': {
                const { systemPreferences } = require('electron');
                let screenStatus = 'granted';
                if (process.platform === 'darwin' && systemPreferences?.getMediaAccessStatus) {
                    try {
                        screenStatus = systemPreferences.getMediaAccessStatus('screen');
                    } catch (_) {}
                }
                return { screen: screenStatus };
            }

            default:
                console.warn(`[IpcBridge] Unhandled method: ${method}`);
                return null;
        }
    }
}

// Singleton
let instance = null;
function getIpcBridge() {
    if (!instance) {
        instance = new IpcBridge();
    }
    return instance;
}

module.exports = {
    IpcBridge,
    getIpcBridge,
};
