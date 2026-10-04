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
 * with InviSurf's Content Protection / DRM switch.
 */
class MediaCaptureManager extends EventEmitter {
    constructor() {
        super();
        this.requestIdCounter = 1000;
        this.activeRequests = new Map(); // requestId -> requestDetails
        this.activeCaptures = new Map(); // streamId -> captureDetails
        this.activeWindowDrmOverrides = new Map(); // windowId -> Set<streamId>
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
     * Queries available desktop and window sources, includes open tabs, and returns
     * an authorized streamId and requestId.
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

        let desktopSources = [];
        try {
            desktopSources = await desktopCapturer.getSources({
                types: electronTypes,
                thumbnailSize: { width: 320, height: 180 },
                fetchWindowIcons: true,
            });
        } catch (err) {
            console.error('[MediaCaptureManager] Failed to fetch desktop sources:', err);
        }

        // Gather open tabs if tab capture is requested
        let tabSources = [];
        if (includeTab) {
            try {
                const openTabs = await getTabRegistry().query({});
                tabSources = openTabs.map((t) => ({
                    id: `tab:${t.id}`,
                    name: t.title || t.url || `Tab ${t.id}`,
                    tabId: t.id,
                    url: t.url,
                    windowId: t.windowId,
                }));
            } catch (_) {}
        }

        // Choose the best matching source for desktop capture
        let chosenSource = null;
        if ((includeScreen || includeWindow) && desktopSources.length > 0) {
            chosenSource = desktopSources[0];
        } else if (targetTab?.id) {
            chosenSource = tabSources.find((s) => s.tabId === targetTab.id);
        } else if (includeTab && tabSources.length > 0) {
            const activeTab = getTabRegistry().getActiveTab();
            chosenSource = (activeTab && tabSources.find((s) => s.tabId === activeTab.id)) || tabSources[0];
        } else if (desktopSources.length > 0) {
            chosenSource = desktopSources[0];
        }

        const streamId = chosenSource ? chosenSource.id : (desktopSources[0]?.id || 'screen:0:0');

        // Track active request and stream
        this.activeRequests.set(requestId, {
            requestId,
            extensionId,
            streamId,
            sources: requestedSources,
            targetTab,
            chosenSource,
            createdAt: Date.now(),
        });

        const targetTabId = targetTab?.id || chosenSource?.tabId || null;
        this.activeCaptures.set(streamId, {
            streamId,
            tabId: targetTabId,
            extensionId,
            status: 'active',
            startedAt: Date.now(),
        });

        // Manage DRM protection for InviSurf windows if window capture was explicitly chosen
        if (chosenSource?.id?.startsWith('window:')) {
            const hostWin = this._resolveWindowForTab(targetTabId);
            if (hostWin) {
                this._temporarilySuspendDrmForWindow(hostWin, streamId);
            }
        }

        // Notify extensions of tab capture status change
        if (targetTabId) {
            this._broadcastCaptureStatus(targetTabId, 'active');
        }

        return {
            requestId,
            streamId,
            options: {
                canRequestAudioTrack: requestedSources.includes('audio'),
            },
        };
    }

    /**
     * chrome.desktopCapture.cancelChooseDesktopMedia(requestId)
     */
    cancelChooseDesktopMedia(requestId) {
        const id = Number(requestId);
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
     * Handles Electron session display media request.
     */
    async handleDisplayMediaRequest(request, callback) {
        try {
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
            if (sources.length > 0) {
                callback({ video: sources[0], audio: 'loopback' });
                return;
            }
        } catch (_) {}
        callback({ video: null });
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
