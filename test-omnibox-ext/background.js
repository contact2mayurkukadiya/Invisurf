/* [InviSurf Extension Runtime Polyfill] */
(() => {
    if (typeof self === 'undefined') return;
    if (self.__invisurf_compat_initialized) return;
    self.__invisurf_compat_initialized = true;

    const EXT_ID = "cdmbcenikiahgoeojenmcaolegjhdpfi";
    const EXT_MANIFEST = {"manifest_version":3,"name":"Omnibox Test Extension","version":"1.0","omnibox":{"keyword":"test"},"background":{"service_worker":"background.js"}};
    const EXT_MESSAGES = {};

    self.__invisurf_manifest = EXT_MANIFEST;
    self.__invisurf_messages = EXT_MESSAGES;

    // Event listeners registry
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
                console.warn('[InviSurf Polyfill Event Error]:', err);
            }
        }
    }

    // IPC caller via invisurf-ext://
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

    // Long-poll event receiver
    async function _startEventLoop() {
        while (true) {
            try {
                const res = await fetch('invisurf-ext://poll-events?extId=' + encodeURIComponent(EXT_ID));
                if (res.ok) {
                    const events = await res.json();
                    if (Array.isArray(events)) {
                        for (const ev of events) {
                            if (ev && ev.eventName) {
                                if (ev.eventName === 'chrome.runtime.onConnect') {
                                    const info = (ev.args && ev.args[0]) || {};
                                    const port = _createPortObject(info.portId, info.name, info.sender);
                                    _dispatchEvent('chrome.runtime.onConnect', [port]);
                                } else {
                                    _dispatchEvent(ev.eventName, ev.args || []);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Wait briefly before retrying if fetch failed
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // Initialize chrome namespace
    if (!self.chrome) self.chrome = {};

    // 1. chrome.runtime
    if (!self.chrome.runtime) self.chrome.runtime = {};
    self.chrome.runtime.id = EXT_ID;
    self.chrome.runtime.getURL = (p) => 'chrome-extension://' + EXT_ID + '/' + String(p || '').replace(/^\//, '');
    self.chrome.runtime.getManifest = () => {
        try {
            return self.__invisurf_manifest || { name: EXT_ID, version: '1.0.0', manifest_version: 3 };
        } catch (_) {
            return { name: EXT_ID, version: '1.0.0', manifest_version: 3 };
        }
    };
    self.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts, opts) => {
        let targetId = EXT_ID;
        let message = extIdOrMsg;
        if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
            targetId = extIdOrMsg;
            message = msgOrOpts;
        }
        return _call('runtime.sendMessage', { targetExtId: targetId, message });
    };
    self.chrome.runtime.onMessage = _createEventTarget('chrome.runtime.onMessage');
    self.chrome.runtime.onInstalled = _createEventTarget('chrome.runtime.onInstalled');
    self.chrome.runtime.onStartup = _createEventTarget('chrome.runtime.onStartup');
    self.chrome.runtime.connect = (connectOpts = {}) => {
        const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
        const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        _call('runtime.connect', { portId, name: portName, targetExtId: EXT_ID }).catch(() => {});
        return _createPortObject(portId, portName, { id: EXT_ID });
    };
    self.chrome.runtime.onConnect = _createEventTarget('chrome.runtime.onConnect');
    self.chrome.runtime.openOptionsPage = (cb) => {
        const p = _call('runtime.openOptionsPage', {});
        if (typeof cb === 'function') p.then(() => cb()).catch(() => cb());
        return p;
    };
    self.chrome.runtime.setUninstallURL = (url, cb) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
    };
    self.chrome.runtime.reload = () => _call('runtime.reload', {});
    self.chrome.runtime.getPlatformInfo = (cb) => {
        const p = _call('runtime.getPlatformInfo');
        if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb({ os: 'mac', arch: 'arm64', nacl_arch: 'arm64' }));
        return p;
    };
    self.chrome.runtime.onInstalled = _createEventTarget('chrome.runtime.onInstalled');
    self.chrome.runtime.onStartup = _createEventTarget('chrome.runtime.onStartup');
    self.chrome.runtime.onSuspend = _createEventTarget('chrome.runtime.onSuspend');
    self.chrome.runtime.onSuspendCanceled = _createEventTarget('chrome.runtime.onSuspendCanceled');
    self.chrome.runtime.getBackgroundPage = (cb) => { if (typeof cb === 'function') cb(null); return Promise.resolve(null); };
    self.chrome.runtime.getContexts = (filter, cb) => { if (typeof cb === 'function') cb([]); return Promise.resolve([]); };
    self.chrome.runtime.sendNativeMessage = (app, msg, cb) => { if (typeof cb === 'function') cb(null); return Promise.resolve(null); };

    // 1b. chrome.extension (Legacy MV2 namespace)
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

    self.chrome.storage = {
        local: _createStorageArea('local'),
        sync: _createStorageArea('sync'),
        session: _createStorageArea('session'),
        onChanged: _createEventTarget('chrome.storage.onChanged'),
    };

    // 3. chrome.tabs
    self.chrome.tabs = {
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
            const p = _call('tabs.create', { createProperties: props || {} });
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
            const p = _call('tabs.update', { tabId: tId, updateProperties: pProps || {} });
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
                p.then(res => callback(res)).catch(() => callback(undefined));
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
                    const mapped = Array.isArray(res) ? res.map(r => r?.result !== undefined ? r.result : r) : [];
                    callback(mapped);
                }).catch(() => callback([]));
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
            if (typeof callback === 'function') p.then(() => callback()).catch(() => callback());
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
            if (typeof cb === 'function') cb();
            return Promise.resolve();
        },
        onClicked: _createEventTarget('chrome.action.onClicked'),
    };

    self.chrome.action = _actionApi;
    self.chrome.browserAction = _actionApi;

    // 5. chrome.scripting
    self.chrome.scripting = {
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

    // 7. chrome.windows
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
            const p = _call('windows.create', { createData: createData || {} });
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

    // 9. chrome.contextMenus
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

    // 10. chrome.declarativeNetRequest
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

    // 11. chrome.notifications
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
    self.chrome.webNavigation = {
        onBeforeNavigate: _createEventTarget('chrome.webNavigation.onBeforeNavigate'),
        onCommitted: _createEventTarget('chrome.webNavigation.onCommitted'),
        onDOMContentLoaded: _createEventTarget('chrome.webNavigation.onDOMContentLoaded'),
        onCompleted: _createEventTarget('chrome.webNavigation.onCompleted'),
        onErrorOccurred: _createEventTarget('chrome.webNavigation.onErrorOccurred'),
    };

    if (!self.chrome.commands) {
        self.chrome.commands = {
            onCommand: _createEventTarget('chrome.commands.onCommand'),
            getAll: (cb) => {
                const p = _call('commands.getAll', {});
                if (typeof cb === 'function') p.then(res => cb(res)).catch(() => cb([]));
                return p;
            },
        };
    }

    // 13. chrome.i18n
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

    // 14. chrome.permissions
    self.chrome.permissions = {
        contains: (permissions, cb) => {
            const manifest = self.chrome.runtime.getManifest();
            const manifestPerms = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
            const reqPerms = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
            const hasAll = reqPerms.every(p => manifestPerms.includes(p));
            if (typeof cb === 'function') cb(hasAll);
            return Promise.resolve(hasAll);
        },
        getAll: (cb) => {
            const manifest = self.chrome.runtime.getManifest();
            const perms = {
                permissions: Array.isArray(manifest?.permissions) ? manifest.permissions : [],
                origins: Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : [],
            };
            if (typeof cb === 'function') cb(perms);
            return Promise.resolve(perms);
        },
        request: (permissions, cb) => {
            if (typeof cb === 'function') cb(true);
            return Promise.resolve(true);
        },
        remove: (permissions, cb) => {
            if (typeof cb === 'function') cb(true);
            return Promise.resolve(true);
        },
        onAdded: _createEventTarget('chrome.permissions.onAdded'),
        onRemoved: _createEventTarget('chrome.permissions.onRemoved'),
    };

    // 15. chrome.management
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

    // 16. chrome.downloads
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

    // 17. chrome.webRequest
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

    // 18. chrome.sidePanel (Manifest V3)
    self.chrome.sidePanel = {
        open: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        setOptions: (options, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        getOptions: (options, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
        setPanelBehavior: (behavior, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        getPanelBehavior: (cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
    };

    // 19. chrome.bookmarks
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

    // 20. chrome.history
    self.chrome.history = {
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

    // 21. chrome.identity
    self.chrome.identity = {
        getRedirectURL: (path) => {
            const cleanPath = path ? (String(path).startsWith('/') ? String(path).substring(1) : String(path)) : '';
            return 'https://' + EXT_ID + '.chromiumapp.org/' + cleanPath;
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
                return self.chrome.identity.launchWebAuthFlow(d, callback);
            }
            const p = Promise.resolve(null);
            if (typeof callback === 'function') callback(null);
            return p;
        },
        onSignInChanged: _createEventTarget('chrome.identity.onSignInChanged'),
    };

    // 22. chrome.offscreen (Manifest V3)
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

    // 23. chrome.omnibox
    const _omniboxChangedListeners = [];
    _createEventTarget('chrome.omnibox.onInputChanged').addListener((text, suggestCallbackId) => {
        const suggest = (suggestions) => {
            _call('omnibox.sendSuggestions', { suggestCallbackId, suggestions });
        };
        for (const fn of _omniboxChangedListeners) {
            try { fn(text, suggest); } catch (e) { console.warn('[Omnibox Listener Error]', e); }
        }
    });

    self.chrome.omnibox = {
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

    // Start background event poller
    _startEventLoop();
})();
/* [End InviSurf Extension Runtime Polyfill] */


































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































chrome.omnibox.setDefaultSuggestion({
    description: "Test search for: <match>%s</match>"
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    suggest([
        { content: "https://google.com/search?q=" + text, description: "Search Google for " + text },
        { content: "https://github.com/search?q=" + text, description: "Search GitHub for " + text }
    ]);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    let url = text;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.includes('.') && !url.includes(' ')) {
            url = 'https://' + url;
        } else {
            url = 'https://google.com/search?q=' + encodeURIComponent(url);
        }
    }
    if (disposition === 'currentTab') {
        chrome.tabs.update({ url });
    } else {
        chrome.tabs.create({ url });
    }
});
