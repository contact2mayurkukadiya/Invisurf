const { contextBridge, ipcRenderer, clipboard, webFrame } = require('electron');

const appMajor = process.versions.chrome.split('.')[0] || '146';
const osPlatform = process.platform === 'darwin' ? 'macOS' : 'Windows';

const mappedStandardBrands = [
    { brand: 'Not_A Brand', version: '99' },
    { brand: 'Chromium', version: appMajor },
    { brand: 'Google Chrome', version: appMajor }
];

const compliantUserAgentData = {
    brands: mappedStandardBrands,
    mobile: false,
    platform: osPlatform,
    getHighEntropyValues: async (queryHints) => {
        const metadataPayload = {
            brands: mappedStandardBrands,
            mobile: false,
            platform: osPlatform
        };
        if (queryHints.includes('platformVersion')) {
            metadataPayload.platformVersion = process.platform === 'darwin' ? '14.0.0' : '10.0.0';
        }
        if (queryHints.includes('architecture')) {
            metadataPayload.architecture = 'x86';
        }
        if (queryHints.includes('bitness')) {
            metadataPayload.bitness = '64';
        }
        return metadataPayload;
    }
};

// Immediate top-level Chrome Web Store bridge registration (runs before any other preload logic)
try {
    contextBridge.exposeInMainWorld('__invisurf_webstore', {
        isInstalled: (extensionId) => ipcRenderer.invoke('extensions:is-installed', { extensionId }),
        prepareInstall: (extensionId) => ipcRenderer.invoke('extensions:webstore-prepare-install', { extensionId }),
        onInstallCompleted: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, data) => {
                try { callback(data); } catch (_) {}
            };
            ipcRenderer.on('extensions:install-completed', handler);
            return () => ipcRenderer.removeListener('extensions:install-completed', handler);
        },
        onInstallCancelled: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, data) => {
                try { callback(data); } catch (_) {}
            };
            ipcRenderer.on('extensions:install-cancelled', handler);
            return () => ipcRenderer.removeListener('extensions:install-cancelled', handler);
        },
    });

    // Bridge installation lifecycle events to window and document for webstore script
    ipcRenderer.on('extensions:install-completed', (_event, data) => {
        try {
            window.dispatchEvent(new CustomEvent('invisurf:install-completed', { detail: data }));
            if (typeof document !== 'undefined' && document.dispatchEvent) {
                document.dispatchEvent(new CustomEvent('invisurf:install-completed', { detail: data }));
            }
        } catch (_) {}
    });

    ipcRenderer.on('extensions:install-cancelled', (_event, data) => {
        try {
            window.dispatchEvent(new CustomEvent('invisurf:install-cancelled', { detail: data }));
            if (typeof document !== 'undefined' && document.dispatchEvent) {
                document.dispatchEvent(new CustomEvent('invisurf:install-cancelled', { detail: data }));
            }
        } catch (_) {}
    });
} catch (webstoreInitErr) {
    console.warn('[Preload] Failed to initialize webstore bridge at document_start:', webstoreInitErr?.message || webstoreInitErr);
}

