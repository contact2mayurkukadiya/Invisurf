const EventEmitter = require('events');
const { desktopCapturer, BrowserWindow } = require('electron');
const State = require('../../state');
const { getTabRegistry } = require('./TabRegistry');
const { applyContentProtection } = require('../../../runtime/windowSecurity');
const { loadSettings } = require('../../services/settingsService');

/**
 * MediaCaptureManager
 * Implements chrome.desktopCapture and chrome.tabCapture for Chrome extensions.
 * Provides internal compositor and desktop stream resolution while safely coordinating
 * with InviSurf's Content Protection / DRM switch and presenting an interactive
 * native source picker modal for Loom, Screencastify, and web apps.
 */
class MediaCaptureManager extends EventEmitter {
    constructor() {
        super();
        this.requestIdCounter = 1000;
        this.activeRequests = new Map(); // requestId -> requestDetails
        this.activeCaptures = new Map(); // streamId -> captureDetails
        this.activeWindowDrmOverrides = new Map(); // windowId -> Set<streamId>
        this.pendingPickerRequests = new Map(); // requestId -> pendingPickerDetails
    }

    /**
     * Resolves the matching InviSurf BrowserWindow for a given tabId or windowId.
     */
    _resolveWindowForTab(tabId) {
        if (!tabId) return null;
        const resolved = getTabRegistry().resolveTab(tabId);
        if (resolved?.window) return resolved.window;
        const focused = BrowserWindow.getFocusedWindow() || State.mainWindow;
        return focused && !focused.isDestroyed() ? focused : null;
    }

    /**
     * Resolves the active window context (with contentView and overlay views).
     */
    _resolveContext(sender = {}, targetTab = null) {
        let context = null;
        if (sender?.senderWebContents) {
            try {
                const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
                context = getWindowContextByEventSender(sender.senderWebContents);
            } catch (_) {}
        }
        if (!context && targetTab?.id) {
            const resolved = getTabRegistry().resolveTab(targetTab.id);
            if (resolved?.context) context = resolved.context;
        }
        if (!context) {
            const { getFocusedShellWindow } = require('../../windows/windowContextUtils');
            const focused = getFocusedShellWindow() || State.mainWindow;
            if (focused?.id) {
                context = State.windowContextsById.get(focused.id);
            }
        }
        if (!context && State.windowContextsById.size > 0) {
            context = State.windowContextsById.values().next().value;
        }
        return context;
    }

    /**
     * Temporarily suspends content protection for a window during active capture,
     * restoring it automatically when all streams for that window stop.
     */
    _temporarilySuspendDrmForWindow(win, streamId) {
        if (!win || win.isDestroyed()) return;
        const settings = loadSettings();
        if (!settings?.contentProtection) return;

        const winId = win.id;
        let streams = this.activeWindowDrmOverrides.get(winId);
        if (!streams) {
            streams = new Set();
            this.activeWindowDrmOverrides.set(winId, streams);
        }
        streams.add(streamId);

        // Suspend protection so the authorized extension can capture pixels
        try {
            applyContentProtection(win, false);
        } catch (_) {}
    }

    /**
     * Restores content protection for a window when capture ends.
     */
    _restoreDrmForWindow(winId, streamId) {
        const streams = this.activeWindowDrmOverrides.get(winId);
        if (streams) {
            streams.delete(streamId);
            if (streams.size === 0) {
                this.activeWindowDrmOverrides.delete(winId);
                const win = BrowserWindow.fromId(Number(winId));
                if (win && !win.isDestroyed()) {
                    const settings = loadSettings();
                    if (settings?.contentProtection) {
                        try {
                            applyContentProtection(win, true);
                        } catch (_) {}
                    }
                }
            }
        }
    }

