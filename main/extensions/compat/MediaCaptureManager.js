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
function isLoopbackAudioSupported() {
    if (process.platform === 'win32') return true;
    if (process.platform === 'darwin') {
        try {
            const os = require('os');
            const release = os.release() || '';
            const majorDarwin = parseInt(release.split('.')[0] || '0', 10);
            return majorDarwin >= 22; // macOS 13.0 Ventura+
        } catch (_) {
            return false;
        }
    }
    return false;
}

class MediaCaptureManager extends EventEmitter {
    constructor() {
        super();
        this.requestIdCounter = 1000;
        this.activeRequests = new Map(); // requestId -> requestDetails
        this.activeCaptures = new Map(); // streamId -> captureDetails
        this.activeWindowDrmOverrides = new Map(); // windowId -> Set<streamId>
        this.pendingPickerRequests = new Map(); // requestId -> pendingPickerDetails
        this._singleActiveScreenShare = null;
        this.activeScreenShares = new Map(); // requestingWcId -> screenShareSession
        this.pendingDirectTabShares = new Map(); // requestingWcId -> { targetFrame, shareAudio }
    }

    get activeScreenShare() {
        if (this._singleActiveScreenShare) return this._singleActiveScreenShare;
        if (this.activeScreenShares.size > 0) {
            return this.activeScreenShares.values().next().value;
        }
        return null;
    }

