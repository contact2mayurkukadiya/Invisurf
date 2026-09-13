import { paletteSvg, shieldSvg, globeSvg, menuMonitorSvg, powerSvg, keyboardSvg } from "./appAssetUrls";

export const SETTINGS_NAV_ITEMS = [
    {
        id: 'privacy/main',
        section: 'privacy',
        label: 'Privacy and security',
        icon: shieldSvg,
    },
    {
        id: 'appearance',
        section: 'appearance',
        label: 'Appearance',
        icon: paletteSvg,
    },
    {
        id: 'shortcuts',
        section: 'shortcuts',
        label: 'Shortcuts',
        icon: keyboardSvg,
    },
    {
        id: 'search_engine',
        section: 'search_engine',
        label: 'Search engine',
        icon: globeSvg,
    },
    {
        id: 'default_browser',
        section: 'default_browser',
        label: 'Default browser',
        icon: menuMonitorSvg,
    },
    {
        id: 'on_startup',
        section: 'on_startup',
        label: 'On startup',
        icon: powerSvg,
    },
];

export const SHORTCUT_DEFINITIONS = [
    {
        category: 'Transparency Mode',
        items: [
            { id: 'transparencyNextBreakpoint', label: 'Next Breakpoint (+10% Opacity)', defaultShortcut: 'CmdOrCtrl+Shift+Plus', description: 'Jump forward to next transparency breakpoint' },
            { id: 'transparencyPrevBreakpoint', label: 'Previous Breakpoint (-10% Opacity)', defaultShortcut: 'CmdOrCtrl+Shift+-', description: 'Jump backward to previous transparency breakpoint' },
            { id: 'bossKey', label: 'Boss Key (Quick Minimize)', defaultShortcut: 'CmdOrCtrl+Alt+H', description: 'Instantly hides or minimizes the window' },
        ],
    },
    {
        category: 'Tabs & Windows',
        items: [
            { id: 'newTab', label: 'New Tab', defaultShortcut: 'CmdOrCtrl+T', description: 'Opens a new tab' },
            { id: 'closeTab', label: 'Close Tab', defaultShortcut: 'CmdOrCtrl+W', description: 'Closes the current tab' },
            { id: 'reopenTab', label: 'Reopen Closed Tab', defaultShortcut: 'CmdOrCtrl+Shift+T', description: 'Reopens the most recently closed tab' },
            { id: 'newWindow', label: 'New Window', defaultShortcut: 'CmdOrCtrl+N', description: 'Opens a new browser window' },
            { id: 'newStealthWindow', label: 'New Incognito Window', defaultShortcut: 'CmdOrCtrl+Shift+N', description: 'Opens a private browsing window' },
            { id: 'history', label: 'Show History', defaultShortcut: 'CmdOrCtrl+Y', description: 'Opens browsing history' },
            { id: 'print', label: 'Print Tab', defaultShortcut: 'CmdOrCtrl+P', description: 'Prints the current page' },
            { id: 'zoomIn', label: 'Zoom In', defaultShortcut: 'CmdOrCtrl+Plus', description: 'Zooms in the active tab' },
            { id: 'zoomOut', label: 'Zoom Out', defaultShortcut: 'CmdOrCtrl+-', description: 'Zooms out the active tab' },
            { id: 'zoomReset', label: 'Reset Zoom', defaultShortcut: 'CmdOrCtrl+0', description: 'Resets active tab zoom to 100%' },
        ],
    },
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(
    SHORTCUT_DEFINITIONS.flatMap((cat) => cat.items.map((it) => [it.id, it.defaultShortcut]))
);

export const REPORT_NAV_ITEMS = [
    { id: 'browser_identity', section: 'browser_identity', label: 'Browser identity verification' },
    { id: 'compatibility', section: 'compatibility', label: 'Compatibility diagnostics' },
    { id: 'crash_reports', section: 'crash_reports', label: 'Crash reports' },
];

export const STARTUP_OPTIONS = [
    {
        value: 'fresh',
        label: 'Fresh start',
        description: 'Start with a single new tab. Tabs from the previous session are not restored.',
    },
    {
        value: 'continue',
        label: 'Continue where you left off',
        description: 'Restore all open tabs from your last session on next launch.',
    },
    {
        value: 'clearHistory',
        label: 'Clear everything on startup',
        description: 'Clear browsing history and start with a single new tab on next launch.',
    },
];

export const SEARCH_ENGINE_OPTIONS = [
    {
        value: 'google',
        label: 'Google',
        description: 'Search with Google (google.com).',
    },
    {
        value: 'bing',
        label: 'Bing',
        description: 'Search with Microsoft Bing (bing.com).',
    },
    {
        value: 'brave',
        label: 'Brave Search',
        description: 'Search with Brave Search — independent index, no tracking (search.brave.com).',
    },
    {
        value: 'duckDuckGo',
        label: 'DuckDuckGo',
        description: 'Search with DuckDuckGo — privacy-first search (duckduckgo.com).',
    },
];

export const APPEARANCE_MODE_SEGMENTS = [
    { value: 'light', label: 'Light', title: 'Always use light appearance' },
    { value: 'dark', label: 'Dark', title: 'Always use dark appearance' },
    { value: 'automatic', label: 'Device', title: 'Match your system light or dark mode' },
];

export const LOG_CLEAR_RANGES = [
    { label: 'Last 30 min', ms: 30 * 60 * 1000 },
    { label: 'Last hour', ms: 60 * 60 * 1000 },
    { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
    { label: 'All time', ms: null },
];

export const COOKIE_POLICY_OPTIONS = [
    {
        value: 'allow',
        label: 'Allow all cookies',
        description: 'Sites can use cookies to improve your browsing experience',
    },
    {
        value: 'block_third_party',
        label: 'Block third-party cookies',
        description: 'Sites cannot use cookies to see your activity across other sites',
    },
    {
        value: 'block_all',
        label: 'Block all cookies (Not recommended)',
        description: 'Prevents sites from using cookies. Many features like signing in might break.',
    },
];

export const COOKIE_EXCEPTION_GROUPS = [
    {
        setting: 'allow',
        title: 'Sites that can always use cookies',
        empty: 'No sites added',
        status: 'Allowed',
        sample: '[*.]example.com',
    },
    {
        setting: 'session_only',
        title: 'Always clear cookies when windows are closed',
        empty: 'No sites added',
        status: 'Clear on exit',
        sample: '[*.]example.com',
    },
    {
        setting: 'block',
        title: 'Sites that can never use cookies',
        empty: 'No sites added',
        status: 'Blocked',
        sample: 'tracker-network.com',
    },
];
