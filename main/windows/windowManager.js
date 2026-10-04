const { BrowserWindow, screen, session } = require('electron');
const path = require('path');
const crypto = require('crypto');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const chromeTheme = require('../../src/theme/chromeTheme.cjs');

const { ensureProfile } = require('../services/profileService');
const { loadSettings, getTitleBarOverlayOptionsForNativeTheme } = require('../services/settingsService');
const { pushRecentlyClosedEntry, captureClosedWindowSnapshot } = require('../services/sessionService');
const { registerAppProtocolForSession, installSessionNetworkGuards, prewarmNewTabAssets } = require('../services/networkService');
const { cleanupStealthCookiesForContext, cleanupSessionOnlyCookiesForProfile } = require('../services/cookieService');

const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const { applyShellWindowSecurity, applyContentProtection, applyProfilePickerSecurity } = require('../../runtime/windowSecurity');

const {
    createChromeOverlayLayer,
    createChromeShellMenuOverlayLayer,
    createChromeOmniboxOverlayLayer,
    createTooltipOverlay,
    ensureChromeOverlayOnTop,
    layoutChromeOverlayBounds,
    layoutOmniboxOverlayBounds
} = require('./overlayManager');

/** Usable screen rectangle (excludes dock/taskbar); keeps custom title bar — not OS fullscreen. */
function getPrimaryWorkAreaBounds() {
    try {
        if (!screen || typeof screen.getPrimaryDisplay !== 'function') return null;
        const wa = screen.getPrimaryDisplay().workArea;
        if (!wa || wa.width < 320 || wa.height < 240) return null;
        return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
    } catch {
        return null;
    }
}