    /**
     * chrome.desktopCapture.chooseDesktopMedia(sources, targetTab, callback)
     * Queries available desktop and window sources, includes open tabs with live previews,
     * presents the interactive source picker dialog, and returns an authorized streamId and requestId.
     */
    async chooseDesktopMedia(extensionId, sources = ['screen', 'window', 'tab'], targetTab = null, sender = {}) {
        this.requestIdCounter += 1;
        const requestId = this.requestIdCounter;

        const requestedSources = Array.isArray(sources) ? sources : ['screen', 'window', 'tab'];
        const includeScreen = requestedSources.includes('screen');
        const includeWindow = requestedSources.includes('window');
        const includeTab = requestedSources.includes('tab');

        const electronTypes = [];
        if (includeScreen) electronTypes.push('screen');
        if (includeWindow) electronTypes.push('window');
        if (electronTypes.length === 0) electronTypes.push('screen', 'window');

        let rawDesktopSources = [];
        try {
            rawDesktopSources = await desktopCapturer.getSources({
                types: electronTypes,
                thumbnailSize: { width: 480, height: 270 },
                fetchWindowIcons: true,
            });
        } catch (err) {
            console.error('[MediaCaptureManager] Failed to fetch desktop sources:', err);
        }

        const screenSources = rawDesktopSources
            .filter((s) => s.id.startsWith('screen:'))
            .map((s) => ({
                id: s.id,
                name: s.name || 'Entire Screen',
                thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
                appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
                type: 'screen',
            }));

        const windowSources = rawDesktopSources
            .filter((s) => s.id.startsWith('window:') && !s.name?.includes('InviSurf Overlay'))
            .map((s) => ({
                id: s.id,
                name: s.name || 'Window',
                thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
                appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
                type: 'window',
            }));

        // Gather open tabs with live thumbnails if tab capture is requested
        let tabSources = [];
        if (includeTab) {
            try {
                const openTabs = await getTabRegistry().query({});
                for (const t of openTabs) {
                    let thumbnail = '';
                    const resolved = getTabRegistry().resolveTab(t.id);
                    if (resolved?.view?.webContents && !resolved.view.webContents.isDestroyed()) {
                        try {
                            const img = await resolved.view.webContents.capturePage();
                            if (img && !img.isEmpty()) {
                                thumbnail = img.toDataURL();
                            }
                        } catch (_) {}
                    }
                    tabSources.push({
                        id: `tab:${t.id}`,
                        tabId: t.id,
                        name: t.title || t.url || `Tab ${t.id}`,
                        url: t.url || '',
                        favicon: t.favIconUrl || '',
                        thumbnail,
                        type: 'tab',
                        windowId: t.windowId,
                    });
                }
            } catch (_) {}
        }

        // Resolve requester information (extension name and icon)
        let requesterName = 'Extension';
        let requesterIcon = '';
        if (extensionId) {
            try {
                const ExtensionStorage = require('../ExtensionStorage');
                const ext = ExtensionStorage.loadExtension(extensionId);
                if (ext) {
                    requesterName = ext.manifest?.name || ext.name || 'Extension';
                    if (ext.icons) {
                        requesterIcon = ext.icons['128'] || ext.icons['48'] || ext.icons['32'] || '';
                    }
                }
            } catch (_) {}
        }

        const context = this._resolveContext(sender, targetTab);

        // Fallback for headless environments or automated tests without a window
        if (!context?.window || context.window.isDestroyed()) {
            return this._fallbackAutoSelect(requestId, extensionId, rawDesktopSources, tabSources, requestedSources, targetTab);
        }

        // Show the interactive native source picker overlay
        const overlayManager = require('../../windows/overlayManager');
        return new Promise((resolve, reject) => {
            this.pendingPickerRequests.set(requestId, {
                requestId,
                resolve,
                reject,
                context,
                extensionId,
                rawDesktopSources,
                tabSources,
                requestedSources,
                targetTab,
                isDisplayMedia: false,
            });

            overlayManager.showDesktopMediaPickerOverlay(context, {
                requestId,
                requesterName,
                requesterIcon,
                canRequestAudio: requestedSources.includes('audio'),
                sources: {
                    screens: screenSources,
                    windows: windowSources,
                    tabs: tabSources,
                },
                targetTabId: targetTab?.id || null,
            });
        });
    }