try {
    // Inject the spoofed userAgentData and other browser signals into the main world so scripts can see it.
    if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        // Synchronously run registered document_start scripts (e.g. React DevTools installHook.js, proxy.js, prepareInjection.js)
        try {
            const startScripts = ipcRenderer.sendSync('extensions:get-document-start-scripts', {
                url: window.location.href,
            });
            if (Array.isArray(startScripts) && startScripts.length > 0) {
                for (const s of startScripts) {
                    if (s && s.code) {
                        try {
                            if (s.world === 'MAIN') {
                                let injectedSync = false;
                                try {
                                    const root = document.head || document.documentElement || document;
                                    if (root && typeof root.appendChild === 'function') {
                                        const sc = document.createElement('script');
                                        sc.textContent = s.code;
                                        root.appendChild(sc);
                                        sc.remove();
                                        injectedSync = true;
                                    }
                                } catch (_) {}
                                if (!injectedSync) {
                                    try {
                                        webFrame.executeJavaScript(s.code);
                                    } catch (_) {
                                        if (typeof webFrame.executeJavaScriptInIsolatedWorld === 'function') {
                                            webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: s.code }]);
                                        }
                                    }
                                }
                            } else {
                                webFrame.executeJavaScript(s.code);
                            }
                        } catch (err) {
                            console.warn(`[Preload StartScript Error] ${s.id || s}:`, err?.message || err);
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[Preload startScripts outer error]:', err?.message || err);
        }

        try {
            ipcRenderer.on('invisurf-ext-event', (event, payload) => {
                try {
                    window.postMessage({ source: 'invisurf-ext-event', payload }, '*');
                } catch (_) {}
            });
        } catch (_) {}

        webFrame.executeJavaScript(`
            try {
                // 1. Spoof navigator.userAgentData
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => (${JSON.stringify(compliantUserAgentData)}),
                    configurable: true,
                    enumerable: true
                });

                // 2. Spoof window.chrome (essential for Google login)
                if (!window.chrome) {
                    window.chrome = {};
                }
                window.chrome.app = window.chrome.app || {
                    isInstalled: false,
                    InstallState: {
                        DISABLED: 'disabled',
                        INSTALLED: 'installed',
                        NOT_INSTALLED: 'not_installed'
                    },
                    RunningState: {
                        CANNOT_RUN: 'cannot_run',
                        READY_TO_RUN: 'ready_to_run',
                        RUNNING: 'running'
                    }
                };
                window.chrome.webstorePrivate = window.chrome.webstorePrivate || {
                    install: function(id, callback) {
                        const cleanId = typeof id === 'string' ? id : (id?.id || '');
                        if (window.__invisurf_webstore?.prepareInstall && cleanId) {
                            const onCompleted = (e) => {
                                if (!e.detail?.extensionId || e.detail.extensionId === cleanId) {
                                    window.removeEventListener('invisurf:install-completed', onCompleted);
                                    window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                    if (typeof callback === 'function') callback('');
                                }
                            };
                            const onCancelled = (e) => {
                                if (!e.detail?.extensionId || e.detail.extensionId === cleanId) {
                                    window.removeEventListener('invisurf:install-completed', onCompleted);
                                    window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                    if (typeof callback === 'function') callback('user_cancelled');
                                }
                            };
                            window.addEventListener('invisurf:install-completed', onCompleted);
                            window.addEventListener('invisurf:install-cancelled', onCancelled);
                            window.__invisurf_webstore.prepareInstall(cleanId).catch((err) => {
                                window.removeEventListener('invisurf:install-completed', onCompleted);
                                window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                if (typeof callback === 'function') callback(err?.message || 'unknown_error');
                            });
                        } else if (typeof callback === 'function') {
                            callback('');
                        }
                    },
                    beginInstallWithManifest3: function(details, callback) {
                        const cleanId = typeof details === 'string' ? details : (details?.id || '');
                        if (window.__invisurf_webstore?.prepareInstall && cleanId) {
                            const onCompleted = (e) => {
                                if (!e.detail?.extensionId || e.detail.extensionId === cleanId) {
                                    window.removeEventListener('invisurf:install-completed', onCompleted);
                                    window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                    if (typeof callback === 'function') callback('');
                                }
                            };
                            const onCancelled = (e) => {
                                if (!e.detail?.extensionId || e.detail.extensionId === cleanId) {
                                    window.removeEventListener('invisurf:install-completed', onCompleted);
                                    window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                    if (typeof callback === 'function') callback('user_cancelled');
                                }
                            };
                            window.addEventListener('invisurf:install-completed', onCompleted);
                            window.addEventListener('invisurf:install-cancelled', onCancelled);
                            window.__invisurf_webstore.prepareInstall(cleanId).catch((err) => {
                                window.removeEventListener('invisurf:install-completed', onCompleted);
                                window.removeEventListener('invisurf:install-cancelled', onCancelled);
                                if (typeof callback === 'function') callback(err?.message || 'unknown_error');
                            });
                        } else if (typeof callback === 'function') {
                            callback('');
                        }
                    },
                    installBundle: function(details, callback) {
                        if (typeof callback === 'function') callback('');
                    },
                    completeInstall: function(id, callback) {
                        if (typeof callback === 'function') callback();
                    },
                    enable: function(id, callback) {
                        if (typeof callback === 'function') callback();
                    },
                    getBrowserLogin: function(callback) {
                        if (typeof callback === 'function') callback({ login: '' });
                    },
                    getStoreLogin: function(callback) {
                        if (typeof callback === 'function') callback('');
                    },
                    isInIncognitoMode: function(callback) {
                        if (typeof callback === 'function') callback(false);
                    },
                    getIsLauncherEnabled: function(callback) {
                        if (typeof callback === 'function') callback(false);
                    }
                };
                window.chrome.runtime = window.chrome.runtime || {
                    OnInstalledReason: {
                        CHROME_UPDATE: 'chrome_update',
                        INSTALL: 'install',
                        SHARED_MODULE_UPDATE: 'shared_module_update',
                        UPDATE: 'update'
                    },
                    OnRestartRequiredReason: {
                        APP_UPDATE: 'app_update',
                        OS_UPDATE: 'os_update',
                        PERIODIC: 'periodic'
                    },
                    PlatformArch: {
                        ARM: 'arm',
                        ARM64: 'arm64',
                        MIPS: 'mips',
                        MIPS64: 'mips64',
                        X86_32: 'x86-32',
                        X86_64: 'x86-64'
                    },
                    PlatformNaclArch: {
                        ARM: 'arm',
                        MIPS: 'mips',
                        MIPS64: 'mips64',
                        X86_32: 'x86-32',
                        X86_64: 'x86-64'
                    },
                    PlatformOs: {
                        ANDROID: 'android',
                        CROS: 'cros',
                        LINUX: 'linux',
                        MAC: 'mac',
                        OPENBSD: 'openbsd',
                        WIN: 'win'
                    },
                    RequestUpdateCheckStatus: {
                        NO_UPDATE: 'no_update',
                        THROTTLED: 'throttled',
                        UPDATE_AVAILABLE: 'update_available'
                    }
                };
                // Mock loadTimes (deprecated but often checked by legacy scripts)
                window.chrome.loadTimes = window.chrome.loadTimes || function() {
                    return {
                        requestTime: performance.timing.navigationStart / 1000,
                        startLoadTime: performance.timing.navigationStart / 1000,
                        commitLoadTime: performance.timing.responseStart / 1000,
                        finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
                        finishLoadTime: performance.timing.loadEventEnd / 1000,
                        firstPaintTime: (performance.timing.navigationStart + performance.now()) / 1000,
                        firstPaintAfterLoadTime: 0,
                        navigationType: "Other",
                        wasFetchedViaSpdy: true,
                        wasNpnNegotiated: true,
                        npnNegotiatedProtocol: "h2",
                        wasAlternateProtocolAvailable: false,
                        connectionInfo: "h2"
                    };
                };
                // Mock csi
                window.chrome.csi = window.chrome.csi || function() {
                    return {
                        startE: performance.timing.navigationStart,
                        onloadT: performance.timing.domContentLoadedEventEnd,
                        pageT: performance.timing.loadEventEnd - performance.timing.navigationStart,
                        tran: 15
                    };
                };

                // 3. Spoof Plugins and MimeTypes
                if (navigator.plugins.length === 0) {
                    const PluginArray = function() {};
                    PluginArray.prototype = Object.create(Array.prototype);
                    PluginArray.prototype.refresh = function() {};
                    PluginArray.prototype.item = function(i) { return this[i]; };
                    PluginArray.prototype.namedItem = function(name) {
                        for (let i = 0; i < this.length; i++) {
                            if (this[i].name === name) return this[i];
                        }
                        return null;
                    };

                    const plugins = new PluginArray();
                    const pdfPlugin = {
                        0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        1: { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 2,
                        name: "Chrome PDF Plugin"
                    };
                    pdfPlugin[0].enabledPlugin = pdfPlugin;
                    pdfPlugin[1].enabledPlugin = pdfPlugin;
                    
                    const pdfViewer = {
                        0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        1: { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 2,
                        name: "Chrome PDF Viewer"
                    };
                    pdfViewer[0].enabledPlugin = pdfViewer;
                    pdfViewer[1].enabledPlugin = pdfViewer;

                    const nativeClient = {
                        0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable", enabledPlugin: null },
                        1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable", enabledPlugin: null },
                        description: "",
                        filename: "internal-nacl-plugin",
                        length: 2,
                        name: "Native Client"
                    };
                    nativeClient[0].enabledPlugin = nativeClient;
                    nativeClient[1].enabledPlugin = nativeClient;

                    plugins.push(pdfPlugin, pdfViewer, nativeClient);
                    
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => plugins,
                        configurable: true,
                        enumerable: true
                    });

                    const MimeTypeArray = function() {};
                    MimeTypeArray.prototype = Object.create(Array.prototype);
                    MimeTypeArray.prototype.item = function(i) { return this[i]; };
                    MimeTypeArray.prototype.namedItem = function(name) {
                        for (let i = 0; i < this.length; i++) {
                            if (this[i].type === name) return this[i];
                        }
                        return null;
                    };

                    const mimeTypes = new MimeTypeArray();
                    mimeTypes.push(pdfPlugin[0], pdfPlugin[1], nativeClient[0], nativeClient[1]);

                    Object.defineProperty(navigator, 'mimeTypes', {
                        get: () => mimeTypes,
                        configurable: true,
                        enumerable: true
                    });
                }

                // 4. Override WebAuthn (navigator.credentials)
                if (window.__invisurf_webauthn) {
                    const originalCreate = navigator.credentials.create.bind(navigator.credentials);
                    const originalGet = navigator.credentials.get.bind(navigator.credentials);

                    navigator.credentials.create = async function(options) {
                        if (options && options.publicKey) {
                            try {
                                const result = await window.__invisurf_webauthn.create(options.publicKey);
                                if (result && result.success) {
                                    // Convert base64url strings back to ArrayBuffers
                                    const base64urlToBuffer = (base64url) => {
                                        if (!base64url) return null;
                                        const padding = '='.repeat((4 - base64url.length % 4) % 4);
                                        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
                                        const rawData = window.atob(base64);
                                        const outputArray = new Uint8Array(rawData.length);
                                        for (let i = 0; i < rawData.length; ++i) {
                                            outputArray[i] = rawData.charCodeAt(i);
                                        }
                                        return outputArray.buffer;
                                    };

                                    return {
                                        id: result.data.credentialId,
                                        rawId: base64urlToBuffer(result.data.credentialId),
                                        type: 'public-key',
                                        response: {
                                            clientDataJSON: base64urlToBuffer(result.data.clientDataJSON),
                                            attestationObject: base64urlToBuffer(result.data.attestationObject),
                                            getAuthenticatorData: () => base64urlToBuffer(result.data.authData),
                                            getPublicKey: () => base64urlToBuffer(result.data.publicKey),
                                            getPublicKeyAlgorithm: () => result.data.publicKeyAlgorithm,
                                            getTransports: () => result.data.transports
                                        },
                                        authenticatorAttachment: 'platform',
                                        getClientExtensionResults: () => ({})
                                    };
                                } else {
                                    throw new DOMException(result.error || 'NotAllowedError', result.error || 'NotAllowedError');
                                }
                            } catch (e) {
                                throw new DOMException(e.message, 'NotAllowedError');
                            }
                        }
                        return originalCreate(options);
                    };

                    navigator.credentials.get = async function(options) {
                        if (options && options.publicKey) {
                            try {
                                const result = await window.__invisurf_webauthn.get(options.publicKey);
                                if (result && result.success) {
                                    const base64urlToBuffer = (base64url) => {
                                        if (!base64url) return null;
                                        const padding = '='.repeat((4 - base64url.length % 4) % 4);
                                        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
                                        const rawData = window.atob(base64);
                                        const outputArray = new Uint8Array(rawData.length);
                                        for (let i = 0; i < rawData.length; ++i) {
                                            outputArray[i] = rawData.charCodeAt(i);
                                        }
                                        return outputArray.buffer;
                                    };

                                    return {
                                        id: result.data.credentialId,
                                        rawId: base64urlToBuffer(result.data.credentialId),
                                        type: 'public-key',
                                        response: {
                                            clientDataJSON: base64urlToBuffer(result.data.clientDataJSON),
                                            authenticatorData: base64urlToBuffer(result.data.authenticatorData),
                                            signature: base64urlToBuffer(result.data.signature),
                                            userHandle: base64urlToBuffer(result.data.userHandle)
                                        },
                                        authenticatorAttachment: 'platform',
                                        getClientExtensionResults: () => ({})
                                    };
                                } else {
                                    throw new DOMException(result.error || 'NotAllowedError', result.error || 'NotAllowedError');
                                }
                            } catch (e) {
                                throw new DOMException(e.message, 'NotAllowedError');
                            }
                        }
                        return originalGet(options);
                    };
                }

            } catch (_) {}
        `);
    }

    // Also apply userAgentData to the isolated world just in case
    Object.defineProperty(navigator, 'userAgentData', {
        get: () => compliantUserAgentData,
        configurable: true,
        enumerable: true
    });
} catch (_) { }

