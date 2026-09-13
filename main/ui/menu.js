
const { Menu, app, shell, webContents } = require('electron');
const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');

const {
    focusedShellWebContents,
    getFocusedShellWindow,
    getWindowContextByBrowserWindow,
    getWindowContextForShellFallback
} = require('../windows/windowContextUtils');

const { buildRecentlyClosedMenuItems, restoreRecentlyClosed } = require('../services/sessionService');

function openDownloadsFolder() {
    try {
        const downloadsPath = app.getPath('downloads');
        shell.openPath(downloadsPath).catch((error) => {
            console.error('Failed to open downloads folder:', error?.message || error);
        });
        return true;
    } catch (error) {
        console.error('Failed to resolve downloads folder:', error?.message || error);
        return false;
    }
}

function setFocusedWindowOpacity(targetOpacity) {
    const win = getFocusedShellWindow() || State.mainWindow;
    if (!win || win.isDestroyed()) return;
    const safeOpacity = Math.max(0.02, Math.min(1.0, Math.round(targetOpacity * 100) / 100));
    try { win.setOpacity(safeOpacity); } catch (_) {}
    const { loadSettings, saveSettings, broadcastSettingsUpdate } = require('../services/settingsService');
    const settings = loadSettings();
    if (settings.rememberWindowOpacity) {
        settings.windowOpacity = safeOpacity;
        saveSettings(settings);
        broadcastSettingsUpdate(settings);
    }
    try { win.webContents.send(C.IPC_EVENT.WINDOW_OPACITY_CHANGED, { opacity: safeOpacity, source: 'menu' }); } catch (_) {}
}

function jumpWindowOpacityBreakpoint(direction) {
    const win = getFocusedShellWindow() || State.mainWindow;
    if (!win || win.isDestroyed()) return;
    const BREAKPOINTS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];
    const curr = typeof win.getOpacity === 'function' ? win.getOpacity() : 1.0;
    const curRounded = Math.round(curr * 100) / 100;
    let target;
    if (direction > 0) {
        target = BREAKPOINTS.find((bp) => bp >= curRounded + 0.05) ?? 1.00;
    } else {
        const reversed = [...BREAKPOINTS].reverse();
        target = reversed.find((bp) => bp <= curRounded - 0.05) ?? 0.10;
    }
    setFocusedWindowOpacity(target);
}

function buildApplicationMenu() {
    const tabManager = require('../windows/tabManager');
    const windowManager = require('../windows/windowManager');
    const isMac = process.platform === 'darwin';

    return Menu.buildFromTemplate([
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Tab',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_NEW_TAB)
                },
                {
                    label: 'New Stealth Window',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        windowManager.createWindow({ profileId: context.profileId, stealthWindow: true });
                    },
                },
                {
                    label: 'New Ghost Window',
                    accelerator: 'CmdOrCtrl+Alt+G',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        const profileId = context?.profileId || State.defaultProfileId;
                        windowManager.createWindow({ profileId, ghostWindow: true });
                    },
                },
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        windowManager.createWindow({ profileId: context.profileId });
                    },
                },
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_CLOSE_TAB)
                },
                {
                    label: 'Print...',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => tabManager.printActiveTab(),
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_RELOAD)
                },
                { type: 'separator' },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => tabManager.zoomInActiveTab(),
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => tabManager.zoomOutActiveTab(),
                },
                {
                    label: 'Reset Zoom',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => tabManager.resetZoomActiveTab(),
                },
                { type: 'separator' },
                {
                    label: 'Transparency Mode',
                    submenu: [
                        {
                            label: 'Next Breakpoint (+10%)',
                            accelerator: 'CmdOrCtrl+Shift+Plus',
                            click: () => jumpWindowOpacityBreakpoint(1),
                        },
                        {
                            label: 'Previous Breakpoint (-10%)',
                            accelerator: 'CmdOrCtrl+Shift+-',
                            click: () => jumpWindowOpacityBreakpoint(-1),
                        },
                        { type: 'separator' },
                        { label: '10% (Minimal Opacity)', click: () => setFocusedWindowOpacity(0.10) },
                        { label: '20%', click: () => setFocusedWindowOpacity(0.20) },
                        { label: '30%', click: () => setFocusedWindowOpacity(0.30) },
                        { label: '40%', click: () => setFocusedWindowOpacity(0.40) },
                        { label: '50% (Medium Opacity)', click: () => setFocusedWindowOpacity(0.50) },
                        { label: '60%', click: () => setFocusedWindowOpacity(0.60) },
                        { label: '70%', click: () => setFocusedWindowOpacity(0.70) },
                        { label: '80%', click: () => setFocusedWindowOpacity(0.80) },
                        { label: '90%', click: () => setFocusedWindowOpacity(0.90) },
                        { label: '100% (Solid Opacity)', click: () => setFocusedWindowOpacity(1.00) },
                    ],
                },
                { type: 'separator' },
                {
                    label: 'Settings page',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => tabManager.openOrActivateSettingsTab(),
                },
                {
                    label: 'Developer',
                    submenu: [
                        {
                            label: 'View Source',
                            click: () => tabManager.openViewSourceForActiveTab(),
                        },
                        {
                            label: 'Inspect Elements',
                            click: () => tabManager.openDevToolsForActiveTab('elements'),
                        },
                        {
                            label: 'JavaScript Console',
                            click: () => tabManager.openDevToolsForActiveTab('console'),
                        },
                    ],
                },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'History',
            submenu: [
                {
                    label: 'Show History',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY),
                },
                { type: 'separator' },
                { label: 'Home', click: () => tabManager.navigateActiveTabHome() },
                { label: 'Back', click: () => tabManager.goBackInActiveTab() },
                { label: 'Forward', click: () => tabManager.goForwardInActiveTab() },
                { type: 'separator' },
                {
                    label: 'Reopen Closed Tab',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    enabled: (() => {
                        const context = getWindowContextForShellFallback();
                        const { getOrCreateRecentlyClosedForProfile } = require('../services/sessionService');
                        const profileId = context?.profileId || State.defaultProfileId;
                        return !!profileId && getOrCreateRecentlyClosedForProfile(profileId).length > 0;
                    })(),
                    click: () => restoreRecentlyClosed(),
                },
                { label: 'Recently Closed', enabled: false },
                ...buildRecentlyClosedMenuItems(),
            ]
        },
        {
            label: 'Tab',
            submenu: [
                {
                    label: 'New Tab to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_NEW_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Select Next Tab',
                    accelerator: 'Control+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: 1 }),
                },
                {
                    label: 'Select Previous Tab',
                    accelerator: 'Control+Shift+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: -1 }),
                },
                { type: 'separator' },
                {
                    label: 'Duplicate Tab',
                    accelerator: 'CommandOrControl+Shift+D',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_DUPLICATE),
                },
                {
                    label: State.tabMenuMuteSiteShowsUnmute ? 'Unmute Site' : 'Mute Site',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MUTE),
                },
                {
                    label: State.tabMenuPinShowsUnpin ? 'Unpin Tab' : 'Pin Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_PIN),
                },
                {
                    label: 'Group Tab',
                    enabled: false,
                },
                { type: 'separator' },
                {
                    label: 'Close Other Tabs',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_OTHERS),
                },
                {
                    label: 'Close Tabs to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Move Tab to New Window',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MOVE_WINDOW),
                },
                {
                    label: 'Search Tabs…',
                    accelerator: 'Shift+CommandOrControl+A',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_SEARCH),
                },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Search…',
                    accelerator: 'CommandOrControl+Shift+P',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_COMMAND_PALETTE),
                },
            ],
        },
    ]);
}