    /**
     * Fallback auto-selection for headless testing environments.
     */
    _fallbackAutoSelect(requestId, extensionId, rawDesktopSources, tabSources, requestedSources, targetTab) {
        let chosenSource = null;
        if (rawDesktopSources.length > 0) {
            chosenSource = rawDesktopSources[0];
        } else if (targetTab?.id) {
            chosenSource = tabSources.find((s) => s.tabId === targetTab.id);
        } else if (tabSources.length > 0) {
            chosenSource = tabSources[0];
        }

        const streamId = chosenSource ? chosenSource.id : 'screen:0:0';
        const targetTabId = targetTab?.id || chosenSource?.tabId || null;

        this.activeRequests.set(requestId, {
            requestId,
            extensionId,
            streamId,
            sources: requestedSources,
            targetTab,
            chosenSource,
            createdAt: Date.now(),
        });

        this.activeCaptures.set(streamId, {
            streamId,
            tabId: targetTabId,
            extensionId,
            status: 'active',
            startedAt: Date.now(),
        });

        if (targetTabId) {
            this._broadcastCaptureStatus(targetTabId, 'active');
        }

        return Promise.resolve({
            requestId,
            streamId,
            options: {
                canRequestAudioTrack: requestedSources.includes('audio'),
            },
        });
    }

    /**
     * Handles interactive picker responses from the overlay layer.
     */
    handlePickerResponse(data) {
        const { requestId, cancelled, sourceId, sourceKind, tabId, shareAudio } = data;
        const pending = this.pendingPickerRequests.get(requestId);
        if (!pending) return;
        this.pendingPickerRequests.delete(requestId);

        // Case A: Web App Display Media (navigator.mediaDevices.getDisplayMedia)
        if (pending.isDisplayMedia) {
            if (cancelled || !sourceId) {
                if (typeof pending.callback === 'function') {
                    pending.callback({ video: null });
                }
                return;
            }

            let matchingSource = null;
            if (sourceKind === 'tab' && tabId) {
                const hostWin = this._resolveWindowForTab(tabId);
                const winName = hostWin?.getTitle();
                matchingSource = pending.rawDesktopSources?.find((s) => s.name === winName) || pending.rawDesktopSources?.[0];
            } else {
                matchingSource = pending.rawDesktopSources?.find((s) => s.id === sourceId) || pending.rawDesktopSources?.[0];
            }

            if (typeof pending.callback === 'function') {
                pending.callback({
                    video: matchingSource || null,
                    audio: shareAudio ? 'loopback' : null,
                });
            }
            return;
        }

        // Case B: Extension Desktop Capture (chrome.desktopCapture)
        if (cancelled || !sourceId) {
            pending.resolve({
                requestId,
                streamId: '',
                options: {},
            });
            return;
        }

        let actualStreamId = sourceId;
        let chosenTabId = tabId || null;

        // Map tab selection to host window streamId so getUserMedia natively succeeds in WebRTC
        if (sourceKind === 'tab' || sourceId.startsWith('tab:')) {
            const numericTabId = tabId || Number(sourceId.replace('tab:', ''));
            chosenTabId = numericTabId;
            const hostWin = this._resolveWindowForTab(numericTabId);
            if (hostWin && pending.rawDesktopSources?.length > 0) {
                const winName = hostWin.getTitle();
                const matched = pending.rawDesktopSources.find((s) => s.name === winName);
                if (matched?.id) {
                    actualStreamId = matched.id;
                } else {
                    const firstWin = pending.rawDesktopSources.find((s) => s.id.startsWith('window:'));
                    actualStreamId = firstWin?.id || pending.rawDesktopSources[0].id;
                }
            }
        }

        // Suspend DRM if window capture
        if (actualStreamId?.startsWith('window:')) {
            const hostWin = this._resolveWindowForTab(chosenTabId);
            if (hostWin) {
                this._temporarilySuspendDrmForWindow(hostWin, actualStreamId);
            }
        }

        // Record active request & capture
        this.activeRequests.set(requestId, {
            requestId,
            extensionId: pending.extensionId,
            streamId: actualStreamId,
            sources: pending.requestedSources,
            targetTab: pending.targetTab,
            chosenTabId,
            sourceKind,
            createdAt: Date.now(),
        });

        this.activeCaptures.set(actualStreamId, {
            streamId: actualStreamId,
            tabId: chosenTabId,
            extensionId: pending.extensionId,
            status: 'active',
            startedAt: Date.now(),
        });

        if (chosenTabId) {
            this._broadcastCaptureStatus(chosenTabId, 'active');
        }

        pending.resolve({
            requestId,
            streamId: actualStreamId,
            options: {
                canRequestAudioTrack: !!shareAudio,
                targetTabId: chosenTabId,
            },
        });
    }