// Keep preload self-contained: it runs with sandbox: true, where requiring
// arbitrary local project files can fail before electronAPI is exposed.
const C = Object.freeze({
    "IPC_INVOKE": {
        "RUN_MENU_COMMAND": "app:run-menu-command",
        "GOOGLE_LENS_ACTIVE_FOR_PROFILE": "google-lens:active-for-profile",
        "IS_STEALTH_WINDOW": "context:is-stealth-window",
        "IS_GHOST_WINDOW": "context:is-ghost-window",
        "WINDOW_CREATE": "window:create",
        "WINDOW_CREATE_STEALTH": "window:create-stealth",
        "WINDOW_CREATE_GHOST": "window:create-ghost",
        "WINDOW_CLOSE_IF_STEALTH": "window:close-if-stealth",
        "WINDOW_CLOSE_CURRENT": "window:close-current",
        "GHOST_CLOSE": "ghost:close",
        "GHOST_TOGGLE_CLICK_THROUGH": "ghost:toggle-click-through",
        "GHOST_SET_CLICK_THROUGH": "ghost:set-click-through",
        "GHOST_GET_CLICK_THROUGH": "ghost:get-click-through",
        "WINDOW_GET_BOOTSTRAP": "window:get-bootstrap",
        "PROFILE_LIST": "profile:list",
        "PROFILE_GET_CURRENT": "profile:get-current",
        "PROFILE_CREATE": "profile:create",
        "PROFILE_UPDATE": "profile:update",
        "PROFILE_SET_AVATAR_DATA": "profile:setAvatarData",
        "PROFILE_SET_AVATAR_PRESET": "profile:setAvatarFromPresetPng",
        "PROFILE_VALIDATE_AVATAR": "profile:validateAvatarData",
        "PROFILE_LIST_PRESETS": "profile:list-preset-avatar-pngs",
        "PROFILE_CLEAR_AVATAR": "profile:clearAvatar",
        "PROFILE_GET_AVATAR": "profile:getAvatarDataUrl",
        "PROFILE_DELETE": "profile:delete",
        "PROFILE_GET_DATA_SUMMARY": "profile:get-data-summary",
        "PROFILE_OPEN_WINDOW": "profile:open-window",
        "PROFILE_PICKER_OPEN": "profile:picker-open",
        "PROFILE_CLOSE_CURRENT": "profile:close-current",
        "RECENTLY_CLOSED_LIST": "recently-closed:list",
        "RECENTLY_CLOSED_RESTORE": "recently-closed:restore",
        "CHROME_OVERLAY_RESET": "chrome-overlay:v1:reset",
        "CHROME_OVERLAY_ACQUIRE": "chrome-overlay:v1:acquire",
        "CHROME_OVERLAY_RELEASE": "chrome-overlay:v1:release",
        "CHROME_OVERLAY_POST": "chrome-overlay:v1:post",
        "CHROME_SHELL_MENU_OVERLAY_RESET": "chrome-shell-menu-overlay:v1:reset",
        "CHROME_SHELL_MENU_OVERLAY_ACQUIRE": "chrome-shell-menu-overlay:v1:acquire",
        "CHROME_SHELL_MENU_OVERLAY_RELEASE": "chrome-shell-menu-overlay:v1:release",
        "CHROME_SHELL_MENU_OVERLAY_POST": "chrome-shell-menu-overlay:v1:post",
        "SETTINGS_GET": "settings:get",
        "SETTINGS_SAVE": "settings:save",
        "SETTINGS_UPDATE": "settings:update",
        "COOKIE_SUMMARY": "cookies:summary",
        "COOKIE_DELETE_DOMAIN": "cookies:delete-domain",
        "COOKIE_CLEAR_ALL": "cookies:clear-all",
        "COOKIE_SETTINGS_GET": "cookies:settings-get",
        "COOKIE_SETTINGS_UPDATE": "cookies:settings-update",
        "CLIPBOARD_WRITE": "clipboard:write-text",
        "CLIPBOARD_READ": "clipboard:read-text",
        "APP_RELAUNCH": "app:relaunch",
        "APP_LOG_INFO": "app:log-info",
        "APP_LOG_FILES": "app:log-files",
        "APP_LOG_READ": "app:log-read",
        "APP_LOG_REVEAL": "app:log-reveal",
        "APP_LOG_DELETE": "app:log-delete",
        "APP_LOG_CLEAR": "app:log-clear",
        "COMPAT_GET_REPORT": "compatDiag:getReport",
        "COMPAT_CLEAR": "compatDiag:clear",
        "IDENTITY_DIAG_GET_REPORT": "identityDiag:getReport",
        "SESSION_LOAD": "session:load",
        "SESSION_SAVE": "session:save",
        "HISTORY_SEARCH": "history:search",
        "HISTORY_SUGGESTIONS": "history:get-suggestions",
        "HISTORY_DELETE_VISITS": "history:delete-visits",
        "HISTORY_DELETE_URLS": "history:delete-urls",
        "HISTORY_CLEAR": "history:clear",
        "NTP_TOP_SITES": "newtab:get-top-sites",
        "BOOKMARKS_GET": "bookmarks:get",
        "BOOKMARKS_GET_FOLDER": "bookmarks:getFolder",
        "BOOKMARKS_SEARCH": "bookmarks:search",
        "BOOKMARKS_DELETE": "bookmarks:delete",
        "BOOKMARKS_UPDATE": "bookmarks:update",
        "BOOKMARKS_SAVE": "bookmarks:save",
        "BOOKMARKS_ADD": "bookmarks:add",
        "BOOKMARKS_REMOVE": "bookmarks:remove",
        "BOOKMARKS_REORDER": "bookmarks:reorder",
        "BOOKMARKS_ADD_FOLDER": "bookmarks:addFolder",
        "BOOKMARKS_ADD_TO_FOLDER": "bookmarks:addToFolder",
        "TAB_HIDE_ACTIVE": "tab:hide-active",
        "TAB_RESTORE_ACTIVE": "tab:restore-active",
        "TAB_CAPTURE_SNAPSHOT": "tab:capture-active-snapshot",
        "TAB_PREPARE_SHELL_OVERLAY": "tab:prepare-shell-overlay",
        "TAB_MOVE_NEW_WINDOW": "tab:move-to-new-window",
        "TAB_STRIP_CONTEXT_MENU": "tab:strip-context-menu",
        "TAB_GET_INFO": "tab:get-info",
        "DEVTOOLS_UNDOCKED": "devtools:open-undocked",
        "PERMISSIONS_GET_ORIGIN_STATE": "permissions:get-origin-state",
        "PERMISSIONS_SET_ORIGIN_STATE": "permissions:set-origin-state",
        "PERMISSIONS_RESET_ORIGIN": "permissions:reset-origin",
        "PERMISSIONS_GET_ALL": "permissions:get-all",
        "PERMISSIONS_DELETE": "permissions:delete",
        "PERMISSIONS_CLEAR_ALL": "permissions:clear-all",
        "PERMISSIONS_PROMPT_RESPOND": "permissions:prompt-respond",
        "WINDOW_SET_OPACITY": "window:set-opacity",
        "WINDOW_GET_OPACITY": "window:get-opacity",
        "WINDOW_TOGGLE_BOSS_KEY": "window:toggle-boss-key",
        "TAB_ZOOM_IN": "tab:zoom-in",
        "TAB_ZOOM_OUT": "tab:zoom-out",
        "TAB_ZOOM_RESET": "tab:zoom-reset",
        "DOWNLOADS_GET_ALL": "downloads:get-all",
        "DOWNLOADS_CANCEL": "downloads:cancel",
        "DOWNLOADS_PAUSE": "downloads:pause",
        "DOWNLOADS_RESUME": "downloads:resume",
        "DOWNLOADS_RETRY": "downloads:retry",
        "DOWNLOADS_SHOW_IN_FOLDER": "downloads:show-in-folder",
        "DOWNLOADS_OPEN_FILE": "downloads:open-file",
        "DOWNLOADS_REMOVE": "downloads:remove",
        "DOWNLOADS_CLEAR_ALL": "downloads:clear-all",
        "DOWNLOADS_OPEN_FOLDER": "downloads:open-folder",
        "DOWNLOADS_SHOW_ATTENTION": "downloads:show-attention"
    },
    "IPC_SEND": {
        "NEW_TAB": "new-tab",
        "SWITCH_TAB": "switch-tab",
        "CLOSE_TAB": "close-tab",
        "NAVIGATE": "navigate",
        "GO_BACK": "go-back",
        "GO_FORWARD": "go-forward",
        "RELOAD": "reload",
        "TAB_SLEEP_REGISTER": "tab:sleep-register",
        "TAB_MENU_SYNC": "tab-menu:sync-labels",
        "TAB_SET_AUDIO_MUTED": "tab:set-audio-muted",
        "OMNIBOX_STEAL_FOCUS": "omnibox:steal-focus",
        "TOOLTIP_SHOW": "tooltip:show",
        "TOOLTIP_HIDE": "tooltip:hide",
        "CHROME_OVERLAY_FROM_OVERLAY": "chrome-overlay:v1:from-overlay",
        "APP_LOG": "app:log",
        "GHOST_DRAG": "ghost:drag",
        "STATUS_BUBBLE_FLIP": "status-bubble:flip",
        "STATUS_BUBBLE_RESIZE": "status-bubble:resize",
        "OVERSCROLL_TRIGGER_NAVIGATION": "overscroll:trigger-navigation",
        "OVERSCROLL_REQUEST_SYNC": "overscroll:request-sync"
    },
    "IPC_EVENT": {
        "URL_CHANGED": "url-changed",
        "TAB_UPDATE": "tab-update",
        "TAB_CREATED": "tab-created",
        "TAB_SWITCHED": "tab-switched",
        "OMNIBOX_FOCUS": "omnibox:focus",
        "SHORTCUT_NEW_TAB": "shortcut-new-tab",
        "SHORTCUT_HISTORY": "shortcut-history",
        "SHORTCUT_SETTINGS": "shortcut-settings",
        "SHORTCUT_CLOSE_TAB": "shortcut-close-tab",
        "SHORTCUT_RELOAD": "shortcut-reload",
        "SHORTCUT_SWITCH_TAB": "shortcut-switch-tab",
        "SHORTCUT_TAB_NEW_RIGHT": "shortcut-tab-new-to-right",
        "SHORTCUT_TAB_DUPLICATE": "shortcut-tab-duplicate",
        "SHORTCUT_TAB_MUTE": "shortcut-tab-mute-site",
        "SHORTCUT_TAB_PIN": "shortcut-tab-pin",
        "SHORTCUT_TAB_CLOSE_OTHERS": "shortcut-tab-close-others",
        "SHORTCUT_TAB_CLOSE_RIGHT": "shortcut-tab-close-right",
        "SHORTCUT_TAB_MOVE_WINDOW": "shortcut-tab-move-new-window",
        "SHORTCUT_TAB_SEARCH": "shortcut-tab-search",
        "SHORTCUT_COMMAND_PALETTE": "shortcut-command-palette",
        "TAB_STRIP_MENU_ACTION": "tab-strip-context-menu:action",
        "CHROME_OVERLAY_HOST": "chrome-overlay:v1:host-event",
        "CHROME_OVERLAY_SUPERSEDED": "chrome-overlay:v1:superseded",
        "CHROME_SHELL_MENU_OVERLAY_SUPERSEDED": "chrome-shell-menu-overlay:v1:superseded",
        "CHROME_OVERLAY_PATCH": "chrome-overlay:v1:patch",
        "OMNIBOX_OVERLAY_DELIVERED": "omnibox-overlay:delivered",
        "THEME_APPLY": "theme:apply",
        "TAB_AWOKEN": "tab:awoken",
        "TOOLTIP_UPDATE": "tooltip:update",
        "STATUS_BUBBLE_UPDATE": "status-bubble:update",
        "STATUS_BUBBLE_THEME": "status-bubble:theme",
        "PERMISSION_PROMPT_REQUEST": "permission:prompt-request",
        "PERMISSION_PROMPT_DISMISSED": "permission:prompt-dismissed",
        "WINDOW_OPACITY_CHANGED": "window:opacity-changed",
        "GHOST_CLICK_THROUGH_CHANGED": "ghost:click-through-changed",
        "DOWNLOAD_STARTED": "downloads:started",
        "DOWNLOAD_PROGRESS": "downloads:progress",
        "DOWNLOAD_DONE": "downloads:done",
        "DOWNLOAD_UPDATED": "downloads:updated",
        "SHORTCUT_DOWNLOADS": "shortcut-downloads",
        "OVERSCROLL_SYNC_STATE": "overscroll:sync-state",
        "OVERSCROLL_FINGER_LIFTED": "overscroll:finger-lifted",
        "OVERSCROLL_GESTURE_BEGIN": "overscroll:gesture-begin"
    }
});