function createWindow({
    profileId = null,
    windowId = null,
    fillWorkArea = true,
    stealthWindow = false,
    ghostWindow = false,
    bounds = null,
    bootstrapPayload = null,
} = {}) {
    const resolvedProfileId = profileId || State.defaultProfileId || `profile-${crypto.randomUUID()}`;
    ensureProfile(resolvedProfileId);
    const partition = `persist:profile-${resolvedProfileId}`;
    const mappedSession = session.fromPartition(partition);
    registerAppProtocolForSession(mappedSession, partition);
    const { getPermissionController } = require('../permissions/PermissionController');
    const permController = getPermissionController();
    permController.registerSession(mappedSession, { profileId: resolvedProfileId, isIncognito: false });
    const { getExtensionController } = require('../extensions/ExtensionController');
    void getExtensionController().registerSession(resolvedProfileId, mappedSession);

    // This is deliberately best-effort and is shared safely across all
    // partitions: these are packaged, profile-independent renderer assets.
    void prewarmNewTabAssets();

    /** One shared in-memory session per stealth window (all tabs incognito; discarded with the window). */
    let stealthTabsPartition = null;
    if (stealthWindow) {
        stealthTabsPartition = `in-memory:stealth-win-${crypto.randomUUID()}`;
        const stealthTabSession = session.fromPartition(stealthTabsPartition);
        registerAppProtocolForSession(stealthTabSession, stealthTabsPartition);
        installSessionNetworkGuards(stealthTabSession, { profileId: resolvedProfileId, isStealthSession: true });
        permController.registerSession(stealthTabSession, { profileId: stealthTabsPartition, isIncognito: true });
    }

    const isMac = process.platform === C.PLATFORM.DARWIN;
    const isGhost = !!ghostWindow;
    const workArea = fillWorkArea ? getPrimaryWorkAreaBounds() : null;
    const stealthTitleBarOverlay =
        process.platform !== 'darwin'
            ? chromeTheme.getTitleBarOverlayFromSettings(
                { colorTheme: 'dark', accentTheme: 'default', accentCustomHex: null },
                true,
            )
            : null;

    const hasValidBounds = bounds &&
        typeof bounds.x === 'number' &&
        typeof bounds.y === 'number' &&
        typeof bounds.width === 'number' && bounds.width > 0 &&
        typeof bounds.height === 'number' && bounds.height > 0;

    const window = new BrowserWindow({
        ...(hasValidBounds
            ? {
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
            }
            : (workArea
                ? {
                    x: workArea.x,
                    y: workArea.y,
                    width: workArea.width,
                    height: workArea.height,
                }
                : { width: 1200, height: 800 })),
        titleBarStyle: (isMac && !isGhost) ? 'hiddenInset' : 'hidden',
        ...(isMac
            ? { trafficLightPosition: { x: 15, y: 15 } }
            : {
                titleBarOverlay: stealthWindow ? stealthTitleBarOverlay : getTitleBarOverlayOptionsForNativeTheme(),
            }
        ),
        ...(isGhost
            ? {
                type: isMac ? 'panel' : undefined,
                alwaysOnTop: true,
                acceptFirstMouse: true,
                fullscreenable: false,
                show: false,
            }
            : {}
        ),
        webPreferences: buildSecureWebPreferences({ partition }),
    });

    if (isGhost) {
        try {
            const { applyGhostMode } = require('../native');
            applyGhostMode(window);
        } catch (_) { }
    }

    applyIdentityToWebContents(window.webContents);
    applyShellWindowSecurity(window, { permissionFullscreen: C.PERMISSION.FULLSCREEN });
    applyContentProtection(window, loadSettings().contentProtection);

    const initialSettings = loadSettings();
    if (initialSettings.rememberWindowOpacity && typeof initialSettings.windowOpacity === 'number') {
        const safeOpacity = Math.max(0.02, Math.min(1.0, initialSettings.windowOpacity));
        try { window.setOpacity(safeOpacity); } catch (_) { }
    }

    const context = {
        window,
        windowId: windowId || `window-${crypto.randomUUID()}`,
        profileId: resolvedProfileId,
        partition,
        stealthWindow: !!stealthWindow,
        ghostWindow: isGhost,
        isInitialGhostSpawn: isGhost,
        stealthTabsPartition,
        tabs: {},
        sleepingTabs: {},
        tabOrder: [],
        // Detached, fully loaded spare used only for the next foreground NTP.
        prewarmedNtp: null,
        activeTabId: null,
        isActiveTabTemporarilyHidden: false,
        activeTabViewRemovedForShellOverlay: false,
        tabContentView: null,
        tooltipView: null,
        chromeOverlayView: null,
        chromeOmniboxOverlayView: null,
        chromeShellMenuOverlayView: null,
        chromeOverlayAcquireCount: 0,
        chromeOmniboxOverlayAcquireCount: 0,
        chromeShellMenuOverlayAcquireCount: 0,
        chromeShellMenuOverlayBlurDismissPending: false,
        chromeOverlayOmniboxMode: false,
        chromeOverlayBlurDismissPending: false,
        lastOmniboxOverlayPatch: null,
        chromeOmniboxOverlayReady: false,
        lensSessions: new Map(),
        lensOverlayBounds: null,
        chromeOverlayFullWindowMode: false,
    };
    State.windowContextsById.set(window.id, context);

    const initialBootstrap = {
        ...(isGhost ? { ghostWindow: true } : {}),
        ...(stealthWindow ? { stealthWindow: true } : {}),
        ...(bootstrapPayload || {}),
    };
    if (Object.keys(initialBootstrap).length > 0) {
        State.windowBootstrapById.set(context.windowId, initialBootstrap);
    }

    const shellEntryUrl = 'app://dist/index.html';
    window.loadURL(shellEntryUrl).catch((error) => {
        console.error('Failed to load shell entry URL:', shellEntryUrl, error);
    });

    const menuUI = require('../ui/menu');
    menuUI.rebuildApplicationMenu();

    const { handleShortcuts } = require('../ui/shortcuts');
    window.webContents.on('before-input-event', handleShortcuts);

    if (!context.ghostWindow && (!State.mainWindow || State.mainWindow.isDestroyed())) {
        State.mainWindow = window;
    }
    window.on('focus', () => {
        if (context.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
        if (!context.ghostWindow) {
            State.mainWindow = window;
        }
        menuUI.rebuildApplicationMenu();
    });

    const { createTabContentContainer, layoutTabContentContainer, removeTabContentChildView, layoutActiveTabView, prewarmNewTabView } = require('./tabManager');
    const { getLensSession, postLensSelectionPatch } = require('./lensManager');

    createTabContentContainer(context);

    if (State.appLogger) {
        State.appLogger.info('window:create', {
            windowId: context.windowId,
            browserWindowId: window.id,
            profileId: context.profileId,
            stealthWindow: context.stealthWindow,
            partition,
        });
    }

    if (isGhost) {
        window.setTitle('InviSurf — Ghost');
        const prevBoot = State.windowBootstrapById.get(context.windowId) || {};
        State.windowBootstrapById.set(context.windowId, {
            ...prevBoot,
            stealthWindow: !!stealthWindow,
            ghostWindow: true,
        });
        const { applyGhostMode } = require('../native');
        const showGhost = () => {
            try {
                applyGhostMode(window);
                window.showInactive();
            } catch (err) {
                console.error('[windowManager] Failed to show ghost window:', err);
                try { window.show(); } catch (_) { }
            }
        };
        if (window.isVisible()) {
            showGhost();
        } else {
            window.once('ready-to-show', showGhost);
            setTimeout(() => {
                if (!window.isDestroyed() && !window.isVisible()) {
                    showGhost();
                }
            }, 800);
        }
    } else if (stealthWindow) {
        window.setTitle('InviSurf — Stealth');
        const prevBoot = State.windowBootstrapById.get(context.windowId) || {};
        State.windowBootstrapById.set(context.windowId, { ...prevBoot, stealthWindow: true });
    }

    window.on('resize', () => {
        layoutTabContentContainer(context);
        if (context.ghostWindow && process.platform === 'win32') {
            const { hookWindowChildren } = require('../native');
            hookWindowChildren(context.window);
        }
        if (!context.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return;
        const view = context.tabs[context.activeTabId];
        if (!view) return;
        if (context.isActiveTabTemporarilyHidden) {
            if (!context.activeTabViewRemovedForShellOverlay) {
                view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
            return;
        }
        layoutActiveTabView(context, context.activeTabId);
        if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
            postLensSelectionPatch(context);
        }
        if ((context.chromeOmniboxOverlayAcquireCount || 0) > 0 && context.lastOmniboxOverlayPatch) {
            layoutOmniboxOverlayBounds(context, context.lastOmniboxOverlayPatch);
        }
        ensureChromeOverlayOnTop(context);
    });

    window.on('close', () => {
        if (!context._closedWindowSnapshotPushed) {
            const windowSnapshot = captureClosedWindowSnapshot(context);
            if (State.appLogger) {
                State.appLogger.info('window:close', {
                    windowId: context.windowId,
                    profileId: context.profileId,
                    stealthWindow: context.stealthWindow,
                    tabCount: Object.keys(context.tabs).length + Object.keys(context.sleepingTabs).length,
                    capturedRecentlyClosedTabs: windowSnapshot?.tabs?.length || 0,
                });
            }
            if (windowSnapshot) {
                pushRecentlyClosedEntry(context.profileId, windowSnapshot);
            }
        }

        for (const tabId of Object.keys(context.tabs)) {
            const view = context.tabs[tabId];
            removeTabContentChildView(context, view);
            try { if (!view.webContents.isDestroyed()) view.webContents.destroy(); } catch (_) { }
        }
        context.tabs = {};
        context.activeTabId = null;
        if (context.prewarmedNtp?.view) {
            try { if (!context.prewarmedNtp.view.webContents.isDestroyed()) context.prewarmedNtp.view.webContents.destroy(); } catch (_) { }
        }
        context.prewarmedNtp = null;

        if (context.tooltipView) {
            try { context.window.contentView.removeChildView(context.tooltipView); } catch (_) { }
            try { if (!context.tooltipView.webContents.isDestroyed()) context.tooltipView.webContents.destroy(); } catch (_) { }
            context.tooltipView = null;
        }
        if (context.chromeOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOverlayView); } catch (_) { }
            try {
                if (!context.chromeOverlayView.webContents.isDestroyed()) context.chromeOverlayView.webContents.destroy();
            } catch (_) { }
            context.chromeOverlayView = null;
        }
        if (context.chromeOmniboxOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOmniboxOverlayView); } catch (_) { }
            try {
                if (!context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                    context.chromeOmniboxOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeOmniboxOverlayView = null;
        }
        if (context.chromeShellMenuOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeShellMenuOverlayView); } catch (_) { }
            try {
                if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                    context.chromeShellMenuOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeShellMenuOverlayView = null;
        }
        if (context.lensSessions) {
            for (const sessionState of context.lensSessions.values()) {
                const sidebarView = sessionState?.sidebarView;
                if (!sidebarView) continue;
                removeTabContentChildView(context, sessionState.sidebarHostView || sidebarView);
                try {
                    if (sessionState.sidebarHostView) {
                        try { sessionState.sidebarHostView.removeChildView(sidebarView); } catch (_) { }
                    }
                    if (!sidebarView.webContents.isDestroyed()) sidebarView.webContents.destroy();
                } catch (_) { }
            }
            context.lensSessions.clear();
        }
        if (context.tabContentView) {
            try { context.window.contentView.removeChildView(context.tabContentView); } catch (_) { }
            context.tabContentView = null;
        }
        context.chromeOverlayAcquireCount = 0;
        context.chromeOmniboxOverlayAcquireCount = 0;
        context.chromeShellMenuOverlayAcquireCount = 0;
    });

    window.on('closed', () => {
        if (State.appLogger) {
            State.appLogger.info('window:closed', {
                windowId: context.windowId,
                profileId: context.profileId,
                browserWindowId: window.id,
            });
        }
        State.windowContextsById.delete(window.id);
        State.windowBootstrapById.delete(context.windowId);

        const profileStillOpen = Array.from(State.windowContextsById.values()).some(
            (ctx) => ctx?.profileId === context.profileId,
        );

        if (context.stealthWindow) {
            cleanupStealthCookiesForContext(context).catch((error) => {
                if (State.appLogger) {
                    State.appLogger.warn('cookies:stealth-cleanup-failed', {
                        profileId: context.profileId,
                        windowId: context.windowId,
                        error: State.appLogger.serializeError(error),
                    });
                }
            });
            try {
                const { getPermissionController } = require('../permissions/PermissionController');
                getPermissionController().db.unregisterEphemeralProfile(context.stealthTabsPartition);
            } catch (_) { }
        }

        if (!profileStillOpen) {
            cleanupSessionOnlyCookiesForProfile(context.profileId).catch((error) => {
                if (State.appLogger) {
                    State.appLogger.warn('cookies:session-only-cleanup-failed', {
                        profileId: context.profileId,
                        error: State.appLogger.serializeError(error),
                    });
                }
            });
        }

        if (State.mainWindow === window) {
            State.mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
        }
    });

    createChromeOverlayLayer(context);
    createChromeShellMenuOverlayLayer(context);
    createChromeOmniboxOverlayLayer(context);
    createTooltipOverlay(context);
    ensureChromeOverlayOnTop(context);
    // Start this after the shell/overlay setup.  It stays detached and is only
    // promoted for a foreground blank NTP in this exact window context.
    setImmediate(() => prewarmNewTabView(context));
    return context;
}

