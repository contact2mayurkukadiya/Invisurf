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
const { getSessionManager } = require('./SessionManager');
const { getProxyManager } = require('./ProxyManager');
const { getBrowsingDataManager } = require('./BrowsingDataManager');
const { getIdleManager } = require('./IdleManager');
const { getPowerManager } = require('./PowerManager');
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
         * Active event stream controllers for Service Workers:
         * Map<extensionId, Set<ReadableStreamDefaultController>>
         */
        this.activeStreams = new Map();

        /**
         * Long-poll pending event responders for Service Workers (legacy fallback):
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

        /**
         * Pending response resolvers for runtime.sendMessage:
         * Map<messageId, (response) => void>
         */
        this.pendingMessageResolvers = new Map();

        this.initialized = false;
        this.keepAliveInterval = null;
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

        // Forward sessions onChanged events
        getSessionManager().on('sessions-changed', () => {
            this.broadcastToAllExtensions('chrome.sessions.onChanged', []);
        });

        // Forward proxy events
        getProxyManager().on('proxy-changed', ({ profileId, extensionId, config }) => {
            this.broadcastToAllExtensions('chrome.proxy.settings.onChange', [{ value: config, levelOfControl: 'controlled_by_this_extension' }]);
        });
        getProxyManager().on('proxy-error', ({ profileId, extensionId, error }) => {
            this.broadcastEvent(extensionId, 'chrome.proxy.onProxyError', [{ fatal: true, error, details: error }]);
        });

        // Forward idle state change events
        getIdleManager().on('idle-state-changed', ({ extensionId, newState }) => {
            this.broadcastEvent(extensionId, 'chrome.idle.onStateChanged', [newState]);
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

            // 1. Persistent streaming events endpoint: invisurf-ext://events-stream?extId=xxx (Zero CPU push)
            if (fullPath === 'events-stream' || parsedUrl.host === 'events-stream' || fullPath.startsWith('events-stream') || parsedUrl.pathname.includes('events-stream')) {
                const extId = parsedUrl.searchParams.get('extId');
                if (!extId) {
                    return new Response(JSON.stringify({ error: 'Missing extId' }), { status: 400, headers: corsHeaders });
                }

                const cleanId = ExtensionStorage.sanitizeExtensionId(extId);
                const streamHeaders = {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                };

                let streamController = null;
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start: (controller) => {
                        streamController = controller;
                        if (!this.activeStreams.has(cleanId)) {
                            this.activeStreams.set(cleanId, new Set());
                        }
                        this.activeStreams.get(cleanId).add(controller);

                        // Initial connection handshake comment
                        controller.enqueue(encoder.encode(': connected\n\n'));

                        // Flush any queued events immediately
                        const queue = this.queuedEvents.get(cleanId);
                        if (queue && queue.length > 0) {
                            for (const ev of queue) {
                                controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
                            }
                            this.queuedEvents.delete(cleanId);
                        }
                    },
                    cancel: () => {
                        if (streamController && this.activeStreams.has(cleanId)) {
                            const set = this.activeStreams.get(cleanId);
                            set.delete(streamController);
                            if (set.size === 0) {
                                this.activeStreams.delete(cleanId);
                            }
                        }
                    }
                });

                // Start keepalive heartbeat (every 25s) if not already active
                if (!this.keepAliveInterval) {
                    this.keepAliveInterval = setInterval(() => {
                        const pingChunk = new TextEncoder().encode(': ping\n\n');
                        for (const [id, set] of this.activeStreams.entries()) {
                            for (const c of [...set]) {
                                try {
                                    c.enqueue(pingChunk);
                                } catch (_) {
                                    set.delete(c);
                                }
                            }
                            if (set.size === 0) {
                                this.activeStreams.delete(id);
                            }
                        }
                    }, 25000);
                    if (this.keepAliveInterval.unref) {
                        this.keepAliveInterval.unref();
                    }
                }

                return new Response(stream, { headers: streamHeaders });
            }

            // 1b. Legacy long-polling events endpoint: invisurf-ext://poll-events?extId=xxx (Fallback)
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
                    senderTabId: tabId || (args && args.tabId) || null,
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
        ipcMain.on('invisurf-ext-get-manifest', (event, extensionId) => {
            try {
                const ext = ExtensionStorage.findExtension(extensionId);
                if (ext?.manifest) {
                    event.returnValue = ext.manifest;
                    return;
                }
                if (ext?.path) {
                    const manifestPath = path.join(ext.path, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        event.returnValue = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                        return;
                    }
                }
            } catch (_) {}
            event.returnValue = {};
        });

        ipcMain.handle('invisurf-ext-api', async (event, { method, args, extensionId, profileId } = {}) => {
            const senderWc = event.sender;
            const senderTabId = senderWc ? senderWc.id : null;

            // Resolve context & profile from sender
            let resolvedProfile = profileId;
            if (!resolvedProfile && senderWc) {
                try {
                    const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
                    const senderCtx = getWindowContextByEventSender(senderWc);
                    if (senderCtx?.profileId) resolvedProfile = senderCtx.profileId;
                } catch (_) {}
            }
            if (!resolvedProfile) resolvedProfile = State.defaultProfileId;

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
    broadcastEvent(extensionId, eventName, args = [], extraMeta = {}) {
        let cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        let runtimeId = null;

        // Resolve runtimeId and canonical ext.id if they differ
        try {
            const extState = ExtensionStorage.readState(State.defaultProfileId);
            if (extState) {
                const ext = extState[cleanId] || Object.values(extState).find(e => e && (e.id === cleanId || e.runtimeId === cleanId));
                if (ext?.runtimeId) runtimeId = ExtensionStorage.sanitizeExtensionId(ext.runtimeId);
                if (ext?.id) cleanId = ExtensionStorage.sanitizeExtensionId(ext.id);
            }
        } catch (_) {}

        const extObj = ExtensionStorage.findExtension(cleanId);
        const knownIds = new Set([cleanId, String(extensionId || '').toLowerCase()]);
        if (runtimeId) knownIds.add(runtimeId);
        if (extObj?.id) knownIds.add(ExtensionStorage.sanitizeExtensionId(extObj.id));
        if (extObj?.runtimeId) knownIds.add(ExtensionStorage.sanitizeExtensionId(extObj.runtimeId));
        if (extObj?.manifest?.key) {
            const derived = ExtensionStorage.deriveExtIdFromKey(extObj.manifest.key);
            if (derived) knownIds.add(derived);
        }

        const eventPayload = {
            eventName,
            args,
            targetExtId: cleanId,
            extensionId: cleanId,
            messageId: extraMeta.messageId || null,
            timestamp: Date.now(),
        };

        // 1. Deliver to Service Worker via active streaming response (0% CPU push)
        const checkStreamKeys = Array.from(knownIds).filter(Boolean);
        let deliveredToStream = false;
        for (const k of checkStreamKeys) {
            const streams = this.activeStreams.get(k);
            if (streams && streams.size > 0) {
                const encoder = new TextEncoder();
                const chunk = encoder.encode(JSON.stringify(eventPayload) + '\n');
                for (const controller of [...streams]) {
                    try {
                        controller.enqueue(chunk);
                        deliveredToStream = true;
                    } catch (err) {
                        streams.delete(controller);
                    }
                }
                if (streams.size === 0) {
                    this.activeStreams.delete(k);
                }
            }
        }

        // 2. Deliver via legacy long-polling or buffer in queue
        if (!deliveredToStream) {
            let deliveredToPoll = false;
            for (const k of checkStreamKeys) {
                const pollers = this.pendingPolls.get(k);
                if (pollers && pollers.length > 0) {
                    const resolver = pollers.shift();
                    resolver([eventPayload]);
                    deliveredToPoll = true;
                    break;
                }
            }
            if (!deliveredToPoll) {
                if (!this.queuedEvents.has(cleanId)) {
                    this.queuedEvents.set(cleanId, []);
                }
                const q = this.queuedEvents.get(cleanId);
                q.push(eventPayload);
                // Cap queued events at 100 to prevent unbounded memory growth
                if (q.length > 100) q.shift();
            }
        }

        // Track delivered WebContents IDs to prevent duplicate event dispatching
        const deliveredWcIds = new Set();
        if (extraMeta.senderWcId) {
            deliveredWcIds.add(extraMeta.senderWcId);
        }

        // 3. Deliver to active extension popups directly
        for (const ctx of State.windowContextsById.values()) {
            const popupView = ctx.activeExtensionPopup?.view;
            if (popupView && !popupView.webContents.isDestroyed()) {
                const wcId = popupView.webContents.id;
                if (deliveredWcIds.has(wcId)) continue;
                const popupExtId = ExtensionStorage.sanitizeExtensionId(ctx.activeExtensionPopup.extensionId);
                const popupObj = ExtensionStorage.findExtension(popupExtId);
                const popupDerived = popupObj?.manifest?.key ? ExtensionStorage.deriveExtIdFromKey(popupObj.manifest.key) : null;
                const matchesPopup = knownIds.has(popupExtId) ||
                    (popupDerived && knownIds.has(popupDerived)) ||
                    (popupObj?.id && knownIds.has(ExtensionStorage.sanitizeExtensionId(popupObj.id)));
                if (matchesPopup) {
                    try {
                        deliveredWcIds.add(wcId);
                        popupView.webContents.send('invisurf-ext-event', eventPayload);
                    } catch (_) {}
                }
            }
        }

        // 4. Deliver to any active WebContents for this extension (popups, background page, options)
        try {
            const allWc = typeof webContents?.getAllWebContents === 'function' ? webContents.getAllWebContents() : [];
            if (Array.isArray(allWc)) {
                for (const wc of allWc) {
                    try {
                        if (!wc || wc.isDestroyed()) continue;
                        if (deliveredWcIds.has(wc.id)) continue;
                        const url = wc.getURL() || '';
                        let isMatch = false;
                        for (const kid of knownIds) {
                            if (url.includes(`chrome-extension://${kid}`)) {
                                isMatch = true;
                                break;
                            }
                        }
                        if (isMatch) {
                            deliveredWcIds.add(wc.id);
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

        const requiresPermission = (ext) => {
            if (!ext) return true;
            const perms = ext.manifest?.permissions || [];
            const optPerms = ext.manifest?.optional_permissions || [];
            const hasPerm = (p) => perms.includes(p) || optPerms.includes(p);

            if (eventName.startsWith('chrome.webRequest.')) return hasPerm('webRequest');
            if (eventName.startsWith('chrome.cookies.')) return hasPerm('cookies');
            if (eventName.startsWith('chrome.bookmarks.')) return hasPerm('bookmarks');
            if (eventName.startsWith('chrome.downloads.')) return hasPerm('downloads');
            if (eventName.startsWith('chrome.history.')) return hasPerm('history');
            if (eventName.startsWith('chrome.webNavigation.')) return hasPerm('webNavigation');
            if (eventName.startsWith('chrome.proxy.')) return hasPerm('proxy');
            return true;
        };

        for (const profileId of controller.activeSessions.keys()) {
            const exts = controller.getInstalledExtensions(profileId);
            for (const ext of exts) {
                if (ext.enabled && ext.id && !notifiedExtIds.has(ext.id)) {
                    if (requiresPermission(ext)) {
                        notifiedExtIds.add(ext.id);
                        this.broadcastEvent(ext.id, eventName, args);
                    }
                }
            }
        }

        for (const extId of this.pendingPolls.keys()) {
            if (!notifiedExtIds.has(extId)) {
                const ext = ExtensionStorage.findExtension(extId);
                if (!ext || requiresPermission(ext)) {
                    notifiedExtIds.add(extId);
                    this.broadcastEvent(extId, eventName, args);
                }
            }
        }
    }

    /**
     * Cleans up any active runtime ports associated with a closed tab.
     */
    cleanupTab(tabId) {
        if (!tabId) return;
        const numTabId = Number(tabId);
        for (const [portId, portInfo] of this.activePorts.entries()) {
            if (Number(portInfo?.sourceTabId) === numTabId || Number(portInfo?.targetTabId) === numTabId) {
                try {
                    const targetExt = portInfo.targetExtId || portInfo.sourceExtId;
                    if (targetExt) {
                        this.broadcastEvent(targetExt, `chrome.runtime.portOnDisconnect_${portId}`, []);
                    }
                } catch (_) {}
                this.activePorts.delete(portId);
            }
        }
    }

    /**
     * Cleans up all active streams, polls, queued events, and ports when an extension is unloaded or disabled.
     */
    unloadExtension(extensionId) {
        if (!extensionId) return;
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);

        // Close and remove any active event streams
        if (this.activeStreams.has(cleanId)) {
            const streams = this.activeStreams.get(cleanId);
            for (const controller of streams) {
                try { controller.close(); } catch (_) {}
            }
            this.activeStreams.delete(cleanId);
        }

        // Resolve and clear pending polls
        if (this.pendingPolls.has(cleanId)) {
            const polls = this.pendingPolls.get(cleanId);
            for (const resolver of polls) {
                try { resolver([]); } catch (_) {}
            }
            this.pendingPolls.delete(cleanId);
        }

        // Clear queued events
        this.queuedEvents.delete(cleanId);

        // Clean up any ports associated with this extension
        for (const [portId, portInfo] of this.activePorts.entries()) {
            if (portInfo.targetExtId === cleanId || portInfo.sourceExtId === cleanId) {
                this.activePorts.delete(portId);
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
        const extMeta = ExtensionStorage.findExtension(cleanExtId, pId);
        let extensionPath = extMeta?.path || null;
        if (!extensionPath) {
            const extState = ExtensionStorage.readState(pId);
            const ext = extState[cleanExtId] || Object.values(extState).find(e => e && (e.id === cleanExtId || e.runtimeId === cleanExtId));
            if (ext?.path) extensionPath = ext.path;
        }

        const storageMgr = getStorageManager();
        const tabReg = getTabRegistry();
        const actionMgr = getActionManager();
        const scriptMgr = getScriptingManager();

        if (method !== 'runtime.portPostMessage') {
            console.log(`[DEBUG-EXT] IpcBridge dispatch: method="${method}" ext="${cleanExtId}" tabId=${senderTabId}`);
        }

        switch (method) {
            case 'debug.log':
                console.log('[DEBUG-EXT content-script]:', args?.msg || args);
                return { success: true };

            case 'error.report': {
                try {
                    const { getExtensionErrorManager } = require('../ExtensionErrorManager');
                    const record = getExtensionErrorManager().reportError(cleanExtId, args);
                    return { success: !!record };
                } catch (err) {
                    console.warn('[IpcBridge] Error reporting failure:', err?.message || err);
                    return { success: false };
                }
            }

            // ==================== STORAGE ====================
            case 'storage.get':
            case 'storage.local.get':
                return storageMgr.get(pId, cleanExtId, args.area || 'local', args.keys);

            case 'storage.set':
            case 'storage.local.set':
                return storageMgr.set(pId, cleanExtId, args.area || 'local', args.items);

            case 'storage.remove':
            case 'storage.local.remove':
                return storageMgr.remove(pId, cleanExtId, args.area || 'local', args.keys);

            case 'storage.clear':
            case 'storage.local.clear':
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
                return tabReg.create(args.createProperties || {}, { ...sender, extensionId: cleanExtId });

            case 'tabs.update':
                return tabReg.update(args.tabId, args.updateProperties || {}, { ...sender, extensionId: cleanExtId });

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
                return tabReg.captureVisibleTab(sender, args.windowId, args.options);

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

            // ==================== ACTION, BROWSER_ACTION & PAGE_ACTION ====================
            case 'browserAction.closePopup':
            case 'pageAction.closePopup':
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

            case 'browserAction.setTitle':
            case 'pageAction.setTitle':
            case 'action.setTitle':
                return actionMgr.setTitle(cleanExtId, args);

            case 'browserAction.getTitle':
            case 'pageAction.getTitle':
            case 'action.getTitle':
                return actionMgr.getTitle(cleanExtId, args);

            case 'browserAction.setBadgeText':
            case 'pageAction.setBadgeText':
            case 'action.setBadgeText':
                return actionMgr.setBadgeText(cleanExtId, args);

            case 'browserAction.getBadgeText':
            case 'pageAction.getBadgeText':
            case 'action.getBadgeText':
                return actionMgr.getBadgeText(cleanExtId, args);

            case 'browserAction.setBadgeBackgroundColor':
            case 'pageAction.setBadgeBackgroundColor':
            case 'action.setBadgeBackgroundColor':
                return actionMgr.setBadgeBackgroundColor(cleanExtId, args);

            case 'browserAction.getBadgeBackgroundColor':
            case 'pageAction.getBadgeBackgroundColor':
            case 'action.getBadgeBackgroundColor':
                return actionMgr.getBadgeBackgroundColor(cleanExtId, args);

            case 'browserAction.setBadgeTextColor':
            case 'pageAction.setBadgeTextColor':
            case 'action.setBadgeTextColor':
                return actionMgr.setBadgeTextColor(cleanExtId, args);

            case 'browserAction.getBadgeTextColor':
            case 'pageAction.getBadgeTextColor':
            case 'action.getBadgeTextColor':
                return actionMgr.getBadgeTextColor(cleanExtId, args);

            case 'browserAction.setPopup':
            case 'pageAction.setPopup':
            case 'action.setPopup':
                return actionMgr.setPopup(cleanExtId, args);

            case 'browserAction.getPopup':
            case 'pageAction.getPopup':
            case 'action.getPopup':
                return actionMgr.getPopup(cleanExtId, args);

            case 'pageAction.show':
            case 'browserAction.enable':
            case 'action.enable':
                return actionMgr.enable(cleanExtId, args.tabId);

            case 'pageAction.hide':
            case 'browserAction.disable':
            case 'action.disable':
                return actionMgr.disable(cleanExtId, args.tabId);

            case 'browserAction.setIcon':
            case 'pageAction.setIcon':
            case 'action.setIcon':
                return actionMgr.setIcon(cleanExtId, args);

            // ==================== SCRIPTING ====================
            case 'scripting.executeScript':
                return scriptMgr.executeScript(cleanExtId, extensionPath, args);

            case 'scripting.insertCSS':
                return scriptMgr.insertCSS(cleanExtId, extensionPath, args);

            case 'scripting.removeCSS':
                return scriptMgr.removeCSS(cleanExtId, extensionPath, args);

            case 'scripting.registerContentScripts':
                return scriptMgr.registerContentScripts(cleanExtId, extensionPath, args.scripts || (Array.isArray(args) ? args : []));

            case 'scripting.getRegisteredContentScripts':
                return scriptMgr.getRegisteredContentScripts(cleanExtId, args.filter);

            case 'scripting.unregisterContentScripts':
                return scriptMgr.unregisterContentScripts(cleanExtId, args.filter);

            case 'scripting.updateContentScripts':
                return scriptMgr.updateContentScripts(cleanExtId, extensionPath, args.scripts || (Array.isArray(args) ? args : []));

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
                const messageId = args.messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).slice(2));
                const rawTabId = args.tabId || senderTabId;
                const effectiveTabId = (rawTabId && Number(rawTabId) > 0) ? rawTabId : tabReg.getActiveTab()?.id;
                const senderTab = effectiveTabId ? await tabReg.get(effectiveTabId).catch(() => null) : null;
                const senderObj = {
                    id: cleanExtId,
                    url: senderTab ? senderTab.url : (effectiveTabId ? (await tabReg.get(effectiveTabId).catch(() => null))?.url : `chrome-extension://${cleanExtId}/`),
                    tab: senderTab || (effectiveTabId ? { id: Number(effectiveTabId), url: (effectiveTabId ? (await tabReg.get(effectiveTabId).catch(() => null))?.url : '') || '' } : null),
                };

                const responsePromise = new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        if (this.pendingMessageResolvers.has(messageId)) {
                            this.pendingMessageResolvers.delete(messageId);
                            resolve(undefined);
                        }
                    }, 10000);

                    this.pendingMessageResolvers.set(messageId, (responsePayload) => {
                        clearTimeout(timer);
                        this.pendingMessageResolvers.delete(messageId);
                        resolve(responsePayload);
                    });
                });

                // Dispatch to the extension's worker and pages (excluding the sender WebContents)
                const senderWcId = sender?.senderWebContents?.id || null;
                this.broadcastEvent(targetId, 'chrome.runtime.onMessage', [message, senderObj], { messageId, senderWcId });

                return await responsePromise;
            }

            case 'runtime.sendResponse': {
                const { messageId, response } = args || {};
                if (messageId && this.pendingMessageResolvers.has(messageId)) {
                    const resolver = this.pendingMessageResolvers.get(messageId);
                    resolver(response);
                    return { success: true };
                }
                return { success: false };
            }

            case 'runtime.connect': {
                const targetId = args.targetExtId || cleanExtId;
                const portId = args.portId || `port_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const rawTabId = args.tabId || senderTabId;
                const effectiveTabId = (rawTabId && Number(rawTabId) > 0) ? rawTabId : tabReg.getActiveTab()?.id;
                const senderTab = effectiveTabId ? await tabReg.get(effectiveTabId).catch(() => null) : null;
                const senderObj = {
                    id: cleanExtId,
                    url: senderTab ? senderTab.url : (effectiveTabId ? (await tabReg.get(effectiveTabId).catch(() => null))?.url : `chrome-extension://${cleanExtId}/`),
                    tab: senderTab || (effectiveTabId ? { id: Number(effectiveTabId), url: (effectiveTabId ? (await tabReg.get(effectiveTabId).catch(() => null))?.url : '') || '' } : null),
                };
                if (senderObj.tab && (!senderObj.tab.width || !senderObj.tab.height)) {
                    const activeT = tabReg.getActiveTab();
                    senderObj.tab.width = senderObj.tab.width || activeT?.width || 1280;
                    senderObj.tab.height = senderObj.tab.height || activeT?.height || 800;
                }
                this.activePorts.set(portId, {
                    portId,
                    name: args.name || '',
                    targetExtId: targetId,
                    sourceExtId: cleanExtId,
                    sourceTabId: senderTab?.id || (effectiveTabId ? Number(effectiveTabId) : null),
                    targetTabId: senderTab?.id || (effectiveTabId ? Number(effectiveTabId) : null),
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
                const callerTabId = (args.tabId != null && Number(args.tabId) > 0) ? Number(args.tabId) : (senderTabId ? Number(senderTabId) : null);
                const sourceTabId = portInfo?.sourceTabId || portInfo?.targetTabId || null;

                // Determine direction: Did the message originate from the Tab (Side A) or Extension Worker/Pages (Side B)?
                const isFromTab = Boolean(callerTabId && sourceTabId && callerTabId === sourceTabId);

                if (isFromTab) {
                    // Forward ONLY to Extension Worker and Extension Pages (Side B). DO NOT echo back to the tab!
                    const targetExt = portInfo ? portInfo.targetExtId : cleanExtId;
                    this.broadcastEvent(targetExt, `chrome.runtime.portOnMessage_${portId}`, [message]);
                } else {
                    // Forward ONLY to the Tab (Side A). DO NOT echo back to Extension Worker/Pages!
                    const tabIdToDeliver = sourceTabId || callerTabId;
                    if (tabIdToDeliver) {
                        const resolved = tabReg.resolveTab(tabIdToDeliver);
                        if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                            resolved.webContents.send('invisurf-ext-event', {
                                eventName: `chrome.runtime.portOnMessage_${portId}`,
                                args: [message],
                            });
                        }
                    }
                }
                return true;
            }

            case 'runtime.portDisconnect': {
                const { portId } = args;
                if (!portId) return false;
                const portInfo = this.activePorts.get(portId);
                const callerTabId = (args.tabId != null && Number(args.tabId) > 0) ? Number(args.tabId) : (senderTabId ? Number(senderTabId) : null);
                const sourceTabId = portInfo?.sourceTabId || portInfo?.targetTabId || null;

                const isFromTab = Boolean(callerTabId && sourceTabId && callerTabId === sourceTabId);

                if (isFromTab) {
                    const targetExt = portInfo ? portInfo.targetExtId : cleanExtId;
                    this.broadcastEvent(targetExt, `chrome.runtime.portOnDisconnect_${portId}`, []);
                } else {
                    const tabIdToDeliver = sourceTabId || callerTabId;
                    if (tabIdToDeliver) {
                        const resolved = tabReg.resolveTab(tabIdToDeliver);
                        if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                            resolved.webContents.send('invisurf-ext-event', {
                                eventName: `chrome.runtime.portOnDisconnect_${portId}`,
                                args: [],
                            });
                        }
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

            // ==================== WEB NAVIGATION ====================
            case 'webNavigation.getAllFrames': {
                const { tabId } = args;
                const resolved = tabReg.resolveTab(tabId);
                if (!resolved?.webContents || resolved.webContents.isDestroyed()) {
                    return [];
                }
                const wc = resolved.webContents;
                const main = wc.mainFrame;
                if (!main) {
                    return [{ frameId: 0, parentFrameId: -1, url: wc.getURL() || '', errorOccurred: false }];
                }
                const framesInSubtree = main.framesInSubtree || [main];
                const frameList = [];
                let nextFrameId = 1;
                const frameIdMap = new Map();
                frameIdMap.set(main, 0);

                for (const f of framesInSubtree) {
                    if (f !== main) {
                        const fId = f.routingId || nextFrameId++;
                        frameIdMap.set(f, fId);
                    }
                }

                for (const f of framesInSubtree) {
                    const isMain = f === main;
                    const fId = frameIdMap.get(f) ?? 0;
                    const parentId = isMain ? -1 : (f.parent ? (frameIdMap.get(f.parent) ?? 0) : 0);
                    frameList.push({
                        frameId: fId,
                        parentFrameId: parentId,
                        url: f.url || (isMain ? wc.getURL() || '' : ''),
                        errorOccurred: false,
                    });
                }
                return frameList;
            }

            case 'webNavigation.getFrame': {
                const { tabId, frameId } = args;
                const resolved = tabReg.resolveTab(tabId);
                if (!resolved?.webContents || resolved.webContents.isDestroyed()) {
                    return null;
                }
                const wc = resolved.webContents;
                const main = wc.mainFrame;
                if (!main) return null;
                const targetFrameId = Number(frameId) || 0;
                if (targetFrameId === 0) {
                    return { frameId: 0, parentFrameId: -1, url: main.url || wc.getURL() || '', errorOccurred: false };
                }
                const framesInSubtree = main.framesInSubtree || [];
                for (const f of framesInSubtree) {
                    if (f.routingId === targetFrameId) {
                        return {
                            frameId: targetFrameId,
                            parentFrameId: f.parent ? 0 : -1,
                            url: f.url || '',
                            errorOccurred: false,
                        };
                    }
                }
                return null;
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
                return getWindowManager().create(args.createData, { ...sender, extensionId: cleanExtId });
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

            // ==================== SESSIONS ====================
            case 'sessions.getRecentlyClosed':
                return getSessionManager().getRecentlyClosed(pId, args.filter);
            case 'sessions.restore':
                return getSessionManager().restore(pId, args.sessionId, sender);
            case 'sessions.getDevices':
                return getSessionManager().getDevices(pId, args.filter);
            case 'sessions.setTabValue':
                return getSessionManager().setTabValue(args.tabId, args.key, args.value);
            case 'sessions.getTabValue':
                return getSessionManager().getTabValue(args.tabId, args.key);
            case 'sessions.setWindowValue':
                return getSessionManager().setWindowValue(args.windowId, args.key, args.value);
            case 'sessions.getWindowValue':
                return getSessionManager().getWindowValue(args.windowId, args.key);

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

            // ==================== PROXY ====================
            case 'proxy.settings.get':
                return getProxyManager().get(pId, args);
            case 'proxy.settings.set':
                return getProxyManager().set(pId, cleanExtId, args);
            case 'proxy.settings.clear':
                return getProxyManager().clear(pId, cleanExtId, args);

            // ==================== BROWSING DATA ====================
            case 'browsingData.settings':
                return getBrowsingDataManager().settings();
            case 'browsingData.remove':
                return getBrowsingDataManager().remove(pId, args.options, args.dataToRemove);
            case 'browsingData.removeAppcache':
                return getBrowsingDataManager().removeAppcache(pId, args.options);
            case 'browsingData.removeCache':
                return getBrowsingDataManager().removeCache(pId, args.options);
            case 'browsingData.removeCookies':
                return getBrowsingDataManager().removeCookies(pId, args.options);
            case 'browsingData.removeDownloads':
                return getBrowsingDataManager().removeDownloads(pId, args.options);
            case 'browsingData.removeFileSystems':
                return getBrowsingDataManager().removeFileSystems(pId, args.options);
            case 'browsingData.removeFormData':
                return getBrowsingDataManager().removeFormData(pId, args.options);
            case 'browsingData.removeHistory':
                return getBrowsingDataManager().removeHistory(pId, args.options);
            case 'browsingData.removeIndexedDB':
                return getBrowsingDataManager().removeIndexedDB(pId, args.options);
            case 'browsingData.removeLocalStorage':
                return getBrowsingDataManager().removeLocalStorage(pId, args.options);
            case 'browsingData.removePasswords':
                return getBrowsingDataManager().removePasswords(pId, args.options);
            case 'browsingData.removePluginData':
                return getBrowsingDataManager().removePluginData(pId, args.options);
            case 'browsingData.removeServiceWorkers':
                return getBrowsingDataManager().removeServiceWorkers(pId, args.options);
            case 'browsingData.removeWebSQL':
                return getBrowsingDataManager().removeWebSQL(pId, args.options);

            // ==================== IDLE ====================
            case 'idle.queryState':
                return getIdleManager().queryState(cleanExtId, args.detectionIntervalInSeconds);
            case 'idle.setDetectionInterval':
                return getIdleManager().setDetectionInterval(cleanExtId, args.intervalInSeconds);
            case 'idle.getAutoLockDelay':
                return getIdleManager().getAutoLockDelay();

            // ==================== POWER ====================
            case 'power.requestKeepAwake':
                return getPowerManager().requestKeepAwake(cleanExtId, args.level);
            case 'power.releaseKeepAwake':
                return getPowerManager().releaseKeepAwake(cleanExtId);

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