    set activeScreenShare(val) {
        this._singleActiveScreenShare = val;
        if (val && val.requestingWcId) {
            this.activeScreenShares.set(val.requestingWcId, val);
        } else if (!val) {
            this.activeScreenShares.clear();
        }
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
            } catch (_) { }
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
            if (typeof win.once === 'function') {
                win.once('closed', () => {
                    this.activeWindowDrmOverrides.delete(winId);
                });
            }
        }
        streams.add(streamId);

        // Suspend protection so the authorized extension can capture pixels
        try {
            applyContentProtection(win, false);
        } catch (_) { }
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
                        } catch (_) { }
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
    async chooseDesktopMedia(extensionId, sources = ['screen', 'window', 'tab'], targetTab = null, sender = {}, clientRequestId = null) {
        let requestId;
        if (clientRequestId && Number.isFinite(Number(clientRequestId))) {
            requestId = Number(clientRequestId);
        } else {
            this.requestIdCounter += 1;
            requestId = this.requestIdCounter;
        }

        const requestedSources = Array.isArray(sources) ? sources : ['screen', 'window', 'tab'];
        const includeScreen = requestedSources.includes('screen');
        const includeWindow = requestedSources.includes('window');
        const includeTab = requestedSources.includes('tab');

        const electronTypes = [];
        if (includeScreen) electronTypes.push('screen');
        if (includeWindow) electronTypes.push('window');
        if (electronTypes.length === 0 && !includeTab) electronTypes.push('screen', 'window');

        let rawDesktopSources = [];
        if (electronTypes.length > 0) {
            try {
                if (desktopCapturer && typeof desktopCapturer.getSources === 'function') {
                    rawDesktopSources = await desktopCapturer.getSources({
                        types: electronTypes,
                        thumbnailSize: { width: 480, height: 270 },
                        fetchWindowIcons: true,
                    });
                }
            } catch (err) {
                console.error('[MediaCaptureManager] Failed to fetch desktop sources:', err);
            }
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
            tabSources = await this._gatherTabSources();
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
            } catch (_) { }
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
                supportsSystemAudio: isLoopbackAudioSupported(),
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

        if (pending.cleanupRequestingDestroyed) pending.cleanupRequestingDestroyed();
        if (pending.cleanupWindowClosed) pending.cleanupWindowClosed();

        // Case A: Web App Display Media (navigator.mediaDevices.getDisplayMedia)
        if (pending.isDisplayMedia) {
            if (cancelled || !sourceId) {
                if (typeof pending.callback === 'function') {
                    // Electron requires an empty dictionary {} to cleanly reject/cancel display media request without crashing.
                    // Passing { video: null } triggers an uncatchable C++ TypeError: "video must be a WebFrameMain or DesktopCapturerSource".
                    try {
                        pending.callback({});
                    } catch (_) { }
                }
                return;
            }

            // Tab sharing: capture the selected tab directly via WebFrameMain (not the entire window)
            if (sourceKind === 'tab' && (tabId || sourceId)) {
                const targetId = tabId || (sourceId.startsWith('tab:') ? sourceId.replace('tab:', '') : sourceId);
                const tabManager = require('../../windows/tabManager');
                let resolved = getTabRegistry().resolveTab(targetId);
                const stringTabId = resolved?.stringTabId || (typeof targetId === 'string' ? targetId : State.webContentsIdToTabId.get(Number(targetId)));

                if (stringTabId) {
                    // Activate or wake the tab so it is attached to the view hierarchy and rendering frames
                    try {
                        tabManager.activateOrWakeTab(stringTabId);
                        resolved = getTabRegistry().resolveTab(stringTabId);
                    } catch (err) {
                        console.warn('[MediaCaptureManager] activateOrWakeTab error:', err);
                    }
                }

                const targetWc = resolved?.view?.webContents || resolved?.webContents;
                if (targetWc && !targetWc.isDestroyed() && targetWc.mainFrame) {
                    let sharedHost = '';
                    try {
                        const u = resolved?.url || (typeof targetWc.getURL === 'function' ? targetWc.getURL() : '');
                        if (u) sharedHost = new URL(u).host || u;
                    } catch (_) { }

                    const sharedTitle = resolved?.title || (typeof targetWc.getTitle === 'function' ? targetWc.getTitle() : '') || 'Shared Tab';

                    this.activeScreenShare = {
                        active: true,
                        sourceKind: 'tab',
                        sharedTabId: stringTabId || targetId,
                        sharedHost: sharedHost || 'Shared Tab',
                        sharedTitle,
                        requestingTabId: pending.requestingTabId || null,
                        requestingHost: pending.requesterHost || 'Meeting',
                        requestingWcId: pending.requestingWc?.id || null,
                        targetWcId: targetWc.id,
                        shareAudio: !!shareAudio,
                        startedAt: Date.now(),
                    };

                    const hostWin = this._resolveWindowForTab(stringTabId || targetId);
                    if (hostWin) {
                        const drmStreamId = `screenShare:${pending.requestingWc?.id || requestId}`;
                        this._temporarilySuspendDrmForWindow(hostWin, drmStreamId);
                        this.activeScreenShare.suspendedDrmWinId = hostWin.id;
                        this.activeScreenShare.drmStreamId = drmStreamId;
                    }

                    if (typeof targetWc.once === 'function') {
                        const cleanupTarget = () => {
                            if (this.activeScreenShare?.targetWcId === targetWc.id) {
                                this.stopScreenShare();
                            }
                        };
                        targetWc.once('destroyed', cleanupTarget);
                        targetWc.once('render-process-gone', cleanupTarget);

                        const handleTargetNavigated = (_event, newUrl) => {
                            if (this.activeScreenShare?.targetWcId === targetWc.id) {
                                try {
                                    if (newUrl) {
                                        this.activeScreenShare.sharedHost = new URL(newUrl).host || newUrl;
                                    }
                                    this.activeScreenShare.sharedTitle = (typeof targetWc.getTitle === 'function' ? targetWc.getTitle() : '') || this.activeScreenShare.sharedHost;
                                    this._broadcastScreenShareStatus();
                                } catch (_) { }
                            }
                        };

                        const handleTitleUpdated = (_event, newTitle) => {
                            if (this.activeScreenShare?.targetWcId === targetWc.id) {
                                this.activeScreenShare.sharedTitle = newTitle || this.activeScreenShare.sharedTitle;
                                this._broadcastScreenShareStatus();
                            }
                        };

                        if (typeof targetWc.on === 'function') {
                            targetWc.on('did-navigate', handleTargetNavigated);
                            targetWc.on('page-title-updated', handleTitleUpdated);
                        }

                        this.activeScreenShare.targetWc = targetWc;
                        this.activeScreenShare.cleanupTarget = cleanupTarget;
                        this.activeScreenShare.handleTargetNavigated = handleTargetNavigated;
                        this.activeScreenShare.handleTitleUpdated = handleTitleUpdated;
                    }

                    if (pending.requestingWc && !pending.requestingWc.isDestroyed() && typeof pending.requestingWc.once === 'function') {
                        const cleanupRequesting = () => {
                            if (this.activeScreenShare?.requestingWcId === pending.requestingWc.id) {
                                this.stopScreenShare();
                            }
                        };
                        pending.requestingWc.once('destroyed', cleanupRequesting);
                        pending.requestingWc.once('render-process-gone', cleanupRequesting);
                        this.activeScreenShare.requestingWc = pending.requestingWc;
                        this.activeScreenShare.cleanupRequesting = cleanupRequesting;
                    }

                    this._broadcastScreenShareStatus();

                    if (typeof pending.callback === 'function') {
                        const cbPayload = { video: targetWc.mainFrame };
                        if (shareAudio) {
                            cbPayload.audio = targetWc.mainFrame;
                        }
                        try {
                            pending.callback(cbPayload);
                        } catch (err) {
                            console.warn('[MediaCaptureManager] callback invocation error:', err);
                        }
                    }
                    return;
                }
            }

            // Window or screen capture
            let matchingSource = pending.rawDesktopSources?.find((s) => s.id === sourceId) || pending.rawDesktopSources?.[0];
            if (!matchingSource) {
                if (typeof pending.callback === 'function') {
                    try {
                        pending.callback({});
                    } catch (_) { }
                }
                return;
            }

            this.activeScreenShare = {
                active: true,
                sourceKind: sourceKind || 'screen',
                sharedHost: matchingSource?.name || 'Screen',
                sharedTitle: matchingSource?.name || 'Screen',
                requestingTabId: pending.requestingTabId || null,
                requestingHost: pending.requesterHost || 'Meeting',
                requestingWcId: pending.requestingWc?.id || null,
                shareAudio: !!shareAudio,
                startedAt: Date.now(),
            };

            const hostWin = this._resolveWindowForTab(pending.requestingTabId);
            if (hostWin && sourceKind === 'window') {
                const drmStreamId = `screenShare:${pending.requestingWc?.id || requestId}`;
                this._temporarilySuspendDrmForWindow(hostWin, drmStreamId);
                this.activeScreenShare.suspendedDrmWinId = hostWin.id;
                this.activeScreenShare.drmStreamId = drmStreamId;
            }

            this._broadcastScreenShareStatus();

            if (typeof pending.callback === 'function') {
                const cbPayload = { video: matchingSource };
                if (shareAudio && isLoopbackAudioSupported()) {
                    cbPayload.audio = 'loopback';
                }
                try {
                    pending.callback(cbPayload);
                } catch (err) {
                    console.warn('[MediaCaptureManager] callback invocation error:', err);
                }
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
            const targetId = tabId || (sourceId.startsWith('tab:') ? sourceId.replace('tab:', '') : sourceId);
            const tabManager = require('../../windows/tabManager');
            let resolved = getTabRegistry().resolveTab(targetId);
            const stringTabId = resolved?.stringTabId || (typeof targetId === 'string' ? targetId : State.webContentsIdToTabId.get(Number(targetId)));
            if (stringTabId) {
                try {
                    tabManager.activateOrWakeTab(stringTabId);
                } catch (_) { }
            }
            const numericTabId = typeof targetId === 'number' ? targetId : (resolved?.webContents?.id || Number(targetId));
            chosenTabId = numericTabId;
            const hostWin = this._resolveWindowForTab(numericTabId || stringTabId);
            if (hostWin && pending.rawDesktopSources?.length > 0) {
                const winName = hostWin.getTitle();
                const matched = pending.rawDesktopSources.find((s) => s.name === winName);
                if (matched?.id) {
                    actualStreamId = matched.id;
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

        if (pending.cleanupRequestingDestroyed) pending.cleanupRequestingDestroyed();
        if (pending.cleanupWindowClosed) pending.cleanupWindowClosed();

        if (pending.isDisplayMedia) {
            if (typeof pending.callback === 'function') {
                // Return empty object {} to deny/cancel display media request cleanly
                pending.callback({});
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
                } catch (_) { }
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
        } catch (_) { }

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
                const numericTabId = typeof cap.tabId === 'number'
                    ? cap.tabId
                    : (getTabRegistry().resolveTab(cap.tabId)?.webContents?.id || Number(cap.tabId) || 0);
                results.push({
                    tabId: numericTabId || cap.tabId,
                    status: cap.status || 'active',
                    fullscreen: false,
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
     * Gathers all open and sleeping tabs across windows with titles, favicons, and live thumbnails.
     * Memory- and CPU-optimized with concurrency limits, timeouts, and native image resizing.
     */
    async _gatherTabSources() {
        const tabSources = [];
        try {
            const openTabs = await getTabRegistry().query({});
            const BATCH_SIZE = 4;

            for (let i = 0; i < openTabs.length; i += BATCH_SIZE) {
                const batch = openTabs.slice(i, i + BATCH_SIZE);
                const batchPromises = batch.map(async (t) => {
                    let thumbnail = '';
                    const tabIdentifier = t.id || t.stringTabId;
                    const resolved = getTabRegistry().resolveTab(tabIdentifier);

                    if (resolved?.view) {
                        const now = Date.now();
                        const isFresh = resolved.view._lastSnapshot && resolved.view._lastSnapshotTime && (now - resolved.view._lastSnapshotTime < 5000);
                        if (isFresh) {
                            thumbnail = resolved.view._lastSnapshot;
                        } else {
                            if (resolved.view._lastSnapshot) {
                                thumbnail = resolved.view._lastSnapshot;
                            }

                            // Capture live snapshot if view has alive webContents and is not currently discarded
                            const wc = resolved.view.webContents;
                            if (wc && !wc.isDestroyed() && !t.discarded) {
                                try {
                                    const img = await Promise.race([
                                        wc.capturePage(),
                                        new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 350))
                                    ]);
                                    if (img && !img.isEmpty()) {
                                        const size = typeof img.getSize === 'function' ? img.getSize() : null;
                                        let targetW = size?.width || 0;
                                        let targetH = size?.height || 0;
                                        const maxDim = 1280;
                                        if (targetW > 0 && targetH > 0) {
                                            if (targetW > maxDim || targetH > maxDim) {
                                                if (targetW >= targetH) {
                                                    targetH = Math.max(1, Math.round((size.height * maxDim) / size.width));
                                                    targetW = maxDim;
                                                } else {
                                                    targetW = Math.max(1, Math.round((size.width * maxDim) / size.height));
                                                    targetH = maxDim;
                                                }
                                            }
                                        }
                                        const resized = (typeof img.resize === 'function' && targetW > 0 && targetH > 0)
                                            ? img.resize({ width: targetW, height: targetH, quality: 'better' })
                                            : img;

                                        if (typeof resized.toJPEG === 'function') {
                                            const buf = resized.toJPEG(88);
                                            thumbnail = `data:image/jpeg;base64,${buf.toString('base64')}`;
                                        } else if (typeof resized.toDataURL === 'function') {
                                            thumbnail = resized.toDataURL();
                                        }
                                        resolved.view._lastSnapshot = thumbnail;
                                        resolved.view._lastSnapshotTime = now;
                                    }
                                } catch (_) { }
                            }
                        }
                    }

                    return {
                        id: `tab:${tabIdentifier}`,
                        tabId: tabIdentifier,
                        stringTabId: t.stringTabId || resolved?.stringTabId || null,
                        name: t.title || t.url || `Tab ${tabIdentifier}`,
                        url: t.url || '',
                        favicon: t.favIconUrl || '',
                        thumbnail,
                        type: 'tab',
                        windowId: t.windowId,
                    };
                });

                const batchResults = await Promise.all(batchPromises);
                tabSources.push(...batchResults);
            }
        } catch (err) {
            console.error('[MediaCaptureManager] _gatherTabSources error:', err);
        }
        return tabSources;
    }

    /**
     * Captures a high-quality live snapshot for a selected tab in the desktop media picker dialog.
     */
    async captureHighQualityTabSnapshot(tabId, requestId, context = null) {
        if (!tabId) return null;
        const tabIdentifier = String(tabId).replace(/^tab:/, '');
        const resolved = getTabRegistry().resolveTab(tabIdentifier);
        const wc = resolved?.view?.webContents || resolved?.webContents;
        if (!wc || wc.isDestroyed()) return null;

        try {
            const img = await Promise.race([
                wc.capturePage(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 500))
            ]);
            if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return null;

            const size = typeof img.getSize === 'function' ? img.getSize() : null;
            let targetW = size?.width || 0;
            let targetH = size?.height || 0;
            const maxDim = 1440;
            if (targetW > 0 && targetH > 0) {
                if (targetW > maxDim || targetH > maxDim) {
                    if (targetW >= targetH) {
                        targetH = Math.max(1, Math.round((size.height * maxDim) / size.width));
                        targetW = maxDim;
                    } else {
                        targetW = Math.max(1, Math.round((size.width * maxDim) / size.height));
                        targetH = maxDim;
                    }
                }
            }

            const resized = (typeof img.resize === 'function' && targetW > 0 && targetH > 0)
                ? img.resize({ width: targetW, height: targetH, quality: 'better' })
                : img;

            let thumbnail = '';
            if (typeof resized.toJPEG === 'function') {
                const buf = resized.toJPEG(92);
                thumbnail = `data:image/jpeg;base64,${buf.toString('base64')}`;
            } else if (typeof resized.toDataURL === 'function') {
                thumbnail = resized.toDataURL();
            }

            if (thumbnail) {
                if (resolved?.view) {
                    resolved.view._lastSnapshot = thumbnail;
                    resolved.view._lastSnapshotTime = Date.now();
                }

                const targetCtx = context || this._resolveContext();
                if (targetCtx?.chromeShellMenuOverlayView && !targetCtx.chromeShellMenuOverlayView.isDestroyed()) {
                    const ov = targetCtx.chromeShellMenuOverlayView;
                    if (ov.webContents && !ov.webContents.isDestroyed()) {
                        const C = require('../../../src/constants/conditionStrings.cjs');
                        const patchChannel = C?.IPC_EVENT?.CHROME_OVERLAY_PATCH || 'chrome-overlay:v1-patch';
                        ov.webContents.send(patchChannel, {
                            kind: 'desktopMediaPickerTabSnapshot',
                            requestId,
                            tabId,
                            thumbnail,
                        });
                    }
                }
            }
            return thumbnail;
        } catch (_) {
            return null;
        }
    }

    /**
     * Handles Electron session display media request (navigator.mediaDevices.getDisplayMedia).
     * Routes through the interactive source picker dialog.
     */
    async handleDisplayMediaRequest(request, callback) {
        this.requestIdCounter += 1;
        const requestId = this.requestIdCounter;

        let requestingWc = request.webContents || null;
        let requestingTabId = null;
        try {
            const electron = require('electron');
            if (!requestingWc && request.frame && typeof electron.webContents?.fromFrame === 'function') {
                requestingWc = electron.webContents.fromFrame(request.frame);
            }
            if (requestingWc) {
                requestingTabId = State.webContentsIdToTabId?.get(requestingWc.id) || null;
            }
        } catch (_) { }

        // Fast-path: Direct pending tab share (e.g. "Share this tab instead" seamless WebRTC track swap)
        if (requestingWc && this.pendingDirectTabShares.has(requestingWc.id)) {
            const pendingDirect = this.pendingDirectTabShares.get(requestingWc.id);
            this.pendingDirectTabShares.delete(requestingWc.id);
            if (pendingDirect?.timeoutId) {
                clearTimeout(pendingDirect.timeoutId);
            }
            if (pendingDirect && pendingDirect.targetFrame) {
                const cbPayload = { video: pendingDirect.targetFrame };
                if (pendingDirect.shareAudio) {
                    cbPayload.audio = pendingDirect.targetFrame;
                }
                try {
                    callback(cbPayload);
                } catch (err) {
                    console.warn('[MediaCaptureManager] pendingDirectTabShare callback error:', err);
                }
                return;
            }
        }

        let rawDesktopSources = [];
        try {
            if (desktopCapturer && typeof desktopCapturer.getSources === 'function') {
                rawDesktopSources = await desktopCapturer.getSources({
                    types: ['screen', 'window'],
                    thumbnailSize: { width: 480, height: 270 },
                    fetchWindowIcons: true,
                });
            }
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

        const tabSources = await this._gatherTabSources();

        const context = this._resolveContext();

        if (!context?.window || context.window.isDestroyed()) {
            if (rawDesktopSources.length > 0) {
                callback({ video: rawDesktopSources[0], audio: 'loopback' });
            } else {
                callback({});
            }
            return;
        }

        const originUrl = request.securityOrigin || request.frame?.url || '';
        let requesterHost = '';
        if (originUrl) {
            try {
                requesterHost = new URL(originUrl).host || originUrl;
            } catch (_) {
                requesterHost = originUrl.replace(/^https?:\/\//, '').split('/')[0] || '';
            }
        }
        const requesterName = requesterHost || (originUrl ? 'Current Page' : 'This Application');

        let cleanupRequestingDestroyed = null;
        let cleanupWindowClosed = null;

        // Clean up pending request if requesting webContents is destroyed before picker interaction
        if (requestingWc && !requestingWc.isDestroyed() && typeof requestingWc.once === 'function') {
            const handleRequestingDestroyed = () => {
                if (this.pendingPickerRequests.has(requestId)) {
                    try {
                        const overlayManager = require('../../windows/overlayManager');
                        overlayManager.hideDesktopMediaPickerOverlay(context);
                    } catch (_) { }
                    this.handlePickerCancel(requestId);
                }
            };
            requestingWc.once('destroyed', handleRequestingDestroyed);
            cleanupRequestingDestroyed = () => {
                try { requestingWc.removeListener('destroyed', handleRequestingDestroyed); } catch (_) {}
            };
        }

        // Clean up pending request if browser window is closed before picker interaction
        if (context?.window && !context.window.isDestroyed() && typeof context.window.once === 'function') {
            const handleWindowClosed = () => {
                if (this.pendingPickerRequests.has(requestId)) {
                    this.handlePickerCancel(requestId);
                }
            };
            context.window.once('closed', handleWindowClosed);
            cleanupWindowClosed = () => {
                try { context.window.removeListener('closed', handleWindowClosed); } catch (_) {}
            };
        }

        const overlayManager = require('../../windows/overlayManager');
        this.pendingPickerRequests.set(requestId, {
            requestId,
            callback,
            context,
            rawDesktopSources,
            tabSources,
            isDisplayMedia: true,
            requesterHost: requesterName,
            requestingWc,
            requestingTabId,
            cleanupRequestingDestroyed,
            cleanupWindowClosed,
        });

        overlayManager.showDesktopMediaPickerOverlay(context, {
            requestId,
            requesterName,
            requesterIcon: '',
            canRequestAudio: request.audioRequested !== false,
            supportsSystemAudio: isLoopbackAudioSupported(),
            sources: {
                screens: screenSources,
                windows: windowSources,
                tabs: tabSources,
            },
        });
    }

    /**
     * Terminates an active screen/tab sharing presentation.
     */
    stopScreenShare(targetWcIdOrTabId = null) {
        let targets = [];
        if (targetWcIdOrTabId) {
            for (const [wcId, session] of this.activeScreenShares.entries()) {
                if (wcId === targetWcIdOrTabId || session.sharedTabId === targetWcIdOrTabId || session.requestingTabId === targetWcIdOrTabId) {
                    targets.push(session);
                }
            }
        }
        if (targets.length === 0 && this.activeScreenShare) {
            targets.push(this.activeScreenShare);
        }

        for (const session of targets) {
            if (session.cleanupTarget && session.targetWc && !session.targetWc.isDestroyed()) {
                try {
                    session.targetWc.removeListener('destroyed', session.cleanupTarget);
                    session.targetWc.removeListener('render-process-gone', session.cleanupTarget);
                    if (session.handleTargetNavigated) session.targetWc.removeListener('did-navigate', session.handleTargetNavigated);
                    if (session.handleTitleUpdated) session.targetWc.removeListener('page-title-updated', session.handleTitleUpdated);
                } catch (_) {}
            }
            if (session.cleanupRequesting && session.requestingWc && !session.requestingWc.isDestroyed()) {
                try {
                    session.requestingWc.removeListener('destroyed', session.cleanupRequesting);
                    session.requestingWc.removeListener('render-process-gone', session.cleanupRequesting);
                } catch (_) {}
            }

            if (session.suspendedDrmWinId && session.drmStreamId) {
                this._restoreDrmForWindow(session.suspendedDrmWinId, session.drmStreamId);
            }
            const requestingWcId = session.requestingWcId;
            if (requestingWcId) {
                const pendingDirect = this.pendingDirectTabShares.get(requestingWcId);
                if (pendingDirect?.timeoutId) clearTimeout(pendingDirect.timeoutId);
                this.pendingDirectTabShares.delete(requestingWcId);

                try {
                    const { webContents } = require('electron');
                    const wc = webContents.fromId(requestingWcId);
                    if (wc && !wc.isDestroyed()) {
                        // Dispatch event to main-world listener, and also fallback to legacy global if present
                        wc.executeJavaScript(`
                            try {
                                window.dispatchEvent(new CustomEvent('__invisurf_stop_display_stream'));
                                if (window.__invisurfActiveDisplayStream) {
                                    window.__invisurfActiveDisplayStream.getTracks().forEach(t => { try { t.stop(); } catch(_) {} });
                                }
                            } catch (_) {}
                        `).catch(() => { });
                    }
                } catch (_) { }
            }
            if (session.requestingWcId) {
                this.activeScreenShares.delete(session.requestingWcId);
            }
        }

        this._singleActiveScreenShare = null;
        this._broadcastScreenShareStatus();
    }

    /**
     * Dynamically switches the active presentation to a new tab.
     */
    switchSharedTab(newTabId) {
        if (!this.activeScreenShare || !newTabId) return;
        const tabManager = require('../../windows/tabManager');
        let resolved = getTabRegistry().resolveTab(newTabId);
        const stringTabId = resolved?.stringTabId || (typeof newTabId === 'string' ? newTabId : State.webContentsIdToTabId?.get(Number(newTabId)));
        if (stringTabId) {
            try {
                tabManager.activateOrWakeTab(stringTabId);
                resolved = getTabRegistry().resolveTab(stringTabId);
            } catch (_) { }
        }
        const targetWc = resolved?.view?.webContents || resolved?.webContents;
        let sharedHost = '';
        try {
            const u = resolved?.url || targetWc?.getURL() || '';
            if (u) sharedHost = new URL(u).host || u;
        } catch (_) { }

        this.activeScreenShare.sharedTabId = stringTabId || newTabId;
        this.activeScreenShare.sharedHost = sharedHost || this.activeScreenShare.sharedHost;
        this.activeScreenShare.sharedTitle = resolved?.title || (typeof targetWc?.getTitle === 'function' ? targetWc.getTitle() : '') || this.activeScreenShare.sharedTitle;
        if (this.activeScreenShare.targetWc && !this.activeScreenShare.targetWc.isDestroyed()) {
            try {
                if (this.activeScreenShare.cleanupTarget) {
                    this.activeScreenShare.targetWc.removeListener('destroyed', this.activeScreenShare.cleanupTarget);
                    this.activeScreenShare.targetWc.removeListener('render-process-gone', this.activeScreenShare.cleanupTarget);
                }
                if (this.activeScreenShare.handleTargetNavigated) {
                    this.activeScreenShare.targetWc.removeListener('did-navigate', this.activeScreenShare.handleTargetNavigated);
                }
                if (this.activeScreenShare.handleTitleUpdated) {
                    this.activeScreenShare.targetWc.removeListener('page-title-updated', this.activeScreenShare.handleTitleUpdated);
                }
            } catch (_) {}
        }

        if (targetWc && typeof targetWc.once === 'function') {
            this.activeScreenShare.targetWcId = targetWc.id;
            const cleanupNewTarget = () => {
                if (this.activeScreenShare?.targetWcId === targetWc.id) {
                    this.stopScreenShare();
                }
            };
            targetWc.once('destroyed', cleanupNewTarget);
            targetWc.once('render-process-gone', cleanupNewTarget);

            const handleTargetNavigated = (_event, newUrl) => {
                if (this.activeScreenShare?.targetWcId === targetWc.id) {
                    try {
                        if (newUrl) {
                            this.activeScreenShare.sharedHost = new URL(newUrl).host || newUrl;
                        }
                        this.activeScreenShare.sharedTitle = (typeof targetWc.getTitle === 'function' ? targetWc.getTitle() : '') || this.activeScreenShare.sharedHost;
                        this._broadcastScreenShareStatus();
                    } catch (_) { }
                }
            };
            const handleTitleUpdated = (_event, newTitle) => {
                if (this.activeScreenShare?.targetWcId === targetWc.id) {
                    this.activeScreenShare.sharedTitle = newTitle || this.activeScreenShare.sharedTitle;
                    this._broadcastScreenShareStatus();
                }
            };
            if (typeof targetWc.on === 'function') {
                targetWc.on('did-navigate', handleTargetNavigated);
                targetWc.on('page-title-updated', handleTitleUpdated);
            }

            this.activeScreenShare.targetWc = targetWc;
            this.activeScreenShare.cleanupTarget = cleanupNewTarget;
            this.activeScreenShare.handleTargetNavigated = handleTargetNavigated;
            this.activeScreenShare.handleTitleUpdated = handleTitleUpdated;
        }
        // Manage DRM transitions across windows
        const newHostWin = this._resolveWindowForTab(stringTabId || newTabId);
        if (newHostWin && this.activeScreenShare.suspendedDrmWinId !== newHostWin.id) {
            if (this.activeScreenShare.suspendedDrmWinId && this.activeScreenShare.drmStreamId) {
                this._restoreDrmForWindow(this.activeScreenShare.suspendedDrmWinId, this.activeScreenShare.drmStreamId);
            }
            const drmStreamId = 'screenShare:' + (this.activeScreenShare.requestingWcId || 'switch');
            this._temporarilySuspendDrmForWindow(newHostWin, drmStreamId);
            this.activeScreenShare.suspendedDrmWinId = newHostWin.id;
            this.activeScreenShare.drmStreamId = drmStreamId;
        }

        if (this.activeScreenShare.requestingWcId) {
            this.activeScreenShares.set(this.activeScreenShare.requestingWcId, this.activeScreenShare);
            try {
                const { webContents } = require('electron');
                const reqWc = webContents.fromId(this.activeScreenShare.requestingWcId);
                if (reqWc && !reqWc.isDestroyed()) {
                    if (targetWc?.mainFrame) {
                        const existing = this.pendingDirectTabShares.get(reqWc.id);
                        if (existing?.timeoutId) clearTimeout(existing.timeoutId);

                        const timeoutId = setTimeout(() => {
                            this.pendingDirectTabShares.delete(reqWc.id);
                        }, 10000);

                        this.pendingDirectTabShares.set(reqWc.id, {
                            targetFrame: targetWc.mainFrame,
                            shareAudio: !!this.activeScreenShare.shareAudio,
                            timeoutId,
                        });
                    }

                    reqWc.send('screen-share:do-switch-tab', {
                        newTabId: stringTabId || newTabId,
                        title: this.activeScreenShare.sharedTitle,
                        host: this.activeScreenShare.sharedHost,
                        hasAudio: !!this.activeScreenShare.shareAudio,
                    });
                    reqWc.send('screen-share:tab-switched', {
                        newTabId: stringTabId || newTabId,
                        title: this.activeScreenShare.sharedTitle,
                        host: this.activeScreenShare.sharedHost,
                    });
                }
            } catch (_) { }
        }
        this._broadcastScreenShareStatus();
    }

    /**
     * Broadcasts the active screen share status to UI components and resizes active content view.
     */
    _broadcastScreenShareStatus() {
        const payload = this.activeScreenShare || { active: false };
        this.emit('screen-share-status-changed', payload);

        // Update context bounds and layout
        const context = this._resolveContext();
        if (context) {
            context.isScreenSharingActive = !!payload.active;
            try {
                const tabManager = require('../../windows/tabManager');
                tabManager.layoutActiveTabView(context);
            } catch (_) { }
        }

        // Clean up any remaining window contexts when screen sharing completely ends
        if (!payload.active && State.windowContextsById?.size > 0) {
            try {
                const tabManager = require('../../windows/tabManager');
                for (const ctx of State.windowContextsById.values()) {
                    if (ctx.isScreenSharingActive) {
                        ctx.isScreenSharingActive = false;
                        tabManager.layoutActiveTabView(ctx);
                    }
                }
            } catch (_) { }
        }

        // Send to renderer windows
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                    win.webContents.send('screen-share-status-changed', payload);
                }
            });
        } catch (_) { }
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
        } catch (_) { }
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