function createProfilePickerWindow() {
    if (State.profilePickerWindow && !State.profilePickerWindow.isDestroyed()) {
        State.profilePickerWindow.show();
        State.profilePickerWindow.focus();
        return;
    }
    const workArea = screen.getPrimaryDisplay().workArea;
    const picker = new BrowserWindow({
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
        minWidth: 360,
        minHeight: 400,
        title: 'Choose profile',
        titleBarStyle: 'default',
        fullscreen: false,
        webPreferences: buildSecureWebPreferences(),
    });

    applyProfilePickerSecurity(picker, loadSettings().contentProtection);
    applyIdentityToWebContents(picker.webContents);

    picker.loadURL('app://dist/profile-picker.html').catch((error) => {
        console.error('Failed to load profile picker:', error);
    });

    State.profilePickerWindow = picker;
    picker.on('closed', () => {
        State.profilePickerWindow = null;
        if (State.windowContextsById.size === 0 && process.platform !== C.PLATFORM.DARWIN) {
            const { app } = require('electron');
            app.quit();
        }
    });
}

/**
 * Enables or disables click-through (mouse pass-through) on a ghost window.
 *
 * When click-through is ON the window can't be focused by clicking, so
 * before-input-event shortcuts stop working. We compensate by registering
 * Ctrl+Shift+G as a globalShortcut while click-through is active and
 * unregistering it when it's turned off.
 *
 * The OSD notification is posted directly to chromeShellMenuOverlayView so it
 * is always visible above tab WebContentsViews.
 */