function runMenuCommandFromPalette(commandId) {
    const tabManager = require('../windows/tabManager');
    const windowManager = require('../windows/windowManager');
    const lensManager = require('../windows/lensManager');

    switch (commandId) {
        case C.MENU_COMMAND.OPEN_SETTINGS:
            tabManager.openOrActivateSettingsTab();
            return true;
        case C.MENU_COMMAND.NAVIGATE_HOME:
            tabManager.navigateActiveTabHome();
            return true;
        case C.MENU_COMMAND.HISTORY_BACK:
            tabManager.goBackInActiveTab();
            return true;
        case C.MENU_COMMAND.HISTORY_FORWARD:
            tabManager.goForwardInActiveTab();
            return true;
        case C.MENU_COMMAND.VIEW_SOURCE:
            tabManager.openViewSourceForActiveTab();
            return true;
        case C.MENU_COMMAND.DEVTOOLS_ELEMENTS:
            tabManager.openDevToolsForActiveTab(C.DEVTOOLS_PANEL.ELEMENTS);
            return true;
        case C.MENU_COMMAND.DEVTOOLS_CONSOLE:
            tabManager.openDevToolsForActiveTab(C.DEVTOOLS_PANEL.CONSOLE);
            return true;
        case C.MENU_COMMAND.TOGGLE_FULLSCREEN:
            if (State.mainWindow && !State.mainWindow.isDestroyed()) {
                State.mainWindow.setFullScreen(!State.mainWindow.isFullScreen());
            }
            return true;
        case C.MENU_COMMAND.QUIT:
            app.quit();
            return true;
        case C.MENU_COMMAND.NEW_WINDOW_CURRENT_PROFILE: {
            const context = getWindowContextByBrowserWindow(State.mainWindow);
            if (!context) return false;
            windowManager.createWindow({ profileId: context.profileId });
            return true;
        }
        case C.MENU_COMMAND.EDIT_UNDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.undo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_REDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.redo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_CUT: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.cut();
            return true;
        }
        case C.MENU_COMMAND.EDIT_COPY: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.copy();
            return true;
        }
        case C.MENU_COMMAND.EDIT_PASTE: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.paste();
            return true;
        }
        case C.MENU_COMMAND.EDIT_SELECT_ALL: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.selectAll();
            return true;
        }
        case C.MENU_COMMAND.OPEN_DOWNLOADS:
            return openDownloadsFolder();
        case C.MENU_COMMAND.PRINT_ACTIVE_TAB:
            return tabManager.printActiveTab();
        case C.MENU_COMMAND.FIND_IN_PAGE:
            return tabManager.triggerFindInActiveTab();
        case C.MENU_COMMAND.SEARCH_WITH_GOOGLE_LENS:
            return lensManager.startGoogleLensSelection();
        default:
            return false;
    }
}

function rebuildApplicationMenu() {
    if (!State.mainWindow || State.mainWindow.isDestroyed()) return;
    Menu.setApplicationMenu(buildApplicationMenu());
}

module.exports = {
    openDownloadsFolder,
    buildApplicationMenu,
    runMenuCommandFromPalette,
    rebuildApplicationMenu
};