function serializeRendererError(value) {
    if (!value) return null;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    return { message: String(value) };
}

function sendRendererLog(level, event, data = {}) {
    try {
        ipcRenderer.send(C.IPC_SEND.APP_LOG, { level, event, data: { ...data, href: typeof window !== 'undefined' ? window.location.href : '' } });
    } catch (_) {
        // Logging must never break the renderer.
    }
}

window.addEventListener('error', (event) => {
    sendRendererLog('error', 'renderer:uncaught-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: serializeRendererError(event.error),
    });
});

window.addEventListener('unhandledrejection', (event) => {
    sendRendererLog('error', 'renderer:unhandled-rejection', {
        reason: serializeRendererError(event.reason),
    });
});

contextBridge.exposeInMainWorld('__invisurf_webauthn', {
    create: (options) => ipcRenderer.invoke('webauthn:create', options),
    get: (options) => ipcRenderer.invoke('webauthn:get', options)
});

contextBridge.exposeInMainWorld('electronAPI', {
    // Tab management
    newTab: (id, isStealth = false, url = null, options = {}) => ipcRenderer.send(C.IPC_SEND.NEW_TAB, { id, isStealth, url, source: options && typeof options.source === 'string' ? options.source : undefined, history: options && options.history ? options.history : undefined }),
    switchTab: (id) => ipcRenderer.send(C.IPC_SEND.SWITCH_TAB, { id }),
    closeTab: (id, options = {}) => ipcRenderer.send(C.IPC_SEND.CLOSE_TAB, { id, closeWindowIfLast: options.closeWindowIfLast === true }),
    navigate: (id, url, options = {}) => ipcRenderer.send(C.IPC_SEND.NAVIGATE, { id, url, source: options && typeof options.source === 'string' ? options.source : undefined }),
    goBack: (id) => ipcRenderer.send(C.IPC_SEND.GO_BACK, { id }),
    goForward: (id) => ipcRenderer.send(C.IPC_SEND.GO_FORWARD, { id }),
    reload: (id) => ipcRenderer.send(C.IPC_SEND.RELOAD, { id }),
    appLog: (level, event, data = {}) => sendRendererLog(level, event, data),
    appLogInfo: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_INFO),
    appLogFiles: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_FILES),
    appLogRead: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_READ, { filePath }),
    appLogReveal: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_REVEAL, { filePath }),
    appLogDelete: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_DELETE, { filePath }),
    appLogClear: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_CLEAR, payload),
    onUrlChanged: (callback) => ipcRenderer.on(C.IPC_EVENT.URL_CHANGED, (event, data) => callback(data)),
    onTabUpdate: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_UPDATE, (event, data) => callback(data)),
    onTabCreated: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_CREATED, (event, data) => callback(data)),
    onTabClosedExternal: (callback) => ipcRenderer.on('tab-closed-external', (event, data) => callback(data)),
    onTabSwitched: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_SWITCHED, (event, data) => callback(data)),
    onOmniboxFocus: (callback) => ipcRenderer.on(C.IPC_EVENT.OMNIBOX_FOCUS, (event, data) => callback(data)),
    onShortcutNewTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_NEW_TAB, () => callback()),
    onShortcutHistory: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_HISTORY, () => callback()),
    onShortcutSettings: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_SETTINGS, () => callback()),
    onShortcutCloseTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_CLOSE_TAB, () => callback()),
    onShortcutReload: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_RELOAD, () => callback()),
    onShortcutSwitchTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, (event, data) => callback(data)),
    onShortcutTabNewToRight: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_NEW_RIGHT, () => callback()),
    onShortcutTabDuplicate: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_DUPLICATE, () => callback()),
    onShortcutTabMuteSite: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_MUTE, () => callback()),
    onShortcutTabPin: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_PIN, () => callback()),
    onShortcutTabCloseOthers: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_OTHERS, () => callback()),
    onShortcutTabCloseRight: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_RIGHT, () => callback()),
    onShortcutTabMoveNewWindow: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_MOVE_WINDOW, () => callback()),
    onShortcutTabSearch: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_SEARCH, () => callback()),
    onShortcutCommandPalette: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_COMMAND_PALETTE, () => callback()),

    runMenuCommand: (commandId) => ipcRenderer.invoke(C.IPC_INVOKE.RUN_MENU_COMMAND, commandId),
    isGoogleLensActiveForProfile: () => ipcRenderer.invoke(C.IPC_INVOKE.GOOGLE_LENS_ACTIVE_FOR_PROFILE),
    createWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE, typeof payload === 'string' ? { profileId: payload } : payload),
    createStealthWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE_STEALTH, typeof payload === 'string' ? { profileId: payload } : payload),
    createGhostWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE_GHOST, typeof payload === 'string' ? { profileId: payload } : payload),
    closeStealthWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CLOSE_IF_STEALTH),
    closeCurrentWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CLOSE_CURRENT),
    ghostClose: () => ipcRenderer.invoke(C.IPC_INVOKE.GHOST_CLOSE),
    ghostDrag: (deltaX, deltaY) => ipcRenderer.send(C.IPC_SEND.GHOST_DRAG, { deltaX, deltaY }),
    ghostToggleClickThrough: () => ipcRenderer.invoke(C.IPC_INVOKE.GHOST_TOGGLE_CLICK_THROUGH),
    ghostSetClickThrough: (enable) => ipcRenderer.invoke(C.IPC_INVOKE.GHOST_SET_CLICK_THROUGH, enable),
    ghostGetClickThrough: () => ipcRenderer.invoke(C.IPC_INVOKE.GHOST_GET_CLICK_THROUGH),
    onGhostClickThroughChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.GHOST_CLICK_THROUGH_CHANGED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.GHOST_CLICK_THROUGH_CHANGED, handler);
    },
    windowGetBootstrap: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_GET_BOOTSTRAP),
    isStealthWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.IS_STEALTH_WINDOW),
    isGhostWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.IS_GHOST_WINDOW),

    tabSetAudioMuted: (id, muted) => ipcRenderer.send(C.IPC_SEND.TAB_SET_AUDIO_MUTED, { id, muted }),
    tabMenuSyncLabels: (payload) => ipcRenderer.send(C.IPC_SEND.TAB_MENU_SYNC, payload),
    tabMoveToNewWindow: (id, fallbackTabId) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, { id, fallbackTabId }),

    // Bookmarks
    bookmarksGet: () => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_GET),
    bookmarkGetFolder: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_GET_FOLDER, payload),
    bookmarkSearch: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_SEARCH, payload),
    bookmarkDelete: (ids) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_DELETE, ids),
    bookmarkUpdate: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_UPDATE, payload),
    bookmarksSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_SAVE, data),
    bookmarksAdd: (item) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD, item),
    bookmarksRemove: (id) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_REMOVE, id),
    bookmarksReorder: (bar) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_REORDER, bar),
    bookmarksAddFolder: (name) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD_FOLDER, name),
    bookmarksAddToFolder: (folderId, item) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD_TO_FOLDER, folderId, item),
    onBookmarksUpdated: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('bookmarks:updated', handler);
        return () => ipcRenderer.removeListener('bookmarks:updated', handler);
    },

    // History
    historySearch: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_SEARCH, payload),
    historyGetSuggestions: (query) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_SUGGESTIONS, query),
    historyDeleteVisits: (visitIds) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_DELETE_VISITS, visitIds),
    historyDeleteUrls: (urls) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_DELETE_URLS, urls),
    historyClear: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_CLEAR, payload),

    // Profiles
    profileList: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_LIST),
    profileGetCurrent: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_GET_CURRENT),
    profileCreate: (displayName) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CREATE, { displayName }),
    profileUpdate: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_UPDATE, payload),
    profileSetAvatarData: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_SET_AVATAR_DATA, payload),
    profileSetAvatarFromPresetPng: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_SET_AVATAR_PRESET, payload),
    profileValidateAvatarData: (dataUrl) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_VALIDATE_AVATAR, { dataUrl }),
    profileListPresetAvatarPngs: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_LIST_PRESETS),
    profileClearAvatar: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CLEAR_AVATAR, { profileId }),
    profileGetAvatarDataUrl: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_GET_AVATAR, { profileId }),
    profileDelete: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_DELETE, { profileId }),
    profileGetDataSummary: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_GET_DATA_SUMMARY, { profileId }),
    profileOpenWindow: (profileId, options = {}) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_OPEN_WINDOW, { profileId, closeProfilePicker: options.closeProfilePicker === true }),
    profilePickerOpen: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_PICKER_OPEN),
    profileCloseCurrent: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT),
    recentlyClosedList: () => ipcRenderer.invoke(C.IPC_INVOKE.RECENTLY_CLOSED_LIST),
    recentlyClosedRestore: (closedAt) => ipcRenderer.invoke(C.IPC_INVOKE.RECENTLY_CLOSED_RESTORE, { closedAt }),

    // Session
    sessionSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.SESSION_SAVE, data),
    sessionLoad: () => ipcRenderer.invoke(C.IPC_INVOKE.SESSION_LOAD),

    // WebAuthn / Cookies
    webauthnGetCookieUsage: () => ipcRenderer.invoke('webauthn:getCookieUsage'),
    webauthnDeleteCookies: (domain) => ipcRenderer.invoke('webauthn:deleteCookies', domain),
    webauthnBlockCookies: (domain) => ipcRenderer.invoke('webauthn:blockCookies', domain),

    getTabInfo: (id) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_GET_INFO, { id }),
    tabHideActive: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_HIDE_ACTIVE),
    tabRestoreActive: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_RESTORE_ACTIVE),
    tabCaptureActiveSnapshot: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT),
    tabPrepareShellOverlay: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_PREPARE_SHELL_OVERLAY),
    /** Native tab strip context menu (Menu.popup); actions via onTabStripContextMenuAction. */
    tabStripContextMenuShow: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, payload),
    onTabStripContextMenuAction: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, handler);
    },

    chromeOverlayV1Reset: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_RESET),
    chromeOverlayV1Acquire: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_ACQUIRE),
    chromeOverlayV1Release: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE),
    chromeOverlayV1Post: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_POST, payload),
    chromeShellMenuOverlayV1Reset: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET),
    chromeShellMenuOverlayV1Acquire: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_ACQUIRE),
    chromeShellMenuOverlayV1Release: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE),
    chromeShellMenuOverlayV1Post: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, payload),
    onChromeOverlayV1HostEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_HOST, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_HOST, handler);
    },
    onChromeOverlaySuperseded: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED, handler);
    },
    onOmniboxOverlayDelivered: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED, handler);
    },
    onChromeShellMenuOverlaySuperseded: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED, handler);
    },
    onAppNavigateUrl: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('app:navigate-url', handler);
        return () => ipcRenderer.removeListener('app:navigate-url', handler);
    },
    chromeOverlayNotifyHost: (data) => ipcRenderer.send(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, data),
    onChromeOverlayV1Patch: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_PATCH, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_PATCH, handler);
    },

    // Lazy tab loading: register a tab as sleeping (no WebContentsView created yet)
    tabSleepRegister: (id, url, meta = {}) => ipcRenderer.send(C.IPC_SEND.TAB_SLEEP_REGISTER, { id, url, title: meta.title, favicon: meta.favicon, history: meta.history }),
    onTabAwoken: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_AWOKEN, (event, data) => callback(data)),

    // Settings
    settingsGet: () => ipcRenderer.invoke(C.IPC_INVOKE.SETTINGS_GET),
    settingsSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.SETTINGS_SAVE, data),
    settingsUpdated: (callback) => ipcRenderer.on(C.IPC_INVOKE.SETTINGS_UPDATE, (event, data) => callback(data)),
    appRelaunch: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_RELAUNCH),

    // Theme
    onThemeApply: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on(C.IPC_EVENT.THEME_APPLY, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.THEME_APPLY, handler);
    },

    // Compatibility Diagnostics
    compatDiagGetReport: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.COMPAT_GET_REPORT, payload),
    compatDiagClear: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.COMPAT_CLEAR, payload),
    identityDiagGetReport: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.IDENTITY_DIAG_GET_REPORT, payload),
    clipboardWriteText: (text) => ipcRenderer.invoke(C.IPC_INVOKE.CLIPBOARD_WRITE, { text: String(text || '') }),
    clipboardReadText: () => ipcRenderer.invoke(C.IPC_INVOKE.CLIPBOARD_READ),

    // New Tab Page
    ntpGetTopSites: () => ipcRenderer.invoke(C.IPC_INVOKE.NTP_TOP_SITES),
    ntpStealFocus: () => ipcRenderer.send(C.IPC_SEND.OMNIBOX_STEAL_FOCUS),

    // Tooltip Overlay
    tooltipShow: (data) => ipcRenderer.send(C.IPC_SEND.TOOLTIP_SHOW, data),
    tooltipHide: () => ipcRenderer.send(C.IPC_SEND.TOOLTIP_HIDE),
    onTooltipUpdate: (callback) => ipcRenderer.on(C.IPC_EVENT.TOOLTIP_UPDATE, (event, v) => callback(v)),

    // Status Bubble (link preview on hover)
    onStatusBubbleUpdate: (callback) => ipcRenderer.on(C.IPC_EVENT.STATUS_BUBBLE_UPDATE, (event, v) => callback(v)),
    onStatusBubbleTheme: (callback) => ipcRenderer.on(C.IPC_EVENT.STATUS_BUBBLE_THEME, (event, v) => callback(v)),
    statusBubbleFlip: () => ipcRenderer.send(C.IPC_SEND.STATUS_BUBBLE_FLIP),
    statusBubbleResize: (size) => ipcRenderer.send(C.IPC_SEND.STATUS_BUBBLE_RESIZE, size),

    // Permissions & Site Settings
    permissionsGetOriginState: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ORIGIN_STATE, { origin, profileId }),
    permissionsSetOriginState: (origin, permission, state, profileId = null, persist = true) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_SET_ORIGIN_STATE, { origin, permission, state, profileId, persist }),
    permissionsResetOrigin: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_RESET_ORIGIN, { origin, profileId }),
    permissionsGetAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ALL, { profileId }),
    permissionsDelete: (origin, permission, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_DELETE, { origin, permission, profileId }),
    permissionsClearAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_CLEAR_ALL, { profileId }),
    permissionsPromptRespond: (promptId, decision, persist = false) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_PROMPT_RESPOND, { promptId, decision, persist }),
    onPermissionPromptRequest: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.PERMISSION_PROMPT_REQUEST, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.PERMISSION_PROMPT_REQUEST, handler);
    },
    onPermissionPromptDismissed: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.PERMISSION_PROMPT_DISMISSED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.PERMISSION_PROMPT_DISMISSED, handler);
    },

    // Window Transparency / Opacity Mode
    windowSetOpacity: (opacity) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_SET_OPACITY, opacity),
    windowGetOpacity: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_GET_OPACITY),
    windowToggleBossKey: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_TOGGLE_BOSS_KEY),
    onWindowOpacityChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.WINDOW_OPACITY_CHANGED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.WINDOW_OPACITY_CHANGED, handler);
    },

    // Tab Zoom
    tabZoomIn: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_ZOOM_IN),
    tabZoomOut: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_ZOOM_OUT),
    tabZoomReset: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_ZOOM_RESET),

    // Downloads
    downloadsGetAll: () => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_GET_ALL),
    downloadsCancel: (id) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_CANCEL, { id }),
    downloadsPause: (id) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_PAUSE, { id }),
    downloadsResume: (id) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_RESUME, { id }),
    downloadsRetry: (id) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_RETRY, { id }),
    downloadsShowInFolder: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_SHOW_IN_FOLDER, { filePath }),
    downloadsOpenFile: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_OPEN_FILE, { filePath }),
    downloadsRemove: (id) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_REMOVE, { id }),
    downloadsClearAll: () => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_CLEAR_ALL),
    downloadsOpenFolder: () => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_OPEN_FOLDER),
    downloadsShowAttention: (rect) => ipcRenderer.invoke(C.IPC_INVOKE.DOWNLOADS_SHOW_ATTENTION, rect),
    onDownloadAttentionPlay: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('download-attention:play', handler);
        return () => ipcRenderer.removeListener('download-attention:play', handler);
    },
    onDownloadStarted: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.DOWNLOAD_STARTED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.DOWNLOAD_STARTED, handler);
    },
    onDownloadProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.DOWNLOAD_PROGRESS, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.DOWNLOAD_PROGRESS, handler);
    },
    onDownloadDone: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.DOWNLOAD_DONE, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.DOWNLOAD_DONE, handler);
    },
    onDownloadUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.DOWNLOAD_UPDATED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.DOWNLOAD_UPDATED, handler);
    },
    onShortcutDownloads: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.SHORTCUT_DOWNLOADS, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.SHORTCUT_DOWNLOADS, handler);
    },

    // Omnibox Extension suggestions
    omniboxExtensionQuery: (payload) => ipcRenderer.invoke('omnibox:query-extension', payload),
    omniboxExtensionEntered: (payload) => ipcRenderer.invoke('omnibox:extension-input-entered', payload),
    omniboxExtensionCancelled: (payload) => ipcRenderer.invoke('omnibox:extension-input-cancelled', payload),

    // Platform identifier
    platform: process.platform,
});

