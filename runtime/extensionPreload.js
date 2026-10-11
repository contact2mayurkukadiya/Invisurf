/**
 * runtime/extensionPreload.js
 * Preload script for Chrome Extension Popups and Options Pages (chrome-extension://...).
 * Bridges window.chrome APIs via Electron's ipcRenderer to the Main Process IpcBridge.
 */

const { ipcRenderer } = require('electron');

(() => {
    try {
        if (typeof window !== 'undefined') window.__invisurf_preload_active = true;
        if (typeof self !== 'undefined') self.__invisurf_preload_active = true;
        if (typeof globalThis !== 'undefined') globalThis.__invisurf_preload_active = true;
    } catch (_) {}

    // Disable deprecated/restricted Chromium FileSystem API on window in extension contexts.
    // Modern Chromium throws SecurityError when extensions attempt persistent FileSystem calls,
    // which breaks extensions (like GoFullPage) that use FileSystem detection to fall back to IndexedDB / Blobs.
    try {
        if (typeof window !== 'undefined') {
            try { delete window.requestFileSystem; } catch (_) {}
            try { delete window.webkitRequestFileSystem; } catch (_) {}
            try {
                if (typeof Window !== 'undefined' && Window.prototype) {
                    delete Window.prototype.requestFileSystem;
                    delete Window.prototype.webkitRequestFileSystem;
                }
            } catch (_) {}
            try {
                Object.defineProperty(window, 'requestFileSystem', {
                    get: () => undefined,
                    set: () => {},
                    configurable: true,
                    enumerable: false,
                });
            } catch (_) {}
            try {
                Object.defineProperty(window, 'webkitRequestFileSystem', {
                    get: () => undefined,
                    set: () => {},
                    configurable: true,
                    enumerable: false,
                });
            } catch (_) {}
            try {
                if (typeof Window !== 'undefined' && Window.prototype) {
                    Object.defineProperty(Window.prototype, 'requestFileSystem', {
                        get: () => undefined,
                        set: () => {},
                        configurable: true,
                        enumerable: false,
                    });
                    Object.defineProperty(Window.prototype, 'webkitRequestFileSystem', {
                        get: () => undefined,
                        set: () => {},
                        configurable: true,
                        enumerable: false,
                    });
                }
            } catch (_) {}
        }
    } catch (_) {}

    let extId = '';
    function getExtId() {
        if (extId && extId !== 'about:' && extId !== 'blank') return extId;
        try {
            if (window.location && window.location.protocol === 'chrome-extension:') {
                extId = window.location.host || (window.location.pathname || '').replace(/^\/+/, '').split('/')[0] || '';
            } else if (window.location && window.location.href) {
                const match = window.location.href.match(/^chrome-extension:\/\/([^\/]+)/);
                if (match && match[1]) {
                    extId = match[1];
                }
            }
        } catch (_) {}
        return extId || '';
    }

    function _setLastError(msg) {
        if (msg) {
            const err = { message: String(msg) };
            if (window.chrome?.runtime) window.chrome.runtime.lastError = err;
            if (window.chrome?.extension) window.chrome.extension.lastError = err;
        } else {
            if (window.chrome?.runtime) delete window.chrome.runtime.lastError;
            if (window.chrome?.extension) delete window.chrome.extension.lastError;
        }
    }

    const _listeners = {
        'chrome.runtime.onMessage': [],
        'chrome.storage.onChanged': [],
        'chrome.tabs.onCreated': [],
        'chrome.tabs.onUpdated': [],
        'chrome.tabs.onRemoved': [],
        'chrome.tabs.onActivated': [],
        'chrome.proxy.settings.onChange': [],
        'chrome.proxy.onProxyError': [],
        'chrome.idle.onStateChanged': [],
    };

    function _createEventTarget(name) {
        if (!_listeners[name]) _listeners[name] = [];
        return {
            addListener: (fn) => {
                if (typeof fn === 'function' && !_listeners[name].includes(fn)) {
                    _listeners[name].push(fn);
                }
            },
            removeListener: (fn) => {
                if (_listeners[name]) {
                    const idx = _listeners[name].indexOf(fn);
                    if (idx !== -1) _listeners[name].splice(idx, 1);
                }
            },
            hasListener: (fn) => _listeners[name]?.includes(fn) || false,
            hasListeners: () => (_listeners[name]?.length || 0) > 0,
            _listeners: _listeners[name] || [],
        };
    }

    function _dispatchEvent(name, args = []) {
        const list = _listeners[name] || [];
        for (const fn of list) {
            try {
                fn(...args);
            } catch (err) {
                console.warn('[ExtensionPreload Event Error]:', err);
            }
        }
    }

    function _createPortObject(portId, name, sender) {
        return {
            name,
            sender: sender || {},
            postMessage: (message) => {
                _call('runtime.portPostMessage', { portId, message });
            },
            disconnect: () => {
                _call('runtime.portDisconnect', { portId });
            },
            onMessage: _createEventTarget(`chrome.runtime.portOnMessage_${portId}`),
            onDisconnect: _createEventTarget(`chrome.runtime.portOnDisconnect_${portId}`),
        };
    }

    function _dispatchMessageEvent(args = [], messageId = null) {
        const message = args[0];
        const sender = args[1] || {};
        let responded = false;
        const sendResponse = (res) => {
            if (responded) return;
            responded = true;
            if (messageId) {
                _call('runtime.sendResponse', { messageId, response: res }).catch(() => {});
            }
        };

        const list = _listeners['chrome.runtime.onMessage'] || [];
        if (list.length === 0) {
            return;
        }

        let asyncWait = false;
        for (const fn of list) {
            try {
                const r = fn(message, sender, sendResponse);
                if (r === true || (r && typeof r.then === 'function')) {
                    asyncWait = true;
                    if (r && typeof r.then === 'function') {
                        r.then(sendResponse).catch(() => sendResponse(undefined));
                    }
                }
            } catch (err) {
                console.warn('[ExtensionPreload onMessage Error]:', err);
            }
        }
    }

    // Listen to push events from Main process
    ipcRenderer.on('invisurf-ext-event', (event, payload) => {
        if (payload && payload.eventName) {
            if (payload.eventName === 'chrome.runtime.onConnect') {
                const info = (payload.args && payload.args[0]) || {};
                const port = _createPortObject(info.portId, info.name, info.sender);
                _dispatchEvent('chrome.runtime.onConnect', [port]);
            } else if (payload.eventName === 'chrome.runtime.onMessage') {
                _dispatchMessageEvent(payload.args || [], payload.messageId);
            } else {
                _dispatchEvent(payload.eventName, payload.args || []);
            }
        }
    });

    // Helper for calling Main process
    function _call(method, args = {}) {
        return ipcRenderer.invoke('invisurf-ext-api', {
            method,
            args,
            extensionId: getExtId(),
        });
    }

    // Error Trapping Layer for Extension Views (Popups, Options)
    let _viewErrTokens = 10;
    let _lastViewTokenRefill = Date.now();
    function _reportViewError(errData) {
        try {
            const now = Date.now();
            if (now - _lastViewTokenRefill > 1000) {
                _viewErrTokens = 10;
                _lastViewTokenRefill = now;
            }
            if (_viewErrTokens <= 0) return;
            _viewErrTokens--;

            _call('error.report', {
                message: errData.message || 'Unknown view error',
                source: errData.source || errData.filename || '',
                lineno: errData.lineno || 0,
                colno: errData.colno || 0,
                stack: errData.stack || '',
                context: 'popup',
            }).catch(() => {});
        } catch (_) {}
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('error', (event) => {
            _reportViewError({
                message: event.message || (event.error && event.error.message) || String(event.error || 'Error'),
                source: event.filename || '',
                lineno: event.lineno || 0,
                colno: event.colno || 0,
                stack: event.error?.stack || '',
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            _reportViewError({
                message: reason?.message || String(reason || 'Unhandled Promise Rejection'),
                source: reason?.fileName || reason?.sourceURL || '',
                lineno: reason?.lineNumber || reason?.line || 0,
                colno: reason?.columnNumber || reason?.column || 0,
                stack: reason?.stack || '',
            });
        });
    }

    try {
        const origWindowClose = window.close;
        window.close = function() {
            try {
                _call('action.closePopup', {}).catch(() => {});
            } catch (_) {}
            try {
                if (typeof origWindowClose === 'function') origWindowClose.call(window);
            } catch (_) {}
        };
    } catch (_) {}

    if (!window.chrome) window.chrome = {};
    if (typeof self !== 'undefined' && !self.chrome) self.chrome = window.chrome;
    if (typeof globalThis !== 'undefined' && !globalThis.chrome) globalThis.chrome = window.chrome;

    // 1. chrome.runtime
    if (!window.chrome.runtime) window.chrome.runtime = {};
    Object.defineProperty(window.chrome.runtime, 'id', {
        get: () => getExtId(),
        enumerable: true,
        configurable: true,
    });
    window.chrome.runtime.getURL = (p) => 'chrome-extension://' + getExtId() + '/' + (p ? String(p).replace(/^\/+/, '') : '');
    let _cachedManifest = null;
    window.chrome.runtime.getManifest = () => {
        if (_cachedManifest && typeof _cachedManifest === 'object' && Object.keys(_cachedManifest).length > 0) {
            return _cachedManifest;
        }
        try {
            _cachedManifest = ipcRenderer.sendSync('invisurf-ext-get-manifest', getExtId());
        } catch (_) {}
        return _cachedManifest || {};
    };
    window.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts, optsOrCallback, cb) => {
        let targetId = getExtId();
        let message = extIdOrMsg;
        let callback = null;

        if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
            targetId = extIdOrMsg;
            message = msgOrOpts;
            if (typeof optsOrCallback === 'function') callback = optsOrCallback;
            else if (typeof cb === 'function') callback = cb;
        } else {
            if (typeof msgOrOpts === 'function') callback = msgOrOpts;
            else if (typeof optsOrCallback === 'function') callback = optsOrCallback;
        }

        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const p = _call('runtime.sendMessage', { targetExtId: targetId, message, messageId });
        if (typeof callback === 'function') {
            p.then(res => {
                _setLastError(null);
                callback(res);
            }).catch(err => {
                _setLastError(err?.message || err);
                callback(undefined);
                _setLastError(null);
            });
        }
        return p;
    };
    window.chrome.runtime.onMessage = _createEventTarget('chrome.runtime.onMessage');
    window.chrome.runtime.connect = (connectOpts = {}) => {
        const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
        const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        _call('runtime.connect', { portId, name: portName, targetExtId: getExtId() }).catch(() => {});
        return _createPortObject(portId, portName, { id: getExtId() });
    };
    window.chrome.runtime.onConnect = _createEventTarget('chrome.runtime.onConnect');
    window.chrome.runtime.openOptionsPage = (cb) => {
        const p = _call('runtime.openOptionsPage', {});
        if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
        return p;
    };
    window.chrome.runtime.setUninstallURL = (url, cb) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
    };
    window.chrome.runtime.reload = () => _call('runtime.reload', {});
    window.chrome.runtime.getPlatformInfo = (cb) => {
        const p = _call('runtime.getPlatformInfo');
        if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({ os: 'mac', arch: 'arm64', nacl_arch: 'arm64' }));
        return p;
    };
    window.chrome.runtime.getBackgroundPage = (cb) => {
        if (typeof cb === 'function') cb(null);
        return Promise.resolve(null);
    };
    window.chrome.runtime.getContexts = (filter, cb) => {
        if (typeof cb === 'function') cb([]);
        return Promise.resolve([]);
    };
    window.chrome.runtime.sendNativeMessage = (app, msg, cb) => {
        if (typeof cb === 'function') cb(null);
        return Promise.resolve(null);
    };
    window.chrome.runtime.onInstalled = _createEventTarget('chrome.runtime.onInstalled');
    window.chrome.runtime.onStartup = _createEventTarget('chrome.runtime.onStartup');
    window.chrome.runtime.onSuspend = _createEventTarget('chrome.runtime.onSuspend');
    window.chrome.runtime.onSuspendCanceled = _createEventTarget('chrome.runtime.onSuspendCanceled');

    // 1b. chrome.extension (Legacy MV2 compatibility)
    window.chrome.extension = {
        getURL: (p) => window.chrome.runtime.getURL(p),
        getBackgroundPage: () => null,
        getViews: () => [window],
        isAllowedIncognitoAccess: (cb) => { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
        isAllowedFileSchemeAccess: (cb) => { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
        sendMessage: (msg, cb) => window.chrome.runtime.sendMessage(msg, cb),
        onMessage: window.chrome.runtime.onMessage,
        onRequest: _createEventTarget('chrome.extension.onRequest'),
        sendRequest: (msg, cb) => window.chrome.runtime.sendMessage(msg, cb),
        connect: (opts) => window.chrome.runtime.connect(opts),
        onConnect: window.chrome.runtime.onConnect,
        lastError: null,
    };

    // 2. chrome.storage
    function _createStorageArea(area) {
        return {
            get: (keys, cb) => {
                const p = _call('storage.get', { area, keys });
                if (typeof cb === 'function') {
                    p.then(res => cb(res)).catch(() => cb({}));
                }
                return p;
            },
            set: (items, cb) => {
                const p = _call('storage.set', { area, items });
                if (typeof cb === 'function') {
                    p.then(() => cb()).catch(() => cb());
                }
                return p;
            },
            remove: (keys, cb) => {
                const p = _call('storage.remove', { area, keys });
                if (typeof cb === 'function') {
                    p.then(() => cb()).catch(() => cb());
                }
                return p;
            },
            clear: (cb) => {
                const p = _call('storage.clear', { area });
                if (typeof cb === 'function') {
                    p.then(() => cb()).catch(() => cb());
                }
                return p;
            },
            getBytesInUse: (keys, cb) => {
                const p = _call('storage.getBytesInUse', { area, keys });
                if (typeof cb === 'function') {
                    p.then(res => cb(res)).catch(() => cb(0));
                }
                return p;
            },
        };
    }

    window.chrome.storage = {
        local: _createStorageArea('local'),
        sync: _createStorageArea('sync'),
        session: _createStorageArea('session'),
        onChanged: _createEventTarget('chrome.storage.onChanged'),
    };

    // 3. chrome.tabs
    window.chrome.tabs = {
        query: (queryInfo, cb) => {
            const p = _call('tabs.query', { queryInfo: queryInfo || {} });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb([]));
            }
            return p;
        },
        get: (tabId, cb) => {
            const p = _call('tabs.get', { tabId });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        getCurrent: (cb) => {
            const p = _call('tabs.getCurrent', {});
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        create: (props, cb) => {
            const pProps = props ? { ...props } : {};
            if (pProps.url && typeof pProps.url === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pProps.url)) {
                try {
                    if (window.chrome?.runtime?.getURL) {
                        pProps.url = window.chrome.runtime.getURL(pProps.url);
                    }
                } catch (_) {}
            }
            const p = _call('tabs.create', { createProperties: pProps });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        update: (tabId, props, cb) => {
            let tId = tabId;
            let pProps = props;
            if (typeof tabId === 'object' && props === undefined) {
                pProps = tabId;
                tId = null;
            }
            pProps = pProps ? { ...pProps } : {};
            if (pProps.url && typeof pProps.url === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pProps.url)) {
                try {
                    if (window.chrome?.runtime?.getURL) {
                        pProps.url = window.chrome.runtime.getURL(pProps.url);
                    }
                } catch (_) {}
            }
            const p = _call('tabs.update', { tabId: tId, updateProperties: pProps });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        remove: (tabIds, cb) => {
            const p = _call('tabs.remove', { tabIds });
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        reload: (tabId, props, cb) => {
            const p = _call('tabs.reload', { tabId, reloadProperties: props || {} });
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        goBack: (tabId, cb) => {
            const p = _call('tabs.goBack', { tabId });
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        goForward: (tabId, cb) => {
            const p = _call('tabs.goForward', { tabId });
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        sendMessage: (tabId, message, options, cb) => {
            let opts = options;
            let callback = cb;
            if (typeof options === 'function') {
                callback = options;
                opts = {};
            }
            const p = _call('tabs.sendMessage', { tabId, message, options: opts || {} });
            if (typeof callback === 'function') {
                p.then(res => {
                    _setLastError(null);
                    callback(res);
                }).catch(err => {
                    _setLastError(err?.message || err || 'Could not establish connection. Receiving end does not exist.');
                    callback(undefined);
                    _setLastError(null);
                });
            }
            return p;
        },
        duplicate: (tabId, cb) => {
            const p = _call('tabs.duplicate', { tabId });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        captureVisibleTab: (windowIdOrOptions, optionsOrCallback, cb) => {
            let winId = null;
            let options = {};
            let callback = cb;
            if (typeof windowIdOrOptions === 'number') {
                winId = windowIdOrOptions;
                if (typeof optionsOrCallback === 'object') options = optionsOrCallback || {};
                else if (typeof optionsOrCallback === 'function') callback = optionsOrCallback;
            } else if (typeof windowIdOrOptions === 'object') {
                options = windowIdOrOptions || {};
                if (typeof optionsOrCallback === 'function') callback = optionsOrCallback;
            } else if (typeof windowIdOrOptions === 'function') {
                callback = windowIdOrOptions;
            }
            const p = _call('tabs.captureVisibleTab', { windowId: winId, options });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(''));
            return p;
        },
        executeScript: (tabIdOrDetails, detailsOrCallback, cb) => {
            let tabId = null;
            let details = {};
            let callback = cb;
            if (typeof tabIdOrDetails === 'number') {
                tabId = tabIdOrDetails;
                if (typeof detailsOrCallback === 'object') details = detailsOrCallback || {};
                else if (typeof detailsOrCallback === 'function') callback = detailsOrCallback;
            } else if (typeof tabIdOrDetails === 'object') {
                details = tabIdOrDetails || {};
                if (typeof detailsOrCallback === 'function') callback = detailsOrCallback;
            } else if (typeof tabIdOrDetails === 'function') {
                callback = tabIdOrDetails;
            }
            const p = _call('tabs.executeScript', { tabId, details });
            if (typeof callback === 'function') {
                p.then(res => {
                    _setLastError(null);
                    const mapped = Array.isArray(res) ? res.map(r => r?.result !== undefined ? r.result : r) : [];
                    callback(mapped);
                }).catch(err => {
                    _setLastError(err?.message || err);
                    callback([]);
                    _setLastError(null);
                });
            }
            return p;
        },
        insertCSS: (tabIdOrDetails, detailsOrCallback, cb) => {
            let tabId = null;
            let details = {};
            let callback = cb;
            if (typeof tabIdOrDetails === 'number') {
                tabId = tabIdOrDetails;
                if (typeof detailsOrCallback === 'object') details = detailsOrCallback || {};
                else if (typeof detailsOrCallback === 'function') callback = detailsOrCallback;
            } else if (typeof tabIdOrDetails === 'object') {
                details = tabIdOrDetails || {};
                if (typeof detailsOrCallback === 'function') callback = detailsOrCallback;
            } else if (typeof tabIdOrDetails === 'function') {
                callback = tabIdOrDetails;
            }
            const p = _call('tabs.insertCSS', { tabId, details });
            if (typeof callback === 'function') {
                p.then(() => {
                    _setLastError(null);
                    callback();
                }).catch(err => {
                    _setLastError(err?.message || err);
                    callback();
                    _setLastError(null);
                });
            }
            return p;
        },
        connect: (tabId, connectInfo = {}) => {
            const portName = typeof connectInfo === 'string' ? connectInfo : (connectInfo?.name || '');
            const portId = 'tab_port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            _call('tabs.connect', { tabId, portId, name: portName }).catch(() => {});
            return _createPortObject(portId, portName, { tabId });
        },
        getZoom: (tabId, cb) => {
            let tId = tabId;
            let callback = cb;
            if (typeof tabId === 'function') { callback = tabId; tId = null; }
            const p = _call('tabs.getZoom', { tabId: tId });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(1.0));
            return p;
        },
        setZoom: (tabId, zoomFactor, cb) => {
            let tId = tabId;
            let zf = zoomFactor;
            let callback = cb;
            if (typeof zoomFactor === 'function') { callback = zoomFactor; zf = tabId; tId = null; }
            const p = _call('tabs.setZoom', { tabId: tId, zoomFactor: zf });
            if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
            return p;
        },
        discard: (tabId, cb) => {
            const p = _call('tabs.discard', { tabId });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        highlight: (highlightInfo, cb) => {
            const p = _call('tabs.highlight', { highlightInfo: highlightInfo || {} });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        move: (tabIds, moveProperties, cb) => {
            const p = _call('tabs.move', { tabIds, moveProperties: moveProperties || {} });
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb(null));
            }
            return p;
        },
        onCreated: _createEventTarget('chrome.tabs.onCreated'),
        onUpdated: _createEventTarget('chrome.tabs.onUpdated'),
        onRemoved: _createEventTarget('chrome.tabs.onRemoved'),
        onActivated: _createEventTarget('chrome.tabs.onActivated'),
    };

    // 4. chrome.action & chrome.browserAction
    const _actionApi = {
        setTitle: (details, cb) => {
            const p = _call('action.setTitle', details || {});
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        getTitle: (details, cb) => {
            const p = _call('action.getTitle', details || {});
            if (typeof cb === 'function') p.then(res => cb(res));
            return p;
        },
        setBadgeText: (details, cb) => {
            const p = _call('action.setBadgeText', details || {});
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        getBadgeText: (details, cb) => {
            const p = _call('action.getBadgeText', details || {});
            if (typeof cb === 'function') p.then(res => cb(res));
            return p;
        },
        setBadgeBackgroundColor: (details, cb) => {
            const p = _call('action.setBadgeBackgroundColor', details || {});
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        getBadgeBackgroundColor: (details, cb) => {
            const p = _call('action.getBadgeBackgroundColor', details || {});
            if (typeof cb === 'function') p.then(res => cb(res));
            return p;
        },
        setBadgeTextColor: (details, cb) => {
            const p = _call('action.setBadgeTextColor', details || {});
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        getBadgeTextColor: (details, cb) => {
            const p = _call('action.getBadgeTextColor', details || {});
            if (typeof cb === 'function') p.then(res => cb(res));
            return p;
        },
        setPopup: (details, cb) => {
            const p = _call('action.setPopup', details || {});
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        getPopup: (details, cb) => {
            const p = _call('action.getPopup', details || {});
            if (typeof cb === 'function') p.then(res => cb(res));
            return p;
        },
        enable: (tabId, cb) => {
            const p = _call('action.enable', { tabId });
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        disable: (tabId, cb) => {
            const p = _call('action.disable', { tabId });
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        setIcon: (details, cb) => {
            const p = _call('action.setIcon', details || {});
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        onClicked: _createEventTarget('chrome.action.onClicked'),
    };

    window.chrome.action = _actionApi;
    window.chrome.browserAction = _actionApi;

    // 5. chrome.scripting
    window.chrome.scripting = {
        ExecutionWorld: {
            ISOLATED: 'ISOLATED',
            MAIN: 'MAIN',
        },
        executeScript: (injection, cb) => {
            const p = _call('scripting.executeScript', injection || {});
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb([]));
            }
            return p;
        },
        insertCSS: (injection, cb) => {
            const p = _call('scripting.insertCSS', injection || {});
            if (typeof cb === 'function') {
                p.then(res => cb(res)).catch(() => cb());
            }
            return p;
        },
        removeCSS: (injection, cb) => {
            const p = _call('scripting.removeCSS', injection || {});
            if (typeof cb === 'function') {
                p.then(() => cb()).catch(() => cb());
            }
            return p;
        },
        registerContentScripts: (scripts, cb) => {
            const p = _call('scripting.registerContentScripts', { scripts });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        getRegisteredContentScripts: (filter, cb) => {
            let f = filter;
            let callback = cb;
            if (typeof filter === 'function') {
                callback = filter;
                f = {};
            }
            const p = _call('scripting.getRegisteredContentScripts', { filter: f });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        unregisterContentScripts: (filter, cb) => {
            let f = filter;
            let callback = cb;
            if (typeof filter === 'function') {
                callback = filter;
                f = {};
            }
            const p = _call('scripting.unregisterContentScripts', { filter: f });
            if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
            return p;
        },
        updateContentScripts: (scripts, cb) => {
            const p = _call('scripting.updateContentScripts', { scripts });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
    };

    // 6. chrome.cookies
    window.chrome.cookies = {
        get: (details, cb) => {
            const p = _call('cookies.get', details || {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        getAll: (details, cb) => {
            const p = _call('cookies.getAll', details || {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        set: (details, cb) => {
            const p = _call('cookies.set', details || {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        remove: (details, cb) => {
            const p = _call('cookies.remove', details || {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        onChanged: _createEventTarget('chrome.cookies.onChanged'),
    };

    // 7. chrome.windows
    window.chrome.windows = {
        get: (windowId, queryOptions, cb) => {
            let opts = queryOptions;
            let callback = cb;
            if (typeof queryOptions === 'function') { callback = queryOptions; opts = {}; }
            const p = _call('windows.get', { windowId, queryOptions: opts || {} });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(null));
            return p;
        },
        getCurrent: (queryOptions, cb) => {
            let opts = queryOptions;
            let callback = cb;
            if (typeof queryOptions === 'function') { callback = queryOptions; opts = {}; }
            const p = _call('windows.getCurrent', { queryOptions: opts || {} });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(null));
            return p;
        },
        getLastFocused: (queryOptions, cb) => {
            let opts = queryOptions;
            let callback = cb;
            if (typeof queryOptions === 'function') { callback = queryOptions; opts = {}; }
            const p = _call('windows.getCurrent', { queryOptions: opts || {} });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(null));
            return p;
        },
        getAll: (queryOptions, cb) => {
            let opts = queryOptions;
            let callback = cb;
            if (typeof queryOptions === 'function') { callback = queryOptions; opts = {}; }
            const p = _call('windows.getAll', { queryOptions: opts || {} });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        create: (createData, cb) => {
            const data = createData ? { ...createData } : {};
            if (data.url) {
                try {
                    if (typeof data.url === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(data.url)) {
                        if (window.chrome?.runtime?.getURL) {
                            data.url = window.chrome.runtime.getURL(data.url);
                        }
                    } else if (Array.isArray(data.url)) {
                        data.url = data.url.map(u => {
                            if (typeof u === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
                                return window.chrome?.runtime?.getURL ? window.chrome.runtime.getURL(u) : u;
                            }
                            return u;
                        });
                    }
                } catch (_) {}
            }
            const p = _call('windows.create', { createData: data });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        update: (windowId, updateInfo, cb) => {
            const p = _call('windows.update', { windowId, updateInfo: updateInfo || {} });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        remove: (windowId, cb) => {
            const p = _call('windows.remove', { windowId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        onCreated: _createEventTarget('chrome.windows.onCreated'),
        onRemoved: _createEventTarget('chrome.windows.onRemoved'),
        onFocusChanged: _createEventTarget('chrome.windows.onFocusChanged'),
    };

    // 8. chrome.alarms
    window.chrome.alarms = {
        create: (nameOrInfo, info) => {
            let name = '';
            let alarmInfo = nameOrInfo;
            if (typeof nameOrInfo === 'string') {
                name = nameOrInfo;
                alarmInfo = info || {};
            }
            return _call('alarms.create', { name, alarmInfo: alarmInfo || {} });
        },
        get: (name, cb) => {
            const p = _call('alarms.get', { name: name || '' });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        getAll: (cb) => {
            const p = _call('alarms.getAll', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        clear: (name, cb) => {
            const p = _call('alarms.clear', { name: name || '' });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(false));
            return p;
        },
        clearAll: (cb) => {
            const p = _call('alarms.clearAll', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(false));
            return p;
        },
        onAlarm: _createEventTarget('chrome.alarms.onAlarm'),
    };

    // 9. chrome.contextMenus
    window.chrome.contextMenus = {
        create: (createProperties, cb) => {
            const p = _call('contextMenus.create', { createProperties: createProperties || {} });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(''));
            return p;
        },
        update: (id, updateProperties, cb) => {
            const p = _call('contextMenus.update', { id, updateProperties: updateProperties || {} });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        remove: (id, cb) => {
            const p = _call('contextMenus.remove', { id });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        removeAll: (cb) => {
            const p = _call('contextMenus.removeAll', {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        onClicked: _createEventTarget('chrome.contextMenus.onClicked'),
    };

    // 10. chrome.declarativeNetRequest
    window.chrome.declarativeNetRequest = {
        updateDynamicRules: (options, cb) => {
            const p = _call('declarativeNetRequest.updateDynamicRules', options || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        getDynamicRules: (cb) => {
            const p = _call('declarativeNetRequest.getDynamicRules', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        updateSessionRules: (options, cb) => {
            const p = _call('declarativeNetRequest.updateSessionRules', options || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        getSessionRules: (cb) => {
            const p = _call('declarativeNetRequest.getSessionRules', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        updateEnabledRulesets: (options, cb) => {
            const p = _call('declarativeNetRequest.updateEnabledRulesets', options || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        getEnabledRulesets: (cb) => {
            const p = _call('declarativeNetRequest.getEnabledRulesets', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        onRuleMatchedDebug: _createEventTarget('chrome.declarativeNetRequest.onRuleMatchedDebug'),
    };

    // 11. chrome.notifications
    window.chrome.notifications = {
        create: (notificationIdOrOptions, options, cb) => {
            let nId = '';
            let nOptions = notificationIdOrOptions;
            let callback = cb;
            if (typeof notificationIdOrOptions === 'string') {
                nId = notificationIdOrOptions;
                nOptions = options || {};
            } else if (typeof options === 'function') {
                callback = options;
            }
            const p = _call('notifications.create', { notificationId: nId, options: nOptions });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(''));
            return p;
        },
        clear: (notificationId, cb) => {
            const p = _call('notifications.clear', { notificationId });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(false));
            return p;
        },
        getAll: (cb) => {
            const p = _call('notifications.getAll', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({}));
            return p;
        },
        onClicked: _createEventTarget('chrome.notifications.onClicked'),
        onClosed: _createEventTarget('chrome.notifications.onClosed'),
    };

    // 12. chrome.webNavigation
    window.chrome.webNavigation = {
        getAllFrames: (details, cb) => {
            let opts = details || {};
            let callback = cb;
            if (typeof details === 'function') { callback = details; opts = {}; }
            const p = _call('webNavigation.getAllFrames', opts);
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        getFrame: (details, cb) => {
            let opts = details || {};
            let callback = cb;
            if (typeof details === 'function') { callback = details; opts = {}; }
            const p = _call('webNavigation.getFrame', opts);
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(null));
            return p;
        },
        onBeforeNavigate: _createEventTarget('chrome.webNavigation.onBeforeNavigate'),
        onCommitted: _createEventTarget('chrome.webNavigation.onCommitted'),
        onDOMContentLoaded: _createEventTarget('chrome.webNavigation.onDOMContentLoaded'),
        onCompleted: _createEventTarget('chrome.webNavigation.onCompleted'),
        onErrorOccurred: _createEventTarget('chrome.webNavigation.onErrorOccurred'),
    };

    // 13. chrome.commands
    window.chrome.commands = {
        onCommand: _createEventTarget('chrome.commands.onCommand'),
        getAll: (cb) => {
            const p = _call('commands.getAll', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
    };

    // 14. chrome.i18n
    window.chrome.i18n = {
        getMessage: (messageName) => messageName || '',
        getUILanguage: () => navigator.language || 'en-US',
        getAcceptLanguages: (cb) => {
            const langs = Array.isArray(navigator.languages) ? navigator.languages : ['en-US', 'en'];
            if (typeof cb === 'function') cb(langs);
            return Promise.resolve(langs);
        },
        detectLanguage: (text, cb) => {
            const res = { isReliable: true, languages: [{ language: 'en', percentage: 100 }] };
            if (typeof cb === 'function') cb(res);
            return Promise.resolve(res);
        },
    };

    // 15. chrome.permissions
    const _dynamicallyGrantedPerms = new Set();
    window.chrome.permissions = {
        contains: async (permissions, cb) => {
            const manifest = await window.chrome.runtime.getManifest();
            const manifestPerms = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
            const reqPerms = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
            const hasAll = reqPerms.every(p => manifestPerms.includes(p) || _dynamicallyGrantedPerms.has(p));
            if (typeof cb === 'function') cb(hasAll);
            return hasAll;
        },
        getAll: async (cb) => {
            const manifest = await window.chrome.runtime.getManifest();
            const allPerms = Array.from(new Set([
                ...(Array.isArray(manifest?.permissions) ? manifest.permissions : []),
                ..._dynamicallyGrantedPerms,
            ]));
            const perms = {
                permissions: allPerms,
                origins: Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : [],
            };
            if (typeof cb === 'function') cb(perms);
            return perms;
        },
        request: (permissions, cb) => {
            const reqPerms = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
            for (const p of reqPerms) _dynamicallyGrantedPerms.add(p);
            if (typeof cb === 'function') cb(true);
            return Promise.resolve(true);
        },
        remove: (permissions, cb) => {
            const reqPerms = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
            for (const p of reqPerms) _dynamicallyGrantedPerms.delete(p);
            if (typeof cb === 'function') cb(true);
            return Promise.resolve(true);
        },
        onAdded: _createEventTarget('chrome.permissions.onAdded'),
        onRemoved: _createEventTarget('chrome.permissions.onRemoved'),
    };

    // 16. chrome.management
    window.chrome.management = {
        getSelf: (cb) => {
            const p = _call('management.getSelf');
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({ id: EXT_ID, name: EXT_ID, enabled: true }));
            return p;
        },
        get: (id, cb) => {
            const p = _call('management.get', { id });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        getAll: (cb) => {
            const p = _call('management.getAll');
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        setEnabled: (id, enabled, cb) => {
            const p = _call('management.setEnabled', { id, enabled });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        uninstall: (id, options, cb) => {
            let opts = options;
            let callback = cb;
            if (typeof options === 'function') {
                callback = options;
                opts = {};
            }
            const p = _call('management.uninstall', { id, options: opts });
            if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
            return p;
        },
        uninstallSelf: (options, cb) => {
            let opts = options;
            let callback = cb;
            if (typeof options === 'function') {
                callback = options;
                opts = {};
            }
            const p = _call('management.uninstallSelf', { options: opts });
            if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
            return p;
        },
        getPermissionWarningsById: (id, cb) => {
            const p = _call('management.getPermissionWarningsById', { id });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        onEnabled: _createEventTarget('chrome.management.onEnabled'),
        onDisabled: _createEventTarget('chrome.management.onDisabled'),
        onInstalled: _createEventTarget('chrome.management.onInstalled'),
        onUninstalled: _createEventTarget('chrome.management.onUninstalled'),
    };

    // 17. chrome.downloads
    window.chrome.downloads = {
        download: (options, cb) => {
            const p = _call('downloads.download', { options });
            if (typeof cb === 'function') p.then(id => cb(id)).catch(() => cb(null));
            return p;
        },
        search: (query, cb) => {
            let q = query;
            let callback = cb;
            if (typeof query === 'function') {
                callback = query;
                q = {};
            }
            const p = _call('downloads.search', { query: q });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        pause: (downloadId, cb) => {
            const p = _call('downloads.pause', { downloadId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        resume: (downloadId, cb) => {
            const p = _call('downloads.resume', { downloadId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        cancel: (downloadId, cb) => {
            const p = _call('downloads.cancel', { downloadId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        show: (downloadId) => {
            return _call('downloads.show', { downloadId });
        },
        open: (downloadId) => {
            return _call('downloads.open', { downloadId });
        },
        erase: (query, cb) => {
            let q = query;
            let callback = cb;
            if (typeof query === 'function') {
                callback = query;
                q = {};
            }
            const p = _call('downloads.erase', { query: q });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        onCreated: _createEventTarget('chrome.downloads.onCreated'),
        onChanged: _createEventTarget('chrome.downloads.onChanged'),
        onErased: _createEventTarget('chrome.downloads.onErased'),
    };

    // 18. chrome.webRequest
    window.chrome.webRequest = {
        onBeforeRequest: _createEventTarget('chrome.webRequest.onBeforeRequest'),
        onBeforeSendHeaders: _createEventTarget('chrome.webRequest.onBeforeSendHeaders'),
        onSendHeaders: _createEventTarget('chrome.webRequest.onSendHeaders'),
        onHeadersReceived: _createEventTarget('chrome.webRequest.onHeadersReceived'),
        onResponseStarted: _createEventTarget('chrome.webRequest.onResponseStarted'),
        onBeforeRedirect: _createEventTarget('chrome.webRequest.onBeforeRedirect'),
        onCompleted: _createEventTarget('chrome.webRequest.onCompleted'),
        onErrorOccurred: _createEventTarget('chrome.webRequest.onErrorOccurred'),
    };

    // 19. chrome.sidePanel (Manifest V3)
    window.chrome.sidePanel = {
        open: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        setOptions: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        getOptions: (options, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
        setPanelBehavior: (behavior, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        getPanelBehavior: (cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
    };

    // 20. chrome.devtools
    if (!window.chrome.devtools) {
        window.chrome.devtools = {
            inspectedWindow: {
                tabId: null,
                eval: (expression, options, cb) => {
                    let callback = cb;
                    if (typeof options === 'function') callback = options;
                    const err = { isError: true, isException: false, description: 'Evaluation in inspected window requires fallback' };
                    if (typeof callback === 'function') callback(null, err);
                    return Promise.reject(err);
                },
                reload: () => {},
            },
            panels: {
                create: (title, iconPath, pagePath, cb) => {
                    if (typeof cb === 'function') cb({ onShown: _createEventTarget('devtools.panel.onShown'), onHidden: _createEventTarget('devtools.panel.onHidden') });
                },
                elements: { createSidebarPane: (title, cb) => { if (typeof cb === 'function') cb({}); } },
                sources: { createSidebarPane: (title, cb) => { if (typeof cb === 'function') cb({}); } },
                themeName: 'dark',
            },
            network: {
                getHAR: (cb) => { if (typeof cb === 'function') cb({ entries: [] }); },
                onNavigated: _createEventTarget('chrome.devtools.network.onNavigated'),
                onRequestFinished: _createEventTarget('chrome.devtools.network.onRequestFinished'),
            },
        };
    }

    // 21. chrome.bookmarks
    window.chrome.bookmarks = {
        get: (idOrIdList, cb) => {
            const p = _call('bookmarks.get', { idOrIdList });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        getChildren: (id, cb) => {
            const p = _call('bookmarks.getChildren', { id });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        getRecent: (numberOfItems, cb) => {
            const p = _call('bookmarks.getRecent', { numberOfItems });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        getTree: (cb) => {
            const p = _call('bookmarks.getTree');
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        getSubTree: (id, cb) => {
            const p = _call('bookmarks.getSubTree', { id });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        search: (query, cb) => {
            const p = _call('bookmarks.search', { query });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        create: (bookmark, cb) => {
            const p = _call('bookmarks.create', { bookmark });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        update: (id, changes, cb) => {
            const p = _call('bookmarks.update', { id, changes });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        remove: (id, cb) => {
            const p = _call('bookmarks.remove', { id });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        removeTree: (id, cb) => {
            const p = _call('bookmarks.removeTree', { id });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        onCreated: _createEventTarget('chrome.bookmarks.onCreated'),
        onRemoved: _createEventTarget('chrome.bookmarks.onRemoved'),
        onChanged: _createEventTarget('chrome.bookmarks.onChanged'),
        onMoved: _createEventTarget('chrome.bookmarks.onMoved'),
        onChildrenReordered: _createEventTarget('chrome.bookmarks.onChildrenReordered'),
        onImportBegan: _createEventTarget('chrome.bookmarks.onImportBegan'),
        onImportEnded: _createEventTarget('chrome.bookmarks.onImportEnded'),
    };

    // 22. chrome.history
    window.chrome.history = {
        search: (query, cb) => {
            const p = _call('history.search', { query });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        getVisits: (details, cb) => {
            const p = _call('history.getVisits', { details });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        addUrl: (details, cb) => {
            const p = _call('history.addUrl', { details });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        deleteUrl: (details, cb) => {
            const p = _call('history.deleteUrl', { details });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        deleteRange: (range, cb) => {
            const p = _call('history.deleteRange', { range });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        deleteAll: (cb) => {
            const p = _call('history.deleteAll');
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        onVisited: _createEventTarget('chrome.history.onVisited'),
        onVisitRemoved: _createEventTarget('chrome.history.onVisitRemoved'),
    };

    // 23. chrome.identity
    window.chrome.identity = {
        getRedirectURL: (path) => {
            const cleanPath = path ? (String(path).startsWith('/') ? String(path).substring(1) : String(path)) : '';
            return `https://${getExtId()}.chromiumapp.org/${cleanPath}`;
        },
        launchWebAuthFlow: (details, cb) => {
            const p = _call('identity.launchWebAuthFlow', { details });
            if (typeof cb === 'function') p.then(url => cb(url)).catch(() => cb(undefined));
            return p;
        },
        getProfileUserInfo: (details, cb) => {
            let callback = cb;
            let d = details;
            if (typeof details === 'function') {
                callback = details;
                d = {};
            }
            const p = _call('identity.getProfileUserInfo', { details: d });
            if (typeof callback === 'function') p.then(info => callback(info)).catch(() => callback({ email: '', id: '' }));
            return p;
        },
        clearAllCachedAuthTokens: (cb) => {
            const p = _call('identity.clearAllCachedAuthTokens');
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        getAuthToken: (details, cb) => {
            let callback = cb;
            let d = details;
            if (typeof details === 'function') {
                callback = details;
                d = {};
            }
            if (d && d.interactive && d.url) {
                return window.chrome.identity.launchWebAuthFlow(d, callback);
            }
            const p = Promise.resolve(null);
            if (typeof callback === 'function') callback(null);
            return p;
        },
        onSignInChanged: _createEventTarget('chrome.identity.onSignInChanged'),
    };

    // 24. chrome.offscreen (Manifest V3)
    window.chrome.offscreen = {
        Reason: {
            TESTING: 'TESTING',
            AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
            IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
            DOM_SCRAPING: 'DOM_SCRAPING',
            BLOBS: 'BLOBS',
            DOM_PARSER: 'DOM_PARSER',
            USER_MEDIA: 'USER_MEDIA',
            DISPLAY_MEDIA: 'DISPLAY_MEDIA',
            WEB_RTC: 'WEB_RTC',
            CLIPBOARD: 'CLIPBOARD',
            LOCAL_STORAGE: 'LOCAL_STORAGE',
            WORKERS: 'WORKERS',
            BATTERY_STATUS: 'BATTERY_STATUS',
            MATCH_MEDIA: 'MATCH_MEDIA',
            GEOLOCATION: 'GEOLOCATION',
        },
        createDocument: (parameters, cb) => {
            const p = _call('offscreen.createDocument', { parameters });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        closeDocument: (cb) => {
            const p = _call('offscreen.closeDocument');
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        hasDocument: (cb) => {
            const p = _call('offscreen.hasDocument');
            if (typeof cb === 'function') p.then(has => cb(has)).catch(() => cb(false));
            return p;
        },
    };

    // 25. chrome.omnibox
    const _omniboxChangedListeners = [];
    _createEventTarget('chrome.omnibox.onInputChanged').addListener((text, suggestCallbackId) => {
        const suggest = (suggestions) => {
            _call('omnibox.sendSuggestions', { suggestCallbackId, suggestions });
        };
        for (const fn of _omniboxChangedListeners) {
            try { fn(text, suggest); } catch (e) { console.warn('[Omnibox Listener Error]', e); }
        }
    });

    window.chrome.omnibox = {
        setDefaultSuggestion: (suggestion) => {
            _call('omnibox.setDefaultSuggestion', { suggestion });
        },
        onInputStarted: _createEventTarget('chrome.omnibox.onInputStarted'),
        onInputChanged: {
            addListener: (fn) => {
                if (typeof fn === 'function' && !_omniboxChangedListeners.includes(fn)) {
                    _omniboxChangedListeners.push(fn);
                }
            },
            removeListener: (fn) => {
                const idx = _omniboxChangedListeners.indexOf(fn);
                if (idx !== -1) _omniboxChangedListeners.splice(idx, 1);
            },
            hasListener: (fn) => _omniboxChangedListeners.includes(fn),
            hasListeners: () => _omniboxChangedListeners.length > 0,
        },
        onInputEntered: _createEventTarget('chrome.omnibox.onInputEntered'),
        onInputCancelled: _createEventTarget('chrome.omnibox.onInputCancelled'),
    };

    // 26. chrome.desktopCapture
    let _desktopCaptureRequestId = 1000;
    const _cancelledDesktopCaptureRequests = new Set();
    window.chrome.desktopCapture = {
        chooseDesktopMedia: (sources, targetTab, callback) => {
            let cb = callback;
            let tab = targetTab;
            if (typeof targetTab === 'function') {
                cb = targetTab;
                tab = null;
            }
            _desktopCaptureRequestId += 1;
            const reqId = _desktopCaptureRequestId;

            _call('desktopCapture.chooseDesktopMedia', { sources, targetTab: tab })
                .then(res => {
                    if (_cancelledDesktopCaptureRequests.has(reqId)) {
                        _cancelledDesktopCaptureRequests.delete(reqId);
                        if (typeof cb === 'function') cb('', {});
                        return;
                    }
                    if (typeof cb === 'function') {
                        cb(res?.streamId || '', res?.options || {});
                    }
                })
                .catch(err => {
                    console.warn('[ExtensionPreload chooseDesktopMedia Error]:', err);
                    if (typeof cb === 'function') cb('', {});
                });

            return reqId;
        },
        cancelChooseDesktopMedia: (requestId) => {
            _cancelledDesktopCaptureRequests.add(Number(requestId));
            _call('desktopCapture.cancelChooseDesktopMedia', { requestId: Number(requestId) }).catch(() => {});
        },
    };

    // 27. chrome.tabCapture
    window.chrome.tabCapture = {
        getMediaStreamId: (options, callback) => {
            let cb = callback;
            let opt = options;
            if (typeof options === 'function') {
                cb = options;
                opt = {};
            }
            const p = _call('tabCapture.getMediaStreamId', { options: opt || {} });
            if (typeof cb === 'function') {
                p.then(id => cb(id)).catch(() => cb(''));
            }
            return p;
        },
        capture: (options, callback) => {
            let cb = callback;
            let opt = options;
            if (typeof options === 'function') {
                cb = options;
                opt = {};
            }
            const promise = (async () => {
                try {
                    const streamId = await _call('tabCapture.getMediaStreamId', { options: opt || {} });
                    if (!streamId) {
                        _setLastError('Failed to obtain tab media stream ID');
                        if (typeof cb === 'function') cb(null);
                        return null;
                    }

                    let stream = null;
                    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
                        if (streamId.startsWith('window:') || streamId.startsWith('screen:')) {
                            try {
                                const constraints = {
                                    audio: opt.audio ? {
                                        mandatory: {
                                            chromeMediaSource: 'desktop',
                                            chromeMediaSourceId: streamId,
                                        }
                                    } : false,
                                    video: opt.video !== false ? {
                                        mandatory: {
                                            chromeMediaSource: 'desktop',
                                            chromeMediaSourceId: streamId,
                                        }
                                    } : false,
                                };
                                stream = await navigator.mediaDevices.getUserMedia(constraints);
                            } catch (err) {
                                console.warn('[tabCapture.capture] Desktop getUserMedia not available or denied by system, using direct tab compositor stream:', err?.message || err);
                            }
                        }
                    }

                    // Fallback to internal compositor frame stream
                    if (!stream) {
                        stream = await _createCompositorTabMediaStream();
                    }

                    if (stream) {
                        stream.getTracks().forEach(track => {
                            track.addEventListener('ended', () => {
                                _call('tabCapture.stopCapture', { streamId }).catch(() => {});
                            });
                        });
                        _setLastError(null);
                        if (typeof cb === 'function') cb(stream);
                        return stream;
                    } else {
                        throw new Error('Unable to create tab media stream');
                    }
                } catch (err) {
                    _setLastError(err?.message || 'Capture failed');
                    if (typeof cb === 'function') cb(null);
                    return null;
                }
            })();
            return promise;
        },
        getCapturedTabs: (callback) => {
            const p = _call('tabCapture.getCapturedTabs');
            if (typeof callback === 'function') {
                p.then(tabs => callback(tabs || [])).catch(() => callback([]));
            }
            return p;
        },
        onStatusChanged: _createEventTarget('chrome.tabCapture.onStatusChanged'),
    };

    // 28. chrome.sessions
    window.chrome.sessions = {
        MAX_SESSION_RESULTS: 25,
        getRecentlyClosed: (filter, callback) => {
            let cb = callback;
            let f = filter;
            if (typeof filter === 'function') {
                cb = filter;
                f = {};
            }
            const p = _call('sessions.getRecentlyClosed', { filter: f || {} });
            if (typeof cb === 'function') {
                p.then(res => {
                    _setLastError(null);
                    cb(res || []);
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to get recently closed sessions');
                    cb([]);
                });
            }
            return p;
        },
        restore: (sessionId, callback) => {
            let cb = callback;
            let sId = sessionId;
            if (typeof sessionId === 'function') {
                cb = sessionId;
                sId = null;
            }
            const p = _call('sessions.restore', { sessionId: sId });
            if (typeof cb === 'function') {
                p.then(res => {
                    _setLastError(null);
                    cb(res);
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to restore session');
                    cb(null);
                });
            }
            return p;
        },
        getDevices: (filter, callback) => {
            let cb = callback;
            let f = filter;
            if (typeof filter === 'function') {
                cb = filter;
                f = {};
            }
            const p = _call('sessions.getDevices', { filter: f || {} });
            if (typeof cb === 'function') {
                p.then(res => {
                    _setLastError(null);
                    cb(res || []);
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to get devices');
                    cb([]);
                });
            }
            return p;
        },
        setTabValue: (tabId, key, value, callback) => {
            const p = _call('sessions.setTabValue', { tabId: Number(tabId), key: String(key), value });
            if (typeof callback === 'function') {
                p.then(() => {
                    _setLastError(null);
                    callback();
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to set tab value');
                    callback();
                });
            }
            return p;
        },
        getTabValue: (tabId, key, callback) => {
            const p = _call('sessions.getTabValue', { tabId: Number(tabId), key: String(key) });
            if (typeof callback === 'function') {
                p.then(val => {
                    _setLastError(null);
                    callback(val);
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to get tab value');
                    callback(undefined);
                });
            }
            return p;
        },
        setWindowValue: (windowId, key, value, callback) => {
            const p = _call('sessions.setWindowValue', { windowId: Number(windowId), key: String(key), value });
            if (typeof callback === 'function') {
                p.then(() => {
                    _setLastError(null);
                    callback();
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to set window value');
                    callback();
                });
            }
            return p;
        },
        getWindowValue: (windowId, key, callback) => {
            const p = _call('sessions.getWindowValue', { windowId: Number(windowId), key: String(key) });
            if (typeof callback === 'function') {
                p.then(val => {
                    _setLastError(null);
                    callback(val);
                }).catch(err => {
                    _setLastError(err?.message || 'Failed to get window value');
                    callback(undefined);
                });
            }
            return p;
        },
        onChanged: _createEventTarget('chrome.sessions.onChanged'),
    };

    function _createCompositorTabMediaStream() {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            const stream = canvas.captureStream ? canvas.captureStream(30) : null;
            if (!stream) {
                resolve(null);
                return;
            }

            let active = true;
            const img = new Image();

            const poll = async () => {
                if (!active) return;
                try {
                    const dataUrl = await _call('tabs.captureVisibleTab', { options: { format: 'jpeg', quality: 80 } });
                    if (dataUrl && active) {
                        img.onload = () => {
                            if (!active) return;
                            if (img.width && img.height && (canvas.width !== img.width || canvas.height !== img.height)) {
                                canvas.width = img.width;
                                canvas.height = img.height;
                            }
                            ctx.drawImage(img, 0, 0);
                        };
                        img.src = dataUrl;
                    }
                } catch (_) {}
                if (active) {
                    setTimeout(poll, 33);
                }
            };

            poll();

            stream.getTracks().forEach(t => {
                const orig = t.stop.bind(t);
                t.stop = () => {
                    active = false;
                    orig();
                };
            });

            resolve(stream);
        });
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function (constraints) {
            const videoMandatory = constraints?.video?.mandatory || {};
            const audioMandatory = constraints?.audio?.mandatory || {};
            const isTabSource = videoMandatory.chromeMediaSource === 'tab' || audioMandatory.chromeMediaSource === 'tab';
            const isDesktopSource = videoMandatory.chromeMediaSource === 'desktop' || audioMandatory.chromeMediaSource === 'desktop';

            if (isTabSource) {
                const streamId = videoMandatory.chromeMediaSourceId || audioMandatory.chromeMediaSourceId;
                if (streamId && (streamId.startsWith('window:') || streamId.startsWith('screen:'))) {
                    try {
                        const modifiedConstraints = JSON.parse(JSON.stringify(constraints));
                        if (modifiedConstraints.video?.mandatory) {
                            modifiedConstraints.video.mandatory.chromeMediaSource = 'desktop';
                        }
                        if (modifiedConstraints.audio?.mandatory) {
                            modifiedConstraints.audio.mandatory.chromeMediaSource = 'desktop';
                        }
                        return await origGetUserMedia(modifiedConstraints);
                    } catch (nativeErr) {
                        console.warn('[getUserMedia polyfill] Native desktop capture unavailable, using tab compositor stream:', nativeErr?.message || nativeErr);
                    }
                }
                return await _createCompositorTabMediaStream();
            }

            try {
                return await origGetUserMedia(constraints);
            } catch (err) {
                if (isDesktopSource && (err?.name === 'AbortError' || err?.message?.includes('Permission denied') || err?.name === 'NotAllowedError')) {
                    const streamId = videoMandatory.chromeMediaSourceId || audioMandatory.chromeMediaSourceId || '';
                    if (streamId.startsWith('tab:') || streamId.startsWith('window:')) {
                        console.warn('[getUserMedia polyfill] System permission denied or invalid state, falling back to tab compositor stream:', err?.message || err);
                        return await _createCompositorTabMediaStream();
                    }
                }
                throw err;
            }
        };
    }

    if (typeof window !== 'undefined') {
        // 27. chrome.proxy
        if (!window.chrome.proxy) {
            window.chrome.proxy = {
                settings: {
                    get: (details, cb) => {
                        let d = details;
                        let callback = cb;
                        if (typeof details === 'function') { callback = details; d = {}; }
                        const p = _call('proxy.settings.get', d || {});
                        if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback({ value: { mode: 'system' }, levelOfControl: 'controllable_by_this_extension' }));
                        return p;
                    },
                    set: (details, cb) => {
                        const p = _call('proxy.settings.set', details || {});
                        if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                        return p;
                    },
                    clear: (details, cb) => {
                        let d = details;
                        let callback = cb;
                        if (typeof details === 'function') { callback = details; d = {}; }
                        const p = _call('proxy.settings.clear', d || {});
                        if (typeof callback === 'function') p.then(() => cb()).catch(() => cb());
                        return p;
                    },
                    onChange: _createEventTarget('chrome.proxy.settings.onChange'),
                },
                onProxyError: _createEventTarget('chrome.proxy.onProxyError'),
            };
        }

        // 28. chrome.browsingData
        if (!window.chrome.browsingData) {
            function _createRemovalMethod(methodName) {
                return (options, cb) => {
                    let opts = options;
                    let callback = cb;
                    if (typeof options === 'function') { callback = options; opts = {}; }
                    const p = _call(methodName, { options: opts || {} });
                    if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
                    return p;
                };
            }

            window.chrome.browsingData = {
                settings: (cb) => {
                    const p = _call('browsingData.settings');
                    if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({ options: { since: 0 }, dataToRemove: {}, dataRemovalPermitted: {} }));
                    return p;
                },
                remove: (options, dataToRemove, cb) => {
                    const p = _call('browsingData.remove', { options: options || {}, dataToRemove: dataToRemove || {} });
                    if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                    return p;
                },
                removeAppcache: _createRemovalMethod('browsingData.removeAppcache'),
                removeCache: _createRemovalMethod('browsingData.removeCache'),
                removeCookies: _createRemovalMethod('browsingData.removeCookies'),
                removeDownloads: _createRemovalMethod('browsingData.removeDownloads'),
                removeFileSystems: _createRemovalMethod('browsingData.removeFileSystems'),
                removeFormData: _createRemovalMethod('browsingData.removeFormData'),
                removeHistory: _createRemovalMethod('browsingData.removeHistory'),
                removeIndexedDB: _createRemovalMethod('browsingData.removeIndexedDB'),
                removeLocalStorage: _createRemovalMethod('browsingData.removeLocalStorage'),
                removePasswords: _createRemovalMethod('browsingData.removePasswords'),
                removePluginData: _createRemovalMethod('browsingData.removePluginData'),
                removeServiceWorkers: _createRemovalMethod('browsingData.removeServiceWorkers'),
                removeWebSQL: _createRemovalMethod('browsingData.removeWebSQL'),
            };
        }

        // 29. chrome.idle
        if (!window.chrome.idle) {
            window.chrome.idle = {
                queryState: (detectionIntervalInSeconds, cb) => {
                    const p = _call('idle.queryState', { detectionIntervalInSeconds });
                    if (typeof cb === 'function') p.then(state => cb(state)).catch(() => cb('active'));
                    return p;
                },
                setDetectionInterval: (intervalInSeconds) => {
                    _call('idle.setDetectionInterval', { intervalInSeconds }).catch(() => {});
                },
                getAutoLockDelay: (cb) => {
                    const p = _call('idle.getAutoLockDelay');
                    if (typeof cb === 'function') p.then(delay => cb(delay)).catch(() => cb(0));
                    return p;
                },
                onStateChanged: _createEventTarget('chrome.idle.onStateChanged'),
            };
        }

        // 30. chrome.power
        if (!window.chrome.power) {
            window.chrome.power = {
                requestKeepAwake: (level) => {
                    _call('power.requestKeepAwake', { level: level || 'system' }).catch(() => {});
                },
                releaseKeepAwake: () => {
                    _call('power.releaseKeepAwake', {}).catch(() => {});
                },
            };
        }

        window.invisurf = {
            openScreenCaptureSettings: () => _call('system.openScreenCaptureSettings', {}),
            getMediaAccessStatus: () => _call('system.getMediaAccessStatus', {}),
        };
    }

    // Dynamic extension popup resizing
    if (typeof window !== 'undefined' && window.location?.protocol === 'chrome-extension:') {
        let lastReportedW = 0;
        let lastReportedH = 0;
        const reportPopupDimensions = () => {
            try {
                const doc = document.documentElement;
                const body = document.body;
                if (!doc || !body) return;
                const rect = body.getBoundingClientRect();
                const w = Math.ceil(Math.max(doc.scrollWidth || 0, body.scrollWidth || 0, rect.width || 0));
                const h = Math.ceil(Math.max(doc.scrollHeight || 0, body.scrollHeight || 0, rect.height || 0));
                if (w > 0 && h > 0 && (Math.abs(w - lastReportedW) > 2 || Math.abs(h - lastReportedH) > 2)) {
                    lastReportedW = w;
                    lastReportedH = h;
                    ipcRenderer.send('invisurf:resize-extension-popup', { width: w, height: h });
                }
            } catch (_) {}
        };

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                reportPopupDimensions();
            });
            const startObserving = () => {
                if (document.documentElement) ro.observe(document.documentElement);
                if (document.body) ro.observe(document.body);
                reportPopupDimensions();
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', startObserving);
            } else {
                startObserving();
            }
        }
        window.addEventListener('load', reportPopupDimensions);
    }
})();
