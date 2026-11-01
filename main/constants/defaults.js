// src/main/constants/defaults.js
const path = require('path');
const { app } = require('electron');
const C = require('../../src/constants/conditionStrings.cjs');

const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar
const MAX_RECENTLY_CLOSED_TABS = 25;

// Profile defaults
const MAX_PROFILE_AVATAR_BYTES = 512 * 1024;
const PRESET_AVATAR_PNG_DIR = path.join(
    (app && typeof app.getAppPath === 'function') ? app.getAppPath() : path.resolve(__dirname, '..', '..'),
    'renderer',
    'assets',
    'images',
    'profiles'
);

// Navigation guards
const MAX_MAINFRAME_REDIRECTS = 12;
const REDIRECT_WINDOW_MS = 10000;
const TRACKING_REDIRECT_HOST_MARKERS = [
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'pubmatic.com',
    'openx.net',
    'smartadserver.com',
    'smilewanted.com',
    'adsrvr.org',
];

const CANONICAL_NTP_HTML = C.URL.NTP_CANONICAL_HTML;

// Overlay limitations
const CHROME_OVERLAY_POST_MAX_BYTES = 4 * 1024 * 1024;
const SHELL_MENU_OVERLAY_KINDS = new Set([
    'appMenu',
    'profileMenu',
    'bookmarkContextMenu',
    'bookmarkFolderMenu',
    'bookmarkEditor',
    'siteInfo',
    'cookieControls',
    'downloadPanel',
    'transparencyMenu',
    'clickThroughOSD',
    'permissionPrompt',
    'extensionInstallPrompt',
    'extensionMenu',
    'zoomReset',
]);

const COOKIE_CONFIG_DEFAULTS = {
    globalPolicy: 'allow',
    exceptions: [],
};

const DEFAULT_SHORTCUTS = {
    transparencyNextBreakpoint: 'CmdOrCtrl+Shift+Plus',
    transparencyPrevBreakpoint: 'CmdOrCtrl+Shift+-',
    toggleClickThrough: 'CmdOrCtrl+Shift+G',
    bossKey: 'CmdOrCtrl+Alt+H',
    newTab: 'CmdOrCtrl+T',
    newWindow: 'CmdOrCtrl+N',
    newStealthWindow: 'CmdOrCtrl+Shift+N',
    closeTab: 'CmdOrCtrl+W',
    reopenTab: 'CmdOrCtrl+Shift+T',
    history: 'CmdOrCtrl+Y',
    print: 'CmdOrCtrl+P',
    zoomIn: 'CmdOrCtrl+Plus',
    zoomOut: 'CmdOrCtrl+-',
    zoomReset: 'CmdOrCtrl+0',
};

const SETTINGS_DEFAULTS = {
    contentProtection: true,
    startupBehavior: 'continue', // 'fresh' | 'continue' | 'clearHistory'
    compatibilityDiagnosticsEnabled: false,
    searchEngine: 'google', // 'google' | 'bing' | 'brave' | 'duckDuckGo'
    colorTheme: 'automatic', // 'automatic' | 'dark' | 'light'
    accentTheme: 'default',
    accentCustomHex: null,
    cookieConfig: COOKIE_CONFIG_DEFAULTS,
    cookieConfigByProfile: {},
    windowOpacity: 1.0,
    rememberWindowOpacity: true,
    autoFadeOnBlur: false,
    autoFadeBlurOpacity: 0.30,
    shortcuts: DEFAULT_SHORTCUTS,
};

const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    brave: 'https://search.brave.com/search?q=',
    duckDuckGo: 'https://duckduckgo.com/?q=',
};

const TAB_STRIP_CONTEXT_MENU_MAX_ITEMS = 30;
const TAB_STRIP_CONTEXT_MENU_ACTION_IDS = new Set([
    'newTabRight',
    'moveNewWindow',
    C.IPC_SEND.RELOAD,
    'duplicate',
    'togglePin',
    'toggleMuteSite',
    'close',
    'closeOthers',
    'closeRight',
]);

module.exports = {
    UI_HEIGHT,
    MAX_RECENTLY_CLOSED_TABS,
    MAX_PROFILE_AVATAR_BYTES,
    PRESET_AVATAR_PNG_DIR,
    MAX_MAINFRAME_REDIRECTS,
    REDIRECT_WINDOW_MS,
    TRACKING_REDIRECT_HOST_MARKERS,
    CANONICAL_NTP_HTML,
    CHROME_OVERLAY_POST_MAX_BYTES,
    SHELL_MENU_OVERLAY_KINDS,
    COOKIE_CONFIG_DEFAULTS,
    DEFAULT_SHORTCUTS,
    SETTINGS_DEFAULTS,
    SEARCH_ENGINES,
    TAB_STRIP_CONTEXT_MENU_MAX_ITEMS,
    TAB_STRIP_CONTEXT_MENU_ACTION_IDS
};