
const path = require('path');
const C = require('../../src/constants/conditionStrings.cjs');
const State = require('../state');

const {
    focusedShellWebContents,
    getWindowContextForShellFallback,
    getWindowContextByEventSender,
    getFocusedShellWindow,
    getWindowContextByBrowserWindow
} = require('../windows/windowContextUtils');

const { restoreRecentlyClosed } = require('../services/sessionService');
const { matchesShortcut } = require('./shortcutMatcher');
const { DEFAULT_SHORTCUTS } = require('../constants/defaults');
const { loadSettings } = require('../services/settingsService');

// Helper to handle keyboard shortcuts across different WebContents
function handleShortcuts(event, input) {
    if (input.type !== 'keyDown') return;

    const key = (input.key || '').toLowerCase();
    const senderContext = event?.sender ? getWindowContextByEventSender(event.sender) : null;
    const context = senderContext || getWindowContextForShellFallback();

    // 1. Google Lens shortcut guard
    const { getLensSession, closeGoogleLensSelection } = require('../windows/lensManager');
    const lensSelectionActive = getLensSession(context, context?.activeTabId, false)?.selectionActive;

    if (lensSelectionActive) {
        if (key === ' ' || key === 'space' || input.code === 'Space') {
            event.preventDefault();
            return;
        }
        if (key === 'escape') {
            event.preventDefault();
            closeGoogleLensSelection(context, { closeSidebar: true });
            return;
        }
    }

    // 2. Tab switching with Ctrl+Tab (browser standard)
    if (input.control && input.key === 'Tab') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: input.shift ? -1 : 1 });
        return;
    }

    // 3. Load user-configured shortcuts dynamically
    let shortcuts = DEFAULT_SHORTCUTS;
    try {
        const settings = loadSettings();
        if (settings?.shortcuts) {
            shortcuts = { ...DEFAULT_SHORTCUTS, ...settings.shortcuts };
        }
    } catch (_) {}

    const win = context?.window || getFocusedShellWindow() || State.mainWindow;

    // 4. Transparency Mode Breakpoint Jumping (10 breakpoints, gap of 10)
    const BREAKPOINTS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];

    if (matchesShortcut(input, shortcuts.transparencyNextBreakpoint)) {
        event.preventDefault();
        if (win) {
            const current = typeof win.getOpacity === 'function' ? win.getOpacity() : 1.0;
            const curRounded = Math.round(current * 100) / 100;
            const next = BREAKPOINTS.find((bp) => bp >= curRounded + 0.05) ?? 1.00;
            applyWindowOpacityFromShortcut(win, next, 'shortcut-step');
        }
        return;
    }

    if (matchesShortcut(input, shortcuts.transparencyPrevBreakpoint)) {
        event.preventDefault();
        if (win) {
            const current = typeof win.getOpacity === 'function' ? win.getOpacity() : 1.0;
            const curRounded = Math.round(current * 100) / 100;
            const reversed = [...BREAKPOINTS].reverse();
            const prev = reversed.find((bp) => bp <= curRounded - 0.05) ?? 0.10;
            applyWindowOpacityFromShortcut(win, prev, 'shortcut-step');
        }
        return;
    }

    // 6. Boss Key (Quick Minimize / Restore)
    if (matchesShortcut(input, shortcuts.bossKey)) {
        event.preventDefault();
        if (win) {
            try {
                if (win.isMinimized()) {
                    win.restore();
                    win.focus();
                } else {
                    win.minimize();
                }
            } catch (_) {}
        }
        return;
    }

    // 7. Tab Zoom
    if (matchesShortcut(input, shortcuts.zoomIn)) {
        event.preventDefault();
        const { zoomInActiveTab } = require('../windows/tabManager');
        zoomInActiveTab(context);
        return;
    }
    if (matchesShortcut(input, shortcuts.zoomOut)) {
        event.preventDefault();
        const { zoomOutActiveTab } = require('../windows/tabManager');
        zoomOutActiveTab(context);
        return;
    }
    if (matchesShortcut(input, shortcuts.zoomReset)) {
        event.preventDefault();
        const { resetZoomActiveTab } = require('../windows/tabManager');
        resetZoomActiveTab(context);
        return;
    }

    // 8. Navigation & Tab Management
    if (matchesShortcut(input, shortcuts.history)) {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY);
        return;
    }
    if (matchesShortcut(input, shortcuts.reopenTab)) {
        event.preventDefault();
        restoreRecentlyClosed(null, context);
        return;
    }
    if (matchesShortcut(input, shortcuts.print)) {
        event.preventDefault();
        const { printActiveTab } = require('../windows/tabManager');
        printActiveTab();
        return;
    }
    if (matchesShortcut(input, shortcuts.newTab)) {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_NEW_TAB);
        return;
    }
    if (matchesShortcut(input, shortcuts.closeTab)) {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_CLOSE_TAB);
        return;
    }
    if (matchesShortcut(input, shortcuts.newWindow)) {
        event.preventDefault();
        const windowManager = require('../windows/windowManager');
        const profileId = context?.profileId || State.defaultProfileId;
        windowManager.createWindow({ profileId });
        return;
    }
    if (matchesShortcut(input, shortcuts.newStealthWindow)) {
        event.preventDefault();
        const windowManager = require('../windows/windowManager');
        const profileId = context?.profileId || State.defaultProfileId;
        windowManager.createWindow({ profileId, stealthWindow: true });
        return;
    }
}

function applyWindowOpacityFromShortcut(win, newOpacity, source = 'shortcut') {
    if (!win || win.isDestroyed()) return;
    const safeOpacity = Math.max(0.02, Math.min(1.0, Math.round(newOpacity * 100) / 100));
    try {
        win.setOpacity(safeOpacity);
    } catch (_) {}
    const { loadSettings, saveSettings, broadcastSettingsUpdate } = require('../services/settingsService');
    const settings = loadSettings();
    if (settings.rememberWindowOpacity) {
        settings.windowOpacity = safeOpacity;
        saveSettings(settings);
        broadcastSettingsUpdate(settings);
    }
    try {
        win.webContents.send(C.IPC_EVENT.WINDOW_OPACITY_CHANGED, { opacity: safeOpacity, source });
    } catch (_) {}
}

module.exports = {
    handleShortcuts
};