    /**
     * Handles picker cancellation via escape key, backdrop dismiss, or close button.
     */
    handlePickerCancel(requestId) {
        const pending = this.pendingPickerRequests.get(requestId);
        if (!pending) return;
        this.pendingPickerRequests.delete(requestId);

        if (pending.isDisplayMedia) {
            if (typeof pending.callback === 'function') {
                pending.callback({ video: null });
            }
            return;
        }

        pending.resolve({
            requestId,
            streamId: '',
            options: {},
        });
    }

    /**
     * chrome.desktopCapture.cancelChooseDesktopMedia(requestId)
     */
    cancelChooseDesktopMedia(requestId) {
        const id = Number(requestId);
        if (this.pendingPickerRequests.has(id)) {
            const pending = this.pendingPickerRequests.get(id);
            if (pending?.context) {
                try {
                    const overlayManager = require('../../windows/overlayManager');
                    overlayManager.hideDesktopMediaPickerOverlay(pending.context);
                } catch (_) {}
            }
            this.handlePickerCancel(id);
            return true;
        }

        const req = this.activeRequests.get(id);
        if (!req) return false;

        this.activeRequests.delete(id);
        if (req.streamId) {
            this.stopCapture(req.streamId);
        }
        return true;
    }

    /**
     * chrome.tabCapture.getMediaStreamId(options)
     * Directly generates a mediaStreamId for capturing a tab without showing a full desktop dialog.
     */
    async getMediaStreamId(options = {}, sender = {}) {
        let targetTabId = options.targetTabId;
        if (!targetTabId) {
            const active = getTabRegistry().getActiveTab();
            if (active) targetTabId = active.id;
        }

        let streamId = `tab:${targetTabId || Date.now()}`;

        // Locate window source for Electron fallback
        try {
            const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
            const hostWin = this._resolveWindowForTab(targetTabId);
            if (hostWin && sources.length > 0) {
                const winName = hostWin.getTitle();
                const matched = sources.find((s) => s.name === winName) || sources[0];
                if (matched?.id) {
                    streamId = matched.id;
                }
            } else if (sources.length > 0) {
                streamId = sources[0].id;
            }
        } catch (_) {}

        this.activeCaptures.set(streamId, {
            streamId,
            tabId: targetTabId,
            status: 'active',
            startedAt: Date.now(),
        });

        if (targetTabId) {
            this._broadcastCaptureStatus(targetTabId, 'active');
        }

        return streamId;
    }

    /**
     * chrome.tabCapture.capture(options)
     */
    async captureTab(options = {}, sender = {}) {
        const streamId = await this.getMediaStreamId(options, sender);
        return {
            ok: true,
            streamId,
            audio: !!options.audio,
            video: options.video !== false,
        };
    }

    /**
     * chrome.tabCapture.getCapturedTabs()
     */
    getCapturedTabs() {
        const results = [];
        for (const cap of this.activeCaptures.values()) {
            if (cap.tabId) {
                results.push({
                    tabId: cap.tabId,
                    status: cap.status || 'active',
                });
            }
        }
        return results;
    }