function setWindowClickThrough(context, enable, source = 'manual') {
    if (!context?.window || context.window.isDestroyed() || !context.ghostWindow) return false;
    context.isClickThrough = !!enable;

    // ── Native + Electron layer ───────────────────────────────────────────
    try {
        const { setClickThrough } = require('../native');
        setClickThrough(context.window, context.isClickThrough);
    } catch (err) {
        console.error('[windowManager] setClickThrough native:', err);
    }

    try {
        context.window.setIgnoreMouseEvents(context.isClickThrough, { forward: true });
    } catch (err) {
        console.error('[windowManager] setIgnoreMouseEvents:', err);
    }

    // ── Global shortcut management ────────────────────────────────────────
    // When click-through is on, the window can't receive keyboard focus, so
    // before-input-event won't fire. Register a globalShortcut as fallback.
    try {
        const { globalShortcut } = require('electron');
        const ACCEL = 'CmdOrCtrl+Shift+G';
        globalShortcut.unregister(ACCEL);
        if (context.isClickThrough) {
            globalShortcut.register(ACCEL, () => {
                if (!context.window || context.window.isDestroyed()) {
                    globalShortcut.unregister(ACCEL);
                    return;
                }
                setWindowClickThrough(context, false, 'globalShortcut');
            });
        }
    } catch (err) {
        console.error('[windowManager] globalShortcut management:', err);
    }

    // ── OSD via shell menu overlay (always above tab content) ─────────────
    try {
        const overlayView = context.chromeShellMenuOverlayView;
        if (overlayView && !overlayView.webContents.isDestroyed()) {
            const overlayManager = require('./overlayManager');
            const shortcutLabel = process.platform === 'darwin' ? '⌘⇧G' : 'Ctrl+Shift+G';
            const patch = {
                kind: 'clickThroughOSD',
                isClickThrough: context.isClickThrough,
                shortcutLabel,
            };
            const bounds = overlayManager.computeMenuOverlayBounds(context, patch);
            if (bounds) {
                overlayView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
                patch.overlayBounds = bounds;
                patch.overlayViewport = { width: bounds.viewportWidth, height: bounds.viewportHeight };
            }
            overlayManager.ensureChromeOverlayOnTop(context);
            overlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
        }
    } catch (err) {
        console.error('[windowManager] clickThroughOSD overlay:', err);
    }

    // ── Also notify the shell renderer (for any legacy listeners) ─────────
    try {
        context.window.webContents.send(C.IPC_EVENT.GHOST_CLICK_THROUGH_CHANGED, {
            isClickThrough: context.isClickThrough,
            source,
        });
    } catch (_) {}

    // ── Rebuild app menu to reflect new state ─────────────────────────────
    try {
        const menuUI = require('../ui/menu');
        menuUI.rebuildApplicationMenu();
    } catch (_) {}

    return context.isClickThrough;
}

function toggleWindowClickThrough(context, source = 'manual') {
    if (!context?.ghostWindow) return false;
    return setWindowClickThrough(context, !context.isClickThrough, source);
}

module.exports = {
    getPrimaryWorkAreaBounds,
    createWindow,
    createProfilePickerWindow,
    setWindowClickThrough,
    toggleWindowClickThrough,
};