contextBridge.exposeInMainWorld('permissionAPI', {
    getOriginState: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ORIGIN_STATE, { origin, profileId }),
    setOriginState: (origin, permission, state, profileId = null, persist = true) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_SET_ORIGIN_STATE, { origin, permission, state, profileId, persist }),
    resetOrigin: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_RESET_ORIGIN, { origin, profileId }),
    getAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ALL, { profileId }),
    deletePermission: (origin, permission, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_DELETE, { origin, permission, profileId }),
    clearAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_CLEAR_ALL, { profileId }),
    respondToPrompt: (promptId, decision, persist = false) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_PROMPT_RESPOND, { promptId, decision, persist }),
});

contextBridge.exposeInMainWorld('cookieAPI', {
    getCookieSummary: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SUMMARY, { profileId }),
    deleteCookiesForDomain: (profileIdOrDomain, maybeDomain) => {
        const hasProfile = maybeDomain !== undefined;
        return ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_DELETE_DOMAIN, {
            profileId: hasProfile ? profileIdOrDomain : null,
            domain: String(hasProfile ? maybeDomain : profileIdOrDomain || ''),
        });
    },
    clearAllSiteData: (profileId = null, options = {}) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_CLEAR_ALL, {
        profileId,
        since: options?.since ?? null,
    }),
    getSettings: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_GET, { profileId }),
    updateSettings: (config) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, { config }),
    updateConfig: (profileId, config) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, { profileId, config }),
});