    /**
     * Stops an active capture stream and restores DRM protections if needed.
     */
    stopCapture(streamId) {
        const cap = this.activeCaptures.get(streamId);
        if (!cap) return;

        cap.status = 'stopped';
        this.activeCaptures.delete(streamId);

        // Restore DRM if this stream suspended it on any window
        for (const [winId, streams] of this.activeWindowDrmOverrides.entries()) {
            if (streams.has(streamId)) {
                this._restoreDrmForWindow(winId, streamId);
            }
        }

        if (cap.tabId) {
            this._broadcastCaptureStatus(cap.tabId, 'stopped');
        }
    }

    /**
     * Handles Electron session display media request (navigator.mediaDevices.getDisplayMedia).
     * Routes through the interactive source picker dialog.
     */
    async handleDisplayMediaRequest(request, callback) {
        this.requestIdCounter += 1;
        const requestId = this.requestIdCounter;

        let rawDesktopSources = [];
        try {
            rawDesktopSources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 480, height: 270 },
                fetchWindowIcons: true,
            });
        } catch (err) {
            console.error('[MediaCaptureManager] handleDisplayMediaRequest error:', err);
        }

        const screenSources = rawDesktopSources
            .filter((s) => s.id.startsWith('screen:'))
            .map((s) => ({
                id: s.id,
                name: s.name || 'Entire Screen',
                thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
                appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
                type: 'screen',
            }));

        const windowSources = rawDesktopSources
            .filter((s) => s.id.startsWith('window:') && !s.name?.includes('InviSurf Overlay'))
            .map((s) => ({
                id: s.id,
                name: s.name || 'Window',
                thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
                appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
                type: 'window',
            }));

        let tabSources = [];
        try {
            const openTabs = await getTabRegistry().query({});
            for (const t of openTabs) {
                let thumbnail = '';
                const resolved = getTabRegistry().resolveTab(t.id);
                if (resolved?.view?.webContents && !resolved.view.webContents.isDestroyed()) {
                    try {
                        const img = await resolved.view.webContents.capturePage();
                        if (img && !img.isEmpty()) {
                            thumbnail = img.toDataURL();
                        }
                    } catch (_) {}
                }
                tabSources.push({
                    id: `tab:${t.id}`,
                    tabId: t.id,
                    name: t.title || t.url || `Tab ${t.id}`,
                    url: t.url || '',
                    favicon: t.favIconUrl || '',
                    thumbnail,
                    type: 'tab',
                    windowId: t.windowId,
                });
            }
        } catch (_) {}

        const context = this._resolveContext();

        if (!context?.window || context.window.isDestroyed()) {
            if (rawDesktopSources.length > 0) {
                callback({ video: rawDesktopSources[0], audio: 'loopback' });
            } else {
                callback({ video: null });
            }
            return;
        }

        const overlayManager = require('../../windows/overlayManager');
        this.pendingPickerRequests.set(requestId, {
            requestId,
            callback,
            context,
            rawDesktopSources,
            tabSources,
            isDisplayMedia: true,
        });

        overlayManager.showDesktopMediaPickerOverlay(context, {
            requestId,
            requesterName: 'Web Application',
            requesterIcon: '',
            canRequestAudio: true,
            sources: {
                screens: screenSources,
                windows: windowSources,
                tabs: tabSources,
            },
        });
    }

    _broadcastCaptureStatus(tabId, status) {
        const info = {
            tabId,
            status,
            fullscreen: false,
        };
        this.emit('tab-capture-status-changed', { info });
        try {
            const { getIpcBridge } = require('./IpcBridge');
            getIpcBridge().broadcastToAllExtensions('chrome.tabCapture.onStatusChanged', [info]);
        } catch (_) {}
    }
}

let instance = null;
function getMediaCaptureManager() {
    if (!instance) {
        instance = new MediaCaptureManager();
    }
    return instance;
}

module.exports = {
    MediaCaptureManager,
    getMediaCaptureManager,
};
