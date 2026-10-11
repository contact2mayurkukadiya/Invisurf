/* [InviSurf Extension Runtime Polyfill] */
(() => {
    if (typeof self === 'undefined') return;
    if (self.__invisurf_compat_initialized) return;
    if (self.__invisurf_preload_active) {
        // Preload script (extensionPreload.js) is already active in this window/context.
        // It provides native IPC-based chrome APIs. Do not initialize a duplicate SSE stream or duplicate listeners.
        return;
    }
    self.__invisurf_compat_initialized = true;

    const EXT_ID = "bdalnfcbbdbppjgobmidjaokkhgpjljl";
    const EXT_MANIFEST = {"manifest_version":3,"name":"Media Capture Tester","version":"1.0.0","description":"Test chrome.tabCapture and chrome.desktopCapture APIs with live preview and track diagnostics in InviSurf.","permissions":["tabCapture","desktopCapture","tabs","activeTab"],"action":{"default_popup":"popup.html","default_title":"Media Capture Tester"},"icons":{"128":"icon.png"},"background":{"service_worker":"background.js"},"options_ui":{"page":"options.html","open_in_tab":true}};
    const EXT_MESSAGES = {};

    self.__invisurf_manifest = EXT_MANIFEST;
    self.__invisurf_messages = EXT_MESSAGES;

    // Event listeners registry for InviSurf push events
    const _listeners = {
        'chrome.runtime.onMessage': [],
        'chrome.storage.onChanged': [],
        'chrome.action.onClicked': [],
        'chrome.browserAction.onClicked': [],
        'chrome.tabs.onCreated': [],
        'chrome.tabs.onUpdated': [],
        'chrome.tabs.onRemoved': [],
        'chrome.tabs.onActivated': [],
        'chrome.commands.onCommand': [],
        'chrome.contextMenus.onClicked': [],
        'chrome.proxy.settings.onChange': [],
        'chrome.proxy.onProxyError': [],
        'chrome.idle.onStateChanged': [],
    };

    // Capture native chrome events before defining any wrappers
    const _nativeOnConnect = (typeof self !== 'undefined' && self.chrome && self.chrome.runtime) ? self.chrome.runtime.onConnect : null;
    const _nativeOnMessage = (typeof self !== 'undefined' && self.chrome && self.chrome.runtime) ? self.chrome.runtime.onMessage : null;
    const _nativeSendMessage = (typeof self !== 'undefined' && self.chrome && self.chrome.runtime && typeof self.chrome.runtime.sendMessage === 'function') ? self.chrome.runtime.sendMessage : null;

    let _lastActiveProxyTabId = null;
    let _lastKnownActiveTabId = null;

    function _wrapPortIfNeeded(port) {
        if (!port) return port;
        if (port.sender?.tab) {
            if (!port.sender.tab.width || !port.sender.tab.height) {
                port.sender.tab.width = port.sender.tab.width || 1280;
                port.sender.tab.height = port.sender.tab.height || 800;
            }
        }
        if (port.name === 'proxy') {
            if (port.sender?.tab?.id) {
                _lastActiveProxyTabId = port.sender.tab.id;
            }
            return port;
        }
        const isNumeric = +(port.name) + '' === port.name && Number(port.name) > 0;
        if (!isNumeric) {
            const targetTabId = _lastActiveProxyTabId || _lastKnownActiveTabId;
            if (targetTabId) {
                return new Proxy(port, {
                    get(target, prop) {
                        if (prop === 'name') return String(targetTabId);
                        const val = target[prop];
                        if (typeof val === 'function') return val.bind(target);
                        return val;
                    }
                });
            }
        }
        return port;
    }

    function _wrapMessageIfNeeded(message, sender) {
        if (message && typeof message === 'object') {
            if (message.source === 'devtools-page' && message.payload) {
                const targetTabId = _lastActiveProxyTabId || _lastKnownActiveTabId;
                if (targetTabId && (message.payload.tabId === -1 || !message.payload.tabId)) {
                    message.payload.tabId = targetTabId;
                }
            }
        }
        if (sender && typeof sender === 'object') {
            if (!sender.tab || sender.tab.id === -1 || !sender.tab.id) {
                const targetTabId = _lastActiveProxyTabId || _lastKnownActiveTabId;
                if (targetTabId) {
                    sender.tab = { id: targetTabId, url: sender.url || '', width: 1280, height: 800 };
                }
            } else if (sender.tab && (!sender.tab.width || !sender.tab.height)) {
                sender.tab.width = sender.tab.width || 1280;
                sender.tab.height = sender.tab.height || 800;
            }
        }
        return message;
    }

    function _createEventTarget(name, nativeTarget = null, transformFn = null) {
        if (!_listeners[name]) _listeners[name] = [];
        return {
            addListener: (fn) => {
                if (typeof fn === 'function' && !_listeners[name].includes(fn)) {
                    _listeners[name].push(fn);
                    if (nativeTarget && typeof nativeTarget.addListener === 'function') {
                        try {
                            const nativeHandler = (...args) => {
                                const processed = transformFn ? transformFn(...args) : args;
                                return fn(...processed);
                            };
                            fn.__nativeHandler = nativeHandler;
                            nativeTarget.addListener(nativeHandler);
                        } catch (e) {
                            console.warn('[Polyfill Native Event AddListener Error]:', e);
                        }
                    }
                }
            },
            removeListener: (fn) => {
                if (_listeners[name]) {
                    const idx = _listeners[name].indexOf(fn);
                    if (idx !== -1) _listeners[name].splice(idx, 1);
                    if (nativeTarget && typeof nativeTarget.removeListener === 'function') {
                        try {
                            const nativeHandler = fn.__nativeHandler || fn;
                            nativeTarget.removeListener(nativeHandler);
                        } catch (_) {}
                    }
                }
            },
            hasListener: (fn) => _listeners[name]?.includes(fn) || (nativeTarget?.hasListener ? nativeTarget.hasListener(fn) : false),
            hasListeners: () => (_listeners[name]?.length || 0) > 0 || (nativeTarget?.hasListeners ? nativeTarget.hasListeners() : false),
            _listeners: _listeners[name] || [],
        };
    }

    function _dispatchEvent(name, args = []) {
        let processedArgs = args;
        if (name === 'chrome.runtime.onConnect' && args[0]) {
            processedArgs = [_wrapPortIfNeeded(args[0])];
        } else if (name === 'chrome.runtime.onMessage' && args[0]) {
            _wrapMessageIfNeeded(args[0], args[1]);
        } else if ((name === 'chrome.action.onClicked' || name === 'chrome.browserAction.onClicked') && args[0]) {
            if (typeof args[0] === 'object') {
                if (!args[0].width || !args[0].height) {
                    args[0].width = args[0].width || 1280;
                    args[0].height = args[0].height || 800;
                }
            }
        }
        const list = _listeners[name] || [];
        for (const fn of list) {
            try {
                fn(...processedArgs);
            } catch (err) {
                console.warn('[InviSurf Polyfill Event Error]:', err);
            }
        }
    }

    function _dispatchMessageEvent(args = [], messageId = null) {
        const message = args[0];
        const sender = args[1] || {};
        _wrapMessageIfNeeded(message, sender);

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
                console.warn('[InviSurf Worker onMessage Error]:', err);
            }
        }
    }

    // Direct IPC dispatch via invisurf-ext:// for Shell APIs
    async function _call(method, args = {}) {
        try {
            const res = await fetch('invisurf-ext://api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method,
                    args,
                    extensionId: EXT_ID,
                }),
            });
            const data = await res.json();
            if (data && data.ok) return data.result;
            throw new Error(data ? data.error : 'Unknown bridge error');
        } catch (err) {
            console.warn('[InviSurf Polyfill Call Error] ' + method + ':', err?.message || err);
            throw err;
        }
    }

    // Error Trapping Layer for Service Worker (Passive & Rate-Limited)
    let _errTokens = 10;
    let _lastTokenRefill = Date.now();
    function _reportError(errData) {
        try {
            const now = Date.now();
            if (now - _lastTokenRefill > 1000) {
                _errTokens = 10;
                _lastTokenRefill = now;
            }
            if (_errTokens <= 0) return;
            _errTokens--;

            _call('error.report', {
                message: errData.message || 'Unknown worker error',
                source: errData.source || errData.filename || '',
                lineno: errData.lineno || 0,
                colno: errData.colno || 0,
                stack: errData.stack || '',
                context: 'service_worker',
            }).catch(() => {});
        } catch (_) {}
    }

    if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
        self.addEventListener('error', (event) => {
            _reportError({
                message: event.message || (event.error && event.error.message) || String(event.error || 'Error'),
                source: event.filename || '',
                lineno: event.lineno || 0,
                colno: event.colno || 0,
                stack: event.error?.stack || '',
            });
        });

        self.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            _reportError({
                message: reason?.message || String(reason || 'Unhandled Promise Rejection'),
                source: reason?.fileName || reason?.sourceURL || '',
                lineno: reason?.lineNumber || reason?.line || 0,
                colno: reason?.columnNumber || reason?.column || 0,
                stack: reason?.stack || '',
            });
        });
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
            onMessage: _createEventTarget('chrome.runtime.portOnMessage_' + portId),
            onDisconnect: _createEventTarget('chrome.runtime.portOnDisconnect_' + portId),
        };
    }

    // Persistent streaming event receiver (Zero CPU idle, event-driven kernel wait)
    async function _startEventStream() {
        try {
            _call('tabs.query', { active: true }).then(tabs => {
                if (Array.isArray(tabs) && tabs[0]?.id) {
                    _lastKnownActiveTabId = tabs[0].id;
                }
            }).catch(() => {});
        } catch (_) {}

        while (true) {
            try {
                const res = await fetch('invisurf-ext://events-stream?extId=' + encodeURIComponent(EXT_ID));
                if (!res.ok || !res.body) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep partial trailing line

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith(':')) continue; // Skip comments/keepalive
                        try {
                            const ev = JSON.parse(trimmed);
                            if (ev && ev.eventName) {
                                if (ev.eventName === 'chrome.tabs.onActivated') {
                                    const info = (ev.args && ev.args[0]) || {};
                                    if (info.tabId) _lastKnownActiveTabId = info.tabId;
                                }
                                if (ev.eventName === 'chrome.runtime.onConnect') {
                                    const info = (ev.args && ev.args[0]) || {};
                                    const port = _createPortObject(info.portId, info.name, info.sender);
                                    _dispatchEvent('chrome.runtime.onConnect', [port]);
                                } else if (ev.eventName === 'chrome.runtime.onMessage') {
                                    _dispatchMessageEvent(ev.args || [], ev.messageId);
                                } else {
                                    _dispatchEvent(ev.eventName, ev.args || []);
                                }
                            }
                        } catch (parseErr) {
                            console.warn('[InviSurf Stream Event Parse Error]:', parseErr);
                        }
                    }
                }
            } catch (err) {
                // Connection closed or worker sleep/wake; retry with backoff
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    // Initialize chrome namespace
    if (!self.chrome) self.chrome = {};

    // 1. chrome.runtime
    if (!self.chrome.runtime) self.chrome.runtime = {};
    if (!self.chrome.runtime.id) self.chrome.runtime.id = EXT_ID;
    if (!self.chrome.runtime.getURL) self.chrome.runtime.getURL = (p) => 'chrome-extension://' + EXT_ID + '/' + String(p || '').replace(/^\//, '');
    if (!self.chrome.runtime.getManifest) {
        self.chrome.runtime.getManifest = () => {
            try {
                return self.__invisurf_manifest || { name: EXT_ID, version: '1.0.0', manifest_version: 3 };
            } catch (_) {
                return { name: EXT_ID, version: '1.0.0', manifest_version: 3 };
            }
        };
    }
    self.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts, opts) => {
        let targetId = EXT_ID;
        let message = extIdOrMsg;
        let callback = null;
        if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
            targetId = extIdOrMsg;
            message = msgOrOpts;
            if (typeof opts === 'function') callback = opts;
        } else {
            if (typeof msgOrOpts === 'function') callback = msgOrOpts;
            else if (typeof opts === 'function') callback = opts;
        }
        if (_nativeSendMessage) {
            try {
                return _nativeSendMessage.call(self.chrome.runtime, extIdOrMsg, msgOrOpts, opts);
            } catch (_) {}
        }
        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const p = _call('runtime.sendMessage', { targetExtId: targetId, message, messageId });
        if (typeof callback === 'function') {
            p.then(res => callback(res)).catch(() => callback(undefined));
        }
        return p;
    };
    self.chrome.runtime.onMessage = _createEventTarget('chrome.runtime.onMessage', _nativeOnMessage, (msg, sender, sendResp) => {
        _wrapMessageIfNeeded(msg, sender);
        return [msg, sender, sendResp];
    });
    self.chrome.runtime.connect = (connectOpts = {}) => {
        const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
        const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        _call('runtime.connect', { portId, name: portName, targetExtId: EXT_ID }).catch(() => {});
        return _createPortObject(portId, portName, { id: EXT_ID });
    };
    self.chrome.runtime.onConnect = _createEventTarget('chrome.runtime.onConnect', _nativeOnConnect, (port) => {
        return [_wrapPortIfNeeded(port)];
    });
    if (!self.chrome.runtime.openOptionsPage) {
        self.chrome.runtime.openOptionsPage = (cb) => {
            const p = _call('runtime.openOptionsPage', {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        };
    }
    if (!self.chrome.runtime.setUninstallURL) {
        self.chrome.runtime.setUninstallURL = (url, cb) => {
            if (typeof cb === 'function') cb();
            return Promise.resolve();
        };
    }
    if (!self.chrome.runtime.reload) self.chrome.runtime.reload = () => _call('runtime.reload', {});
    if (!self.chrome.runtime.getPlatformInfo) {
        self.chrome.runtime.getPlatformInfo = (cb) => {
            const p = _call('runtime.getPlatformInfo');
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({ os: 'mac', arch: 'arm64', nacl_arch: 'arm64' }));
            return p;
        };
    }
    if (!self.chrome.runtime.onInstalled) self.chrome.runtime.onInstalled = _createEventTarget('chrome.runtime.onInstalled');
    if (!self.chrome.runtime.onStartup) self.chrome.runtime.onStartup = _createEventTarget('chrome.runtime.onStartup');
    if (!self.chrome.runtime.onSuspend) self.chrome.runtime.onSuspend = _createEventTarget('chrome.runtime.onSuspend');
    if (!self.chrome.runtime.onSuspendCanceled) self.chrome.runtime.onSuspendCanceled = _createEventTarget('chrome.runtime.onSuspendCanceled');
    if (!self.chrome.runtime.getBackgroundPage) self.chrome.runtime.getBackgroundPage = (cb) => { if (typeof cb === 'function') cb(null); return Promise.resolve(null); };
    if (!self.chrome.runtime.getContexts) self.chrome.runtime.getContexts = (filter, cb) => { if (typeof cb === 'function') cb([]); return Promise.resolve([]); };
    if (!self.chrome.runtime.sendNativeMessage) self.chrome.runtime.sendNativeMessage = (app, msg, cb) => { if (typeof cb === 'function') cb(null); return Promise.resolve(null); };

    // 1b. chrome.extension (Legacy MV2 namespace)
    if (!self.chrome.extension) {
        self.chrome.extension = {
            getURL: (p) => self.chrome.runtime.getURL(p),
            getBackgroundPage: () => null,
            getViews: () => [],
            isAllowedIncognitoAccess: (cb) => { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
            isAllowedFileSchemeAccess: (cb) => { if (typeof cb === 'function') cb(false); return Promise.resolve(false); },
            sendMessage: (msg, cb) => self.chrome.runtime.sendMessage(msg, cb),
            onMessage: self.chrome.runtime.onMessage,
            onRequest: _createEventTarget('chrome.extension.onRequest'),
            sendRequest: (msg, cb) => self.chrome.runtime.sendMessage(msg, cb),
            connect: (opts) => self.chrome.runtime.connect(opts),
            onConnect: self.chrome.runtime.onConnect,
            lastError: null,
        };
    }

    // 2. chrome.storage (Native Chromium Passthrough with fallback)
    if (!self.chrome.storage) {
        function _createStorageArea(area) {
            return {
                get: (keys, cb) => {
                    const p = _call('storage.get', { area, keys });
                    if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({}));
                    return p;
                },
                set: (items, cb) => {
                    const p = _call('storage.set', { area, items });
                    if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                    return p;
                },
                remove: (keys, cb) => {
                    const p = _call('storage.remove', { area, keys });
                    if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                    return p;
                },
                clear: (cb) => {
                    const p = _call('storage.clear', { area });
                    if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                    return p;
                },
                getBytesInUse: (keys, cb) => {
                    const p = _call('storage.getBytesInUse', { area, keys });
                    if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(0));
                    return p;
                },
            };
        }

        self.chrome.storage = {
            local: _createStorageArea('local'),
            sync: _createStorageArea('sync'),
            session: _createStorageArea('session'),
            onChanged: _createEventTarget('chrome.storage.onChanged'),
        };
    }

    // 3. chrome.tabs (Shell-routed: InviSurf WebContentsViews)
    self.chrome.tabs = {
        query: (queryInfo, cb) => {
            const p = _call('tabs.query', { queryInfo: queryInfo || {} });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        get: (tabId, cb) => {
            const p = _call('tabs.get', { tabId });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        getCurrent: (cb) => {
            const p = _call('tabs.getCurrent', {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        create: (props, cb) => {
            const pProps = props ? { ...props } : {};
            if (pProps.url && typeof pProps.url === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pProps.url)) {
                try {
                    if (self.chrome?.runtime?.getURL) {
                        pProps.url = self.chrome.runtime.getURL(pProps.url);
                    }
                } catch (_) {}
            }
            const p = _call('tabs.create', { createProperties: pProps });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
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
                    if (self.chrome?.runtime?.getURL) {
                        pProps.url = self.chrome.runtime.getURL(pProps.url);
                    }
                } catch (_) {}
            }
            const p = _call('tabs.update', { tabId: tId, updateProperties: pProps });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        remove: (tabIds, cb) => {
            const p = _call('tabs.remove', { tabIds });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        reload: (tabId, props, cb) => {
            const p = _call('tabs.reload', { tabId, reloadProperties: props || {} });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        goBack: (tabId, cb) => {
            const p = _call('tabs.goBack', { tabId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        goForward: (tabId, cb) => {
            const p = _call('tabs.goForward', { tabId });
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
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
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(undefined));
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
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        move: (tabIds, moveProperties, cb) => {
            const p = _call('tabs.move', { tabIds, moveProperties: moveProperties || {} });
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
            return p;
        },
        onCreated: _createEventTarget('chrome.tabs.onCreated'),
        onUpdated: _createEventTarget('chrome.tabs.onUpdated'),
        onRemoved: _createEventTarget('chrome.tabs.onRemoved'),
        onActivated: _createEventTarget('chrome.tabs.onActivated'),
    };

    // 4. chrome.action & chrome.browserAction (Shell-synced + Native Passthrough)
    const _nativeAction = (typeof self !== 'undefined' && self.chrome) ? (self.chrome.action || self.chrome.browserAction || null) : null;
    const _actionApi = {
        setTitle: (details, cb) => {
            if (_nativeAction?.setTitle) try { _nativeAction.setTitle(details); } catch (_) {}
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
            if (_nativeAction?.setBadgeText) try { _nativeAction.setBadgeText(details); } catch (_) {}
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
            if (_nativeAction?.setBadgeBackgroundColor) try { _nativeAction.setBadgeBackgroundColor(details); } catch (_) {}
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
            if (_nativeAction?.setBadgeTextColor) try { _nativeAction.setBadgeTextColor(details); } catch (_) {}
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
            if (_nativeAction?.setPopup) try { _nativeAction.setPopup(details); } catch (_) {}
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
            if (_nativeAction?.enable) try { _nativeAction.enable(tabId); } catch (_) {}
            const p = _call('action.enable', { tabId });
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        disable: (tabId, cb) => {
            if (_nativeAction?.disable) try { _nativeAction.disable(tabId); } catch (_) {}
            const p = _call('action.disable', { tabId });
            if (typeof cb === 'function') p.then(() => cb());
            return p;
        },
        setIcon: (details, cb) => {
            if (_nativeAction?.setIcon) try { _nativeAction.setIcon(details); } catch (_) {}
            const p = _call('action.setIcon', details || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        onClicked: _createEventTarget('chrome.action.onClicked', _nativeAction?.onClicked || null),
    };

    self.chrome.action = _actionApi;
    self.chrome.browserAction = _actionApi;

    // 5. chrome.scripting (Shell-routed: InviSurf WebContents execution)
    self.chrome.scripting = {
        ExecutionWorld: {
            ISOLATED: 'ISOLATED',
            MAIN: 'MAIN',
        },
        executeScript: (injection, cb) => {
            const p = _call('scripting.executeScript', injection || {});
            if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
            return p;
        },
        insertCSS: (injection, cb) => {
            const p = _call('scripting.insertCSS', injection || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
            return p;
        },
        removeCSS: (injection, cb) => {
            const p = _call('scripting.removeCSS', injection || {});
            if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
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
            if (typeof filter === 'function') { callback = filter; f = {}; }
            const p = _call('scripting.getRegisteredContentScripts', { filter: f });
            if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback([]));
            return p;
        },
        unregisterContentScripts: (filter, cb) => {
            let f = filter;
            let callback = cb;
            if (typeof filter === 'function') { callback = filter; f = {}; }
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

    // 6. chrome.cookies (Native Chromium Passthrough with fallback)
    if (!self.chrome.cookies) {
        self.chrome.cookies = {
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
    }

    // 7. chrome.windows (Shell-routed: InviSurf BrowserWindows)
    self.chrome.windows = {
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
                        if (self.chrome?.runtime?.getURL) {
                            data.url = self.chrome.runtime.getURL(data.url);
                        }
                    } else if (Array.isArray(data.url)) {
                        data.url = data.url.map(u => {
                            if (typeof u === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
                                return self.chrome?.runtime?.getURL ? self.chrome.runtime.getURL(u) : u;
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

    // 8. chrome.alarms (Native Chromium Passthrough with fallback)
    if (!self.chrome.alarms) {
        self.chrome.alarms = {
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
    }

    // 9. chrome.contextMenus (Shell-routed: InviSurf Context Menus)
    self.chrome.contextMenus = {
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

    // 10. chrome.declarativeNetRequest (Native Chromium Passthrough with fallback)
    if (!self.chrome.declarativeNetRequest) {
        self.chrome.declarativeNetRequest = {
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
    }

    // 11. chrome.notifications (Native Chromium Passthrough with fallback)
    if (!self.chrome.notifications) {
        self.chrome.notifications = {
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
                const p = _call('notifications.create', { notificationId: nId, options: nOptions || {} });
                if (typeof callback === 'function') p.then(id => callback(id)).catch(() => callback(''));
                return p;
            },
            update: (notificationId, options, cb) => {
                const p = _call('notifications.update', { notificationId, options: options || {} });
                if (typeof cb === 'function') p.then(wasUpdated => cb(wasUpdated)).catch(() => cb(false));
                return p;
            },
            clear: (notificationId, cb) => {
                const p = _call('notifications.clear', { notificationId });
                if (typeof cb === 'function') p.then(wasCleared => cb(wasCleared)).catch(() => cb(false));
                return p;
            },
            getAll: (cb) => {
                const p = _call('notifications.getAll');
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({}));
                return p;
            },
            onClicked: _createEventTarget('chrome.notifications.onClicked'),
            onClosed: _createEventTarget('chrome.notifications.onClosed'),
        };
    }

    // 12. chrome.webNavigation (Native Chromium Passthrough with fallback)
    if (!self.chrome.webNavigation) {
        self.chrome.webNavigation = {
            getFrame: (details, cb) => {
                const p = _call('webNavigation.getFrame', details || {});
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(null));
                return p;
            },
            getAllFrames: (details, cb) => {
                const p = _call('webNavigation.getAllFrames', details || {});
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
            onBeforeNavigate: _createEventTarget('chrome.webNavigation.onBeforeNavigate'),
            onCommitted: _createEventTarget('chrome.webNavigation.onCommitted'),
            onDOMContentLoaded: _createEventTarget('chrome.webNavigation.onDOMContentLoaded'),
            onCompleted: _createEventTarget('chrome.webNavigation.onCompleted'),
            onErrorOccurred: _createEventTarget('chrome.webNavigation.onErrorOccurred'),
            onCreatedNavigationTarget: _createEventTarget('chrome.webNavigation.onCreatedNavigationTarget'),
        };
    }

    // 13. chrome.commands (Native Chromium Passthrough with fallback)
    if (!self.chrome.commands) {
        self.chrome.commands = {
            getAll: (cb) => {
                const p = _call('commands.getAll');
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
            onCommand: _createEventTarget('chrome.commands.onCommand'),
        };
    }

    // 14. chrome.i18n (Native Chromium Passthrough with fallback)
    if (!self.chrome.i18n) {
        self.chrome.i18n = {
            getMessage: (messageName, substitutions) => {
                if (!messageName) return '';
                const messages = self.__invisurf_messages || {};
                const entry = messages[messageName];
                if (!entry) return '';
                let msg = entry.message || '';
                if (entry.placeholders && substitutions) {
                    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
                    for (let i = 0; i < subs.length; i++) {
                        msg = msg.replace(new RegExp('\\$' + (i + 1), 'g'), String(subs[i]));
                    }
                }
                return msg;
            },
            getUILanguage: () => (typeof navigator !== 'undefined' ? (navigator.language || 'en-US') : 'en-US'),
            getAcceptLanguages: (cb) => {
                const langs = typeof navigator !== 'undefined' && Array.isArray(navigator.languages) ? navigator.languages : ['en-US', 'en'];
                if (typeof cb === 'function') cb(langs);
                return Promise.resolve(langs);
            },
            detectLanguage: (text, cb) => {
                const res = { isReliable: true, languages: [{ language: 'en', percentage: 100 }] };
                if (typeof cb === 'function') cb(res);
                return Promise.resolve(res);
            },
        };
    }

    // 15. chrome.permissions (Native Chromium Passthrough with fallback)
    if (!self.chrome.permissions) {
        const _dynamicallyGrantedPerms = new Set();
        self.chrome.permissions = {
            contains: (permissions, cb) => {
                const manifest = self.chrome.runtime.getManifest();
                const manifestPerms = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
                const reqPerms = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
                const hasAll = reqPerms.every(p => manifestPerms.includes(p) || _dynamicallyGrantedPerms.has(p));
                if (typeof cb === 'function') cb(hasAll);
                return Promise.resolve(hasAll);
            },
            getAll: (cb) => {
                const manifest = self.chrome.runtime.getManifest();
                const perms = {
                    permissions: [
                        ...(Array.isArray(manifest?.permissions) ? manifest.permissions : []),
                        ..._dynamicallyGrantedPerms,
                    ],
                    origins: Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : [],
                };
                if (typeof cb === 'function') cb(perms);
                return Promise.resolve(perms);
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
    }

    // 16. chrome.management (Native Chromium Passthrough with fallback)
    if (!self.chrome.management) {
        self.chrome.management = {
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
    }

    // 17. chrome.downloads (Native Chromium Passthrough with fallback)
    if (!self.chrome.downloads) {
        self.chrome.downloads = {
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
            show: (downloadId) => _call('downloads.show', { downloadId }),
            open: (downloadId) => _call('downloads.open', { downloadId }),
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
    }

    // 18. chrome.webRequest (Native Chromium Passthrough with fallback)
    if (!self.chrome.webRequest) {
        self.chrome.webRequest = {
            onBeforeRequest: _createEventTarget('chrome.webRequest.onBeforeRequest'),
            onBeforeSendHeaders: _createEventTarget('chrome.webRequest.onBeforeSendHeaders'),
            onSendHeaders: _createEventTarget('chrome.webRequest.onSendHeaders'),
            onHeadersReceived: _createEventTarget('chrome.webRequest.onHeadersReceived'),
            onResponseStarted: _createEventTarget('chrome.webRequest.onResponseStarted'),
            onBeforeRedirect: _createEventTarget('chrome.webRequest.onBeforeRedirect'),
            onCompleted: _createEventTarget('chrome.webRequest.onCompleted'),
            onErrorOccurred: _createEventTarget('chrome.webRequest.onErrorOccurred'),
        };
    }

    // 19. chrome.sidePanel (Manifest V3)
    if (!self.chrome.sidePanel) {
        self.chrome.sidePanel = {
            open: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
            setOptions: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
            getOptions: (options, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
            setPanelBehavior: (behavior, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
            getPanelBehavior: (cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
        };
    }

    // 20. chrome.bookmarks
    if (!self.chrome.bookmarks) {
        self.chrome.bookmarks = {
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
    }

    // 21. chrome.history
    if (!self.chrome.history) {
        self.chrome.history = {
            search: (query, cb) => {
                const p = _call('history.search', { query: query || {} });
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
            getVisits: (details, cb) => {
                const p = _call('history.getVisits', details || {});
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
            addUrl: (details, cb) => {
                const p = _call('history.addUrl', details || {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            deleteUrl: (details, cb) => {
                const p = _call('history.deleteUrl', details || {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            deleteRange: (range, cb) => {
                const p = _call('history.deleteRange', range || {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            deleteAll: (cb) => {
                const p = _call('history.deleteAll', {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            onVisited: _createEventTarget('chrome.history.onVisited'),
            onVisitRemoved: _createEventTarget('chrome.history.onVisitRemoved'),
        };
    }

    // 22. chrome.identity
    if (!self.chrome.identity) {
        self.chrome.identity = {
            getAuthToken: (details, cb) => {
                let d = details;
                let callback = cb;
                if (typeof details === 'function') { callback = details; d = {}; }
                const p = _call('identity.getAuthToken', details || {});
                if (typeof callback === 'function') p.then(token => callback(token)).catch(() => callback(null));
                return p;
            },
            getProfileUserInfo: (details, cb) => {
                let callback = cb;
                if (typeof details === 'function') callback = details;
                const p = _call('identity.getProfileUserInfo');
                if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback({ email: '', id: '' }));
                return p;
            },
            removeCachedAuthToken: (details, cb) => {
                const p = _call('identity.removeCachedAuthToken', details || {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            launchWebAuthFlow: (details, cb) => {
                const p = _call('identity.launchWebAuthFlow', details || {});
                if (typeof cb === 'function') p.then(url => cb(url)).catch(() => cb(undefined));
                return p;
            },
            getRedirectURL: (p) => 'https://' + EXT_ID + '.chromiumapp.org/' + String(p || '').replace(/^\//, ''),
            onSignInChanged: _createEventTarget('chrome.identity.onSignInChanged'),
        };
    }

    // 23. chrome.offscreen
    if (!self.chrome.offscreen) {
        self.chrome.offscreen = {
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
                const p = _call('offscreen.createDocument', { parameters: parameters || {} });
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            closeDocument: (cb) => {
                const p = _call('offscreen.closeDocument', {});
                if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
                return p;
            },
            hasDocument: (cb) => {
                const p = _call('offscreen.hasDocument', {});
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb(false));
                return p;
            },
        };
    }

    // 24. chrome.omnibox
    if (!self.chrome.omnibox) {
        self.chrome.omnibox = {
            setDefaultSuggestion: (suggestion) => _call('omnibox.setDefaultSuggestion', { suggestion }),
            onInputStarted: _createEventTarget('chrome.omnibox.onInputStarted'),
            onInputChanged: _createEventTarget('chrome.omnibox.onInputChanged'),
            onInputEntered: _createEventTarget('chrome.omnibox.onInputEntered'),
            onInputCancelled: _createEventTarget('chrome.omnibox.onInputCancelled'),
        };
    }

    // 25. chrome.tabCapture
    if (!self.chrome.tabCapture) {
        self.chrome.tabCapture = {
            capture: (options, callback) => {
                const p = _call('tabCapture.capture', { options: options || {} });
                if (typeof callback === 'function') p.then(stream => callback(stream)).catch(() => callback(null));
                return p;
            },
            getCapturedTabs: (callback) => {
                const p = _call('tabCapture.getCapturedTabs', {});
                if (typeof callback === 'function') p.then(tabs => callback(tabs)).catch(() => callback([]));
                return p;
            },
            onStatusChanged: _createEventTarget('chrome.tabCapture.onStatusChanged'),
        };
    }

    // 26. chrome.sessions
    if (!self.chrome.sessions) {
        self.chrome.sessions = {
            getRecentlyClosed: (filter, callback) => {
                let f = filter;
                let cb = callback;
                if (typeof filter === 'function') { cb = filter; f = {}; }
                const p = _call('sessions.getRecentlyClosed', { filter: f || {} });
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
            restore: (sessionId, callback) => {
                const p = _call('sessions.restore', { sessionId: sessionId || null });
                if (typeof callback === 'function') p.then(res => callback(res)).catch(() => callback(null));
                return p;
            },
            setTabValue: (tabId, key, value, callback) => {
                const p = _call('sessions.setTabValue', { tabId: Number(tabId), key: String(key), value });
                if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
                return p;
            },
            getTabValue: (tabId, key, callback) => {
                const p = _call('sessions.getTabValue', { tabId: Number(tabId), key: String(key) });
                if (typeof callback === 'function') p.then(val => callback(val)).catch(() => callback(undefined));
                return p;
            },
            setWindowValue: (windowId, key, value, callback) => {
                const p = _call('sessions.setWindowValue', { windowId: Number(windowId), key: String(key), value });
                if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
                return p;
            },
            getWindowValue: (windowId, key, callback) => {
                const p = _call('sessions.getWindowValue', { windowId: Number(windowId), key: String(key) });
                if (typeof callback === 'function') p.then(val => callback(val)).catch(() => callback(undefined));
                return p;
            },
            onChanged: _createEventTarget('chrome.sessions.onChanged'),
        };
    }

    // 27. chrome.proxy
    if (!self.chrome.proxy) {
        self.chrome.proxy = {
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
    if (!self.chrome.browsingData) {
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

        self.chrome.browsingData = {
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
    if (!self.chrome.idle) {
        self.chrome.idle = {
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
    if (!self.chrome.power) {
        self.chrome.power = {
            requestKeepAwake: (level) => {
                _call('power.requestKeepAwake', { level: level || 'system' }).catch(() => {});
            },
            releaseKeepAwake: () => {
                _call('power.releaseKeepAwake', {}).catch(() => {});
            },
        };
    }

    // Start persistent zero-CPU streaming event receiver
    _startEventStream();
})();
/* [End InviSurf Extension Runtime Polyfill] */
/**
 * Background Service Worker for Media Capture Tester Extension
 */

console.log('[MediaCaptureTest Background] Service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MediaCaptureTest Background] Installed successfully.');
});

// Listen to messages from popup if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[MediaCaptureTest Background] Message received:', request);

  if (request.type === 'GET_TAB_STREAM_ID') {
    if (chrome.tabCapture?.getMediaStreamId) {
      chrome.tabCapture.getMediaStreamId({ targetTabId: request.targetTabId }, (streamId) => {
        sendResponse({ streamId, error: chrome.runtime.lastError?.message });
      });
      return true; // Keep sendResponse channel open for async response
    } else {
      sendResponse({ error: 'chrome.tabCapture.getMediaStreamId not available' });
    }
  }

  if (request.type === 'PING') {
    sendResponse({ pong: true, time: Date.now() });
  }
});