// =========================================================================
// OVERSCROLL HISTORY NAVIGATION ENGINE (0ms Compositor Smoothness)
// =========================================================================
function setupOverscrollEngine() {
    if (typeof window === 'undefined' || window.top !== window) return;

    var rAF = null;
    let canGoBack = false;
    let canGoForward = false;
    let isTabReady = false;
    let isNavigating = false;
    let isCooldown = false;
    let cooldownTimer = null;

    // Synchronize history capabilities with the main process
    ipcRenderer.on(C.IPC_EVENT.OVERSCROLL_SYNC_STATE, (_event, state) => {
        isTabReady = true;
        canGoBack = Boolean(state?.canGoBack);
        canGoForward = Boolean(state?.canGoForward);
        isNavigating = false;
        isCooldown = false;
        if (cooldownTimer) {
            clearTimeout(cooldownTimer);
            cooldownTimer = null;
        }
        cancelGesture();
    });

    // Request initial state from main process
    try {
        ipcRenderer.send(C.IPC_SEND.OVERSCROLL_REQUEST_SYNC);
    } catch (_) {}

    // -------------------------------------------------------------
    // 1. PRE-HOT SHADOW DOM & GPU COMPOSITOR LAYERS
    // -------------------------------------------------------------
    const host = document.createElement('div');
    host.id = '__invisurf_overscroll_host__';
    host.style.cssText = [
        'position: fixed !important',
        'top: 0 !important',
        'left: 0 !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'pointer-events: none !important',
        'z-index: 2147483647 !important',
        'overflow: hidden !important',
        'contain: strict !important',
        'margin: 0 !important',
        'padding: 0 !important',
        'border: none !important',
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial;
            pointer-events: none !important;
        }

        .indicator {
            position: absolute;
            top: 50%;
            width: 150px;
            height: 150px;
            margin-top: -75px;
            background: rgba(26, 26, 26, 0.9);
            border-radius: 50%;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
            display: flex;
            align-items: center;
            box-sizing: border-box;
            will-change: transform, opacity;
            pointer-events: none !important;
            opacity: 0;
            user-select: none;
            -webkit-user-select: none;
        }

        .indicator.left {
            left: 0;
            justify-content: flex-end;
            padding-right: 20px;
            transform: translate3d(-150px, 0, 0);
        }

        .indicator.right {
            right: 0;
            justify-content: flex-start;
            padding-left: 20px;
            transform: translate3d(150px, 0, 0);
        }

        .indicator svg {
            width: 34px;
            height: 34px;
            flex-shrink: 0;
            transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .indicator svg path {
            fill: #e8eaed;
            transition: fill 0.10s ease;
        }

        /* Armed State (Activated color: #1a1a1a at 100% solid opacity) */
        .indicator.armed {
            background: #1a1a1a !important;
        }

        .indicator.armed svg {
            transform: scale(1.15);
        }

        .indicator.armed svg path {
            fill: #ffffff !important;
        }

        /* Fast in-place fade-out upon release / cancel */
        .indicator.fading {
            transition: opacity 0.08s ease-out !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `;
    shadow.appendChild(style);

    // Indicators DOM (Created via createElementNS to strictly comply with Trusted Types CSP)
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function createIndicatorSvg(pathD) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const pathEl = document.createElementNS(SVG_NS, 'path');
        pathEl.setAttribute('d', pathD);
        svg.appendChild(pathEl);
        return svg;
    }

    const leftIndicator = document.createElement('div');
    leftIndicator.className = 'indicator left';
    leftIndicator.appendChild(createIndicatorSvg('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'));

    const rightIndicator = document.createElement('div');
    rightIndicator.className = 'indicator right';
    rightIndicator.appendChild(createIndicatorSvg('M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z'));

    shadow.appendChild(leftIndicator);
    shadow.appendChild(rightIndicator);

    // Pre-mount immediately so GPU memory is allocated before first gesture
    function mountHost() {
        if (!document.documentElement) {
            window.requestAnimationFrame(mountHost);
            return;
        }
        if (!document.getElementById('__invisurf_overscroll_host__')) {
            document.documentElement.appendChild(host);
        }
    }
    mountHost();
    window.addEventListener('DOMContentLoaded', mountHost, { once: true });

    // -------------------------------------------------------------
    // 2. GESTURE & COMPOSITOR PHYSICS (150px Circle, Half Reveal)
    // -------------------------------------------------------------
    const THRESHOLD = 60;        // Delta px to arm navigation
    const MAX_DISPLACEMENT = 75; // Half of 150px circle (only half circle reveals)

    let accumulatedX = 0;
    let lockedDirection = null;  // 'back' | 'forward' | null (strictly locked per finger session)
    let isGestureActive = false;
    let isLockedVertical = false;
    let isLockedOut = false;     // True if DOM scroll or unnavigable at start of session
    let isTouchSessionActive = false;
    let safetyTimer = null;
    let lastWheelTime = 0;
    // Reveal physics: smoothly reveals up to exactly half-circle (75px) at THRESHOLD,
    // and STOPS MORE REVEALING once active (clamped at 75px).
    function calculateDisplacement(delta) {
        if (delta >= THRESHOLD) {
            return MAX_DISPLACEMENT;
        }
        const progress = Math.max(0, delta / THRESHOLD);
        return MAX_DISPLACEMENT * Math.sin((progress * Math.PI) / 2);
    }

    // 0ms GPU Compositor frame tick
    function render() {
        rAF = null;
        if (!lockedDirection) return;

        const isBack = lockedDirection === 'back';
        const indicator = isBack ? leftIndicator : rightIndicator;
        const otherIndicator = isBack ? rightIndicator : leftIndicator;

        if (otherIndicator.style.opacity !== '0') {
            otherIndicator.style.opacity = '0';
            otherIndicator.style.transform = isBack ? 'translate3d(150px, 0, 0)' : 'translate3d(-150px, 0, 0)';
        }

        indicator.classList.remove('fading');

        const displacement = calculateDisplacement(accumulatedX);
        const isArmed = accumulatedX >= THRESHOLD;

        indicator.classList.toggle('armed', isArmed);

        if (isBack) {
            indicator.style.transform = `translate3d(${displacement - 150}px, 0, 0)`;
        } else {
            indicator.style.transform = `translate3d(${150 - displacement}px, 0, 0)`;
        }

        // 1a1a1a at 90% opacity while non-activated, full 100% solid opacity once activated
        if (isArmed) {
            indicator.style.opacity = '1';
        } else {
            const entryProgress = Math.min(accumulatedX / 20, 1);
            indicator.style.opacity = (entryProgress * 0.9).toFixed(3);
        }
    }

    function resetState() {
        accumulatedX = 0;
        lockedDirection = null;
        isGestureActive = false;
        isLockedVertical = false;
        isLockedOut = false;
        isTouchSessionActive = false;
        if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
        }
    }

    // -------------------------------------------------------------
    // 3. GESTURE LIFECYCLE & STATE MACHINE
    // -------------------------------------------------------------
    // Fresh finger contact on trackpad initiates / clears state for a new session
    function onGestureBegin() {
        if (isNavigating) return;

        isCooldown = false;
        if (cooldownTimer) {
            clearTimeout(cooldownTimer);
            cooldownTimer = null;
        }

        isTouchSessionActive = true;
        resetState();
        isTouchSessionActive = true;

        if (rAF) {
            cancelAnimationFrame(rAF);
            rAF = null;
        }

        leftIndicator.classList.remove('fading', 'armed');
        rightIndicator.classList.remove('fading', 'armed');
        leftIndicator.style.opacity = '0';
        rightIndicator.style.opacity = '0';
        leftIndicator.style.transform = 'translate3d(-150px, 0, 0)';
        rightIndicator.style.transform = 'translate3d(150px, 0, 0)';
    }

    // Quick in-place fade-out without triggering navigation
    function cancelGesture() {
        if (rAF) {
            cancelAnimationFrame(rAF);
            rAF = null;
        }

        leftIndicator.classList.remove('armed');
        rightIndicator.classList.remove('armed');
        leftIndicator.classList.add('fading');
        rightIndicator.classList.add('fading');
        leftIndicator.style.opacity = '0';
        rightIndicator.style.opacity = '0';

        setTimeout(() => {
            leftIndicator.classList.remove('fading');
            rightIndicator.classList.remove('fading');
            leftIndicator.style.transform = 'translate3d(-150px, 0, 0)';
            rightIndicator.style.transform = 'translate3d(150px, 0, 0)';
            leftIndicator.style.opacity = '0';
            rightIndicator.style.opacity = '0';
        }, 90);

        resetState();
    }

    // Finalize gesture settlement on physical finger lift:
    // Fades out quickly in place in few ms instead of translating back to original position
    function executeRelease() {
        if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
        }

        if (rAF) {
            cancelAnimationFrame(rAF);
            rAF = null;
        }

        if (!isGestureActive || !lockedDirection) {
            cancelGesture();
            return;
        }

        const isBack = lockedDirection === 'back';
        const indicator = isBack ? leftIndicator : rightIndicator;
        const otherIndicator = isBack ? rightIndicator : leftIndicator;
        const isArmed = accumulatedX >= THRESHOLD;
        const triggeredDirection = lockedDirection;

        // Quick in-place fade-out: keep position and fade opacity to 0 in 80ms
        indicator.classList.remove('armed');
        indicator.classList.add('fading');
        indicator.style.opacity = '0';

        otherIndicator.classList.remove('fading', 'armed');
        otherIndicator.style.opacity = '0';

        setTimeout(() => {
            indicator.classList.remove('fading');
            indicator.style.transform = isBack ? 'translate3d(-150px, 0, 0)' : 'translate3d(150px, 0, 0)';
            indicator.style.opacity = '0';
        }, 90);

        resetState();

        if (isArmed) {
            // INSTANT NAVIGATION: Send immediately without delay, matching toolbar arrow click speed
            isNavigating = true;
            try {
                ipcRenderer.send(C.IPC_SEND.OVERSCROLL_TRIGGER_NAVIGATION, triggeredDirection);
            } catch (_) {}

            // Debounce lock: ignore all trailing momentum wheel events while navigation is in flight
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(() => {
                isNavigating = false;
                isCooldown = false;
            }, 350);
        } else {
            // Unarmed release: short cooldown to drop residual momentum wheel events
            isCooldown = true;
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(() => {
                isCooldown = false;
            }, 150);
        }
    }

    // Triggered when fingers physically lift from trackpad (gestureScrollEnd or gestureFlingStart)
    function onFingerLift() {
        if (isNavigating) return;
        executeRelease();
    }

    // Main process Chromium input-event IPC listeners
    ipcRenderer.on(C.IPC_EVENT.OVERSCROLL_GESTURE_BEGIN, onGestureBegin);
    ipcRenderer.on(C.IPC_EVENT.OVERSCROLL_FINGER_LIFTED, onFingerLift);

    // Fallbacks for cancellation
    window.addEventListener('blur', cancelGesture);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGesture(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelGesture(); }, { capture: true });
    window.addEventListener('pointerdown', () => { if (isGestureActive) cancelGesture(); }, { capture: true, passive: true });

    // -------------------------------------------------------------
    // 4. DEEP DOM SCROLL & CSS OVERSCROLL CHECKER
    // -------------------------------------------------------------
    function canTargetScrollHorizontally(target, direction) {
        let el = target;
        while (el && el !== document.documentElement && el !== document.body) {
            if (el.nodeType !== 1) { // Node.ELEMENT_NODE
                el = el.parentElement;
                continue;
            }

            const computedStyle = window.getComputedStyle(el);

            // 1. Honor W3C overscroll-behavior-x
            if (computedStyle.overscrollBehaviorX === 'none' || computedStyle.overscrollBehaviorX === 'contain') {
                return true; 
            }

            // 2. Check horizontally scrollable containers
            if (computedStyle.overflowX === 'auto' || computedStyle.overflowX === 'scroll') {
                const hasLeft = el.scrollLeft > 1;
                const hasRight = el.scrollLeft < (el.scrollWidth - el.clientWidth - 1);
                if (direction === 'back' && hasLeft) return true;
                if (direction === 'forward' && hasRight) return true;
            }

            el = el.parentElement;
        }

        // 3. Check root viewport scroll
        const rootScrollX = window.scrollX || (document.documentElement ? document.documentElement.scrollLeft : 0) || (document.body ? document.body.scrollLeft : 0);
        const maxScroll = Math.max(0, (document.documentElement ? document.documentElement.scrollWidth : 0) - window.innerWidth);

        if (direction === 'back' && rootScrollX > 1) return true;
        if (direction === 'forward' && rootScrollX < (maxScroll - 1)) return true;

        if (document.documentElement) {
            const rootStyle = window.getComputedStyle(document.documentElement);
            if (rootStyle.overscrollBehaviorX === 'none' || rootStyle.overscrollBehaviorX === 'contain') {
                return true;
            }
        }

        return false;
    }

    // -------------------------------------------------------------
    // 5. INPUT WHEEL INTERCEPTION (Strict Direction Locking per Touch)
    // -------------------------------------------------------------
    window.addEventListener('wheel', (e) => {
        // Trackpad pixel scrolling only
        if (e.deltaMode !== 0) return;
        if (!isTabReady) return;
        if (!canGoBack && !canGoForward) return;
        if (isNavigating || isCooldown) return;

        // Reset safety fallback timer (10s dead silence timeout to prevent zombie locks)
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(cancelGesture, 10000);

        lastWheelTime = performance.now();

        if (!isTouchSessionActive) {
            isTouchSessionActive = true;
            lockedDirection = null;
            isGestureActive = false;
            isLockedVertical = false;
            isLockedOut = false;
            accumulatedX = 0;
        }

        // Ignore if this session was locked out (vertical scroll or element scrolled)
        if (isLockedVertical || isLockedOut) return;

        // If direction has not been locked yet for this touch contact:
        if (!lockedDirection) {
            // Intent lock: if vertical delta dominates, lock session to vertical
            if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
                isLockedVertical = true;
                return;
            }

            if (Math.abs(e.deltaX) < 1) return;

            // Delta direction: negative deltaX = swiping right (Back), positive deltaX = swiping left (Forward)
            const candidateDir = e.deltaX < 0 ? 'back' : 'forward';

            if (candidateDir === 'back' && !canGoBack) {
                isLockedOut = true;
                return;
            }
            if (candidateDir === 'forward' && !canGoForward) {
                isLockedOut = true;
                return;
            }
            if (canTargetScrollHorizontally(e.target, candidateDir)) {
                isLockedOut = true;
                return;
            }

            // Lock this touch session strictly to candidateDir
            lockedDirection = candidateDir;
            isGestureActive = true;

            leftIndicator.classList.remove('fading');
            rightIndicator.classList.remove('fading');
        }

        // Accumulate displacement for the locked direction ONLY
        // Reversing swipe motion reduces accumulatedX towards 0, but never flips direction
        // Stop more revealing once active: clamp accumulatedX at THRESHOLD + 15
        if (lockedDirection === 'back') {
            accumulatedX -= e.deltaX;
            if (accumulatedX < 0) accumulatedX = 0;
            if (accumulatedX > THRESHOLD + 15) accumulatedX = THRESHOLD + 15;
        } else if (lockedDirection === 'forward') {
            accumulatedX += e.deltaX;
            if (accumulatedX < 0) accumulatedX = 0;
            if (accumulatedX > THRESHOLD + 15) accumulatedX = THRESHOLD + 15;
        }

        if (!rAF) {
            rAF = requestAnimationFrame(render);
        }
    }, { capture: true, passive: true });

    // -------------------------------------------------------------
    // 6. TOUCHSCREEN SUPPORT (Single Direction per Touch Session)
    // -------------------------------------------------------------
    let touchStartX = 0;
    let touchStartY = 0;

    window.addEventListener('touchstart', (e) => {
        if (!isTabReady || (!canGoBack && !canGoForward)) return;
        if (e.touches && e.touches.length === 1) {
            onGestureBegin();
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isTabReady || isLockedVertical || isLockedOut || !e.touches || e.touches.length !== 1) return;

        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;

        if (!lockedDirection) {
            if (Math.abs(diffY) >= Math.abs(diffX)) {
                isLockedVertical = true;
                return;
            }

            if (Math.abs(diffX) < 5) return;

            const candidateDir = diffX > 0 ? 'back' : 'forward';
            if (candidateDir === 'back' && !canGoBack) { isLockedOut = true; return; }
            if (candidateDir === 'forward' && !canGoForward) { isLockedOut = true; return; }
            if (canTargetScrollHorizontally(e.target, candidateDir)) { isLockedOut = true; return; }

            lockedDirection = candidateDir;
            isGestureActive = true;

            leftIndicator.classList.remove('fading');
            rightIndicator.classList.remove('fading');
        }

        if (lockedDirection === 'back') {
            accumulatedX = Math.min(THRESHOLD + 15, Math.max(0, diffX * 1.15));
        } else if (lockedDirection === 'forward') {
            accumulatedX = Math.min(THRESHOLD + 15, Math.max(0, -diffX * 1.15));
        }

        if (!rAF) {
            rAF = requestAnimationFrame(render);
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (isGestureActive) executeRelease();
    }, { passive: true });
}

try {
    setupOverscrollEngine();
} catch (overscrollErr) {
    console.warn('[Preload] Overscroll engine failed to init:', overscrollErr?.message || overscrollErr);
}

contextBridge.exposeInMainWorld('extensionAPI', {
    list: (profileId = null) => ipcRenderer.invoke('extensions:list', { profileId }),
    toggle: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:toggle', { extensionId, profileId }),
    uninstall: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:uninstall', { extensionId, profileId }),
    confirmInstall: (installToken) => ipcRenderer.invoke('extensions:confirm-install', { installToken }),
    cancelInstall: (installToken) => ipcRenderer.invoke('extensions:cancel-install', { installToken }),
    togglePin: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:toggle-pin', { extensionId, profileId }),
    activateAction: (extensionId, anchorRect = null) => ipcRenderer.invoke('extensions:activate-action', { extensionId, anchorRect }),
    loadUnpacked: (profileId = null) => ipcRenderer.invoke('extensions:load-unpacked', { profileId }),
    reload: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:reload', { extensionId, profileId }),
    setSiteAccess: (extensionId, mode, host, profileId = null) => ipcRenderer.invoke('extensions:set-site-access', { extensionId, mode, host, profileId }),
    inspectPopup: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:inspect-popup', { extensionId, profileId }),
    openOptionsPage: (extensionId, profileId = null) => ipcRenderer.invoke('extensions:open-options-page', { extensionId, profileId }),
    onInstallPrompt: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('extensions:prompt-install', handler);
        return () => ipcRenderer.removeListener('extensions:prompt-install', handler);
    },
    onExtensionsUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('extensions:updated', handler);
        return () => ipcRenderer.removeListener('extensions:updated', handler);
    },
    onActionStateUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('extensions:action-state-updated', handler);
        return () => ipcRenderer.removeListener('extensions:action-state-updated', handler);
    },
    getErrors: (extensionId) => ipcRenderer.invoke('extensions:get-errors', { extensionId }),
    clearErrors: (extensionId) => ipcRenderer.invoke('extensions:clear-errors', { extensionId }),
    clearError: (extensionId, errorId) => ipcRenderer.invoke('extensions:clear-error', { extensionId, errorId }),
    getCodeSnippet: (extensionId, source, lineno) => ipcRenderer.invoke('extensions:get-code-snippet', { extensionId, source, lineno }),
    onErrorsUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('extensions:errors-updated', handler);
        return () => ipcRenderer.removeListener('extensions:errors-updated', handler);
    },
});

