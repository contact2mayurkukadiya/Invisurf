const fs = require('fs');
const path = require('path');
const { getTabRegistry } = require('./TabRegistry');
const State = require('../../state');
const ExtensionStorage = require('../ExtensionStorage');

/**
 * ScriptingManager
 * Implements chrome.scripting for Manifest V3 extensions:
 * - executeScript
 * - insertCSS
 * - removeCSS
 */
class ScriptingManager {
    constructor() {
        /**
         * Tracks inserted CSS keys: Map<`${tabId}:${extensionId}`, Set<string>>
         */
        this.insertedCssKeys = new Map();
    }

    /**
     * Resolves the target WebContents from target.tabId.
     */
    _getTargetWebContents(target) {
        const tabRegistry = getTabRegistry();
        let tabId = target?.tabId;
        if (!tabId || Number(tabId) <= 0) {
            const active = tabRegistry.getActiveTab();
            tabId = active?.id;
        }

        const resolved = tabRegistry.resolveTab(tabId);
        if (!resolved?.webContents || resolved.webContents.isDestroyed()) {
            throw new Error(`No tab with id: ${tabId}`);
        }
        return { tabId, webContents: resolved.webContents };
    }

    /**
     * chrome.scripting.executeScript(injection)
     */
    async executeScript(extensionId, extensionPath, injection = {}) {
        const { target, files, func, args = [] } = injection;
        const { tabId, webContents: wc } = this._getTargetWebContents(target);

        const results = [];

        // Helper to resolve all target frames for execution
        const getTargetFrames = () => {
            const main = wc.mainFrame;
            if (!main) return [{ frameId: 0, frame: wc }];
            const framesInSubtree = main.framesInSubtree || [main];
            const list = [];
            let nextId = 1;
            const frameMap = new Map();
            frameMap.set(main, 0);
            for (const f of framesInSubtree) {
                if (f !== main) frameMap.set(f, f.routingId || nextId++);
            }

            if (target?.allFrames) {
                for (const f of framesInSubtree) {
                    list.push({ frameId: frameMap.get(f) ?? 0, frame: f });
                }
            } else if (Array.isArray(target?.frameIds) && target.frameIds.length > 0) {
                const reqIds = target.frameIds.map(Number);
                for (const f of framesInSubtree) {
                    const id = frameMap.get(f) ?? 0;
                    if (reqIds.includes(id)) {
                        list.push({ frameId: id, frame: f });
                    }
                }
                if (list.length === 0) list.push({ frameId: 0, frame: main });
            } else {
                list.push({ frameId: 0, frame: main });
            }
            return list;
        };

        const targetFrames = getTargetFrames();

        // 1. If files specified
        if (Array.isArray(files) && files.length > 0) {
            let resolvedExtPath = extensionPath;
            if (!resolvedExtPath) {
                const ext = ExtensionStorage.findExtension(extensionId);
                resolvedExtPath = ext?.path || null;
            }

            for (const file of files) {
                let code = '';
                const cleanFile = String(file || '').replace(/^\/+/, '');
                if (resolvedExtPath) {
                    const fullPath = path.join(resolvedExtPath, cleanFile);
                    if (fs.existsSync(fullPath)) {
                        code = fs.readFileSync(fullPath, 'utf-8');
                    }
                }

                if (code) {
                    const wrappedCode = this.buildContentScriptWrapper(extensionId, tabId, code, cleanFile, true);
                    for (const tf of targetFrames) {
                        try {
                            const execFn = typeof tf.frame?.executeJavaScript === 'function'
                                ? tf.frame.executeJavaScript.bind(tf.frame)
                                : wc.executeJavaScript.bind(wc);
                            const result = await execFn(wrappedCode);
                            results.push({ frameId: tf.frameId, result });
                        } catch (err) {
                            console.warn(`[ScriptingManager] Failed to execute ${file} in frame ${tf.frameId}:`, err?.message || err);
                            results.push({ frameId: tf.frameId, error: String(err?.message || err) });
                        }
                    }
                }
            }
            return results;
        }

        // 2. If function specified
        if (func) {
            let funcStr = '';
            if (typeof func === 'function') {
                funcStr = func.toString();
            } else if (typeof func === 'string') {
                funcStr = func;
            }

            const cleanExtId = String(extensionId || '').trim().toLowerCase();
            const code = `
                (() => {
                    try {
                        const EXT_ID = ${JSON.stringify(cleanExtId)};
                        if (!window.chrome) window.chrome = {};
                        if (!window.chrome.runtime) window.chrome.runtime = {};
                        if (!window.chrome.runtime.sendMessage) {
                            window.chrome.runtime.id = EXT_ID;
                            window.chrome.runtime.getURL = (p) => 'chrome-extension://' + EXT_ID + '/' + (p ? String(p).replace(/^\\//, '') : '');
                            window.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts) => {
                                let targetId = EXT_ID;
                                let message = extIdOrMsg;
                                if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
                                    targetId = extIdOrMsg;
                                    message = msgOrOpts;
                                }
                                return fetch('invisurf-ext://api/call', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ method: 'runtime.sendMessage', args: { targetExtId: targetId, message }, extensionId: EXT_ID })
                                }).then(r => r.json()).then(d => d && d.ok ? d.result : null).catch(() => null);
                            };
                        }
                        const targetFn = (${funcStr});
                        return targetFn(...${JSON.stringify(args || [])});
                    } catch (e) {
                        return { __error: e.message || String(e) };
                    }
                })();
            `;

            for (const tf of targetFrames) {
                try {
                    const execFn = typeof tf.frame?.executeJavaScript === 'function'
                        ? tf.frame.executeJavaScript.bind(tf.frame)
                        : wc.executeJavaScript.bind(wc);
                    const result = await execFn(code);
                    if (result && result.__error) {
                        throw new Error(result.__error);
                    }
                    results.push({ frameId: tf.frameId, result });
                } catch (err) {
                    throw new Error(`Script execution failed in frame ${tf.frameId}: ${err?.message || err}`);
                }
            }
            return results;
        }

        return [{ frameId: 0, result: null }];
    }

    /**
     * chrome.scripting.insertCSS(injection)
     */
    async insertCSS(extensionId, extensionPath, injection = {}) {
        const { target, css, files } = injection;
        const { tabId, webContents: wc } = this._getTargetWebContents(target);

        let cssContent = css || '';

        if (Array.isArray(files) && files.length > 0 && extensionPath) {
            for (const file of files) {
                const fullPath = path.join(extensionPath, file);
                if (fs.existsSync(fullPath)) {
                    cssContent += '\n' + fs.readFileSync(fullPath, 'utf-8');
                }
            }
        }

        if (!cssContent) return;

        try {
            const key = await wc.insertCSS(cssContent);
            const trackKey = `${tabId}:${extensionId}`;
            if (!this.insertedCssKeys.has(trackKey)) {
                this.insertedCssKeys.set(trackKey, new Set());
            }
            this.insertedCssKeys.get(trackKey).add(key);
            return key;
        } catch (err) {
            console.warn('[ScriptingManager] insertCSS failed:', err?.message || err);
        }
    }

    /**
     * chrome.scripting.removeCSS(injection)
     */
    async removeCSS(extensionId, extensionPath, injection = {}) {
        const { target, key } = injection;
        const { tabId, webContents: wc } = this._getTargetWebContents(target);

        const trackKey = `${tabId}:${extensionId}`;
        const keys = this.insertedCssKeys.get(trackKey);

        if (key) {
            try {
                await wc.removeInsertedCSS(key);
                if (keys) keys.delete(key);
            } catch (_) {}
        } else if (keys && keys.size > 0) {
            for (const k of keys) {
                try {
                    await wc.removeInsertedCSS(k);
                } catch (_) {}
            }
            keys.clear();
        }
    }

    _getRegisteredScriptsPath(profileId = null) {
        try {
            const pId = ExtensionStorage.safeProfileId(profileId || State.defaultProfileId);
            const dir = ExtensionStorage.getProfileExtensionsDir(pId);
            return path.join(dir, 'registered_content_scripts.json');
        } catch (_) {
            return null;
        }
    }

    _loadRegisteredScripts(profileId = null) {
        if (!this.registeredScripts) this.registeredScripts = new Map();
        try {
            const filePath = this._getRegisteredScriptsPath(profileId);
            if (filePath && fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (data && typeof data === 'object') {
                    for (const [extId, scriptsArray] of Object.entries(data)) {
                        if (!this.registeredScripts.has(extId)) {
                            this.registeredScripts.set(extId, new Map());
                        }
                        const extMap = this.registeredScripts.get(extId);
                        if (Array.isArray(scriptsArray)) {
                            for (const s of scriptsArray) {
                                if (s && s.id && !extMap.has(s.id)) {
                                    extMap.set(s.id, s);
                                }
                            }
                        }
                    }
                }
            }
        } catch (_) {}
    }

    _saveRegisteredScripts(profileId = null) {
        try {
            const filePath = this._getRegisteredScriptsPath(profileId);
            if (!filePath) return;
            const obj = {};
            if (this.registeredScripts) {
                for (const [extId, extMap] of this.registeredScripts.entries()) {
                    obj[extId] = Array.from(extMap.values());
                }
            }
            fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
        } catch (_) {}
    }

    /**
     * chrome.scripting.registerContentScripts(scripts)
     */
    registerContentScripts(extensionId, extensionPath, scripts = []) {
        if (!Array.isArray(scripts)) return;
        if (!this.registeredScripts) this.registeredScripts = new Map();
        if (!this.registeredScripts.has(extensionId)) {
            this.registeredScripts.set(extensionId, new Map());
        }
        const extScripts = this.registeredScripts.get(extensionId);

        let resolvedExtPath = extensionPath;
        if (!resolvedExtPath) {
            const extState = ExtensionStorage.readState(State.defaultProfileId);
            resolvedExtPath = extState[extensionId]?.path || Object.values(extState).find(e => e?.id === extensionId || e?.runtimeId === extensionId)?.path;
        }

        for (const s of scripts) {
            if (!s || !s.id) continue;
            extScripts.set(s.id, {
                ...s,
                extensionPath: resolvedExtPath,
            });
        }
        this._saveRegisteredScripts();
    }

    /**
     * chrome.scripting.getRegisteredContentScripts(filter)
     */
    getRegisteredContentScripts(extensionId, filter = {}) {
        this._loadRegisteredScripts();
        if (!this.registeredScripts || !this.registeredScripts.has(extensionId)) return [];
        const extScripts = this.registeredScripts.get(extensionId);
        let list = Array.from(extScripts.values());
        if (Array.isArray(filter?.ids) && filter.ids.length > 0) {
            const idSet = new Set(filter.ids);
            list = list.filter(s => idSet.has(s.id));
        }
        return list.map(({ extensionPath, ...rest }) => rest);
    }

    /**
     * chrome.scripting.unregisterContentScripts(filter)
     */
    unregisterContentScripts(extensionId, filter = {}) {
        if (!this.registeredScripts || !this.registeredScripts.has(extensionId)) return;
        const extScripts = this.registeredScripts.get(extensionId);
        if (Array.isArray(filter?.ids) && filter.ids.length > 0) {
            for (const id of filter.ids) {
                extScripts.delete(id);
            }
        } else {
            extScripts.clear();
        }
        this._saveRegisteredScripts();
    }

    /**
     * chrome.scripting.updateContentScripts(scripts)
     */
    updateContentScripts(extensionId, extensionPath, scripts = []) {
        this.registerContentScripts(extensionId, extensionPath, scripts);
    }

    /**
     * Retrieves scripts that must be executed at document_start in the MAIN or ISOLATED world (e.g. React DevTools hook).
     * @param {string} url The page URL being navigated to
     * @param {string} [profileId] Profile ID
     * @returns {Array<{ id: string, world: string, code: string, extensionId: string }>}
     */
    /**
     * Builds a robust compatibility wrapper around an isolated/content script.
     * Implements bidirectional chrome.runtime messaging, port lifecycle, and event delivery.
     */
    buildContentScriptWrapper(extId, tabId, codeContent, scriptKey = '', isDynamic = false) {
        const cleanExtId = String(extId || '').trim().toLowerCase();
        const numericTabId = Number(tabId) || 0;
        const safeKey = String(scriptKey || 'script').replace(/[^a-zA-Z0-9_]/g, '_');

        return `
            (() => {
                try {
                    const EXT_ID = ${JSON.stringify(cleanExtId)};
                    const TAB_ID = ${JSON.stringify(numericTabId)};
                    const IS_DYNAMIC = ${JSON.stringify(Boolean(isDynamic))};
                    const guardKey = '__invisurf_injected_' + EXT_ID.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + ${JSON.stringify(safeKey)};
                    if (!IS_DYNAMIC && window[guardKey]) return;
                    window[guardKey] = true;

                    // Initialize multi-extension registries on window
                    if (!window.__invisurf_ext_listeners) window.__invisurf_ext_listeners = {};
                    if (!window.__invisurf_ext_listeners[EXT_ID]) window.__invisurf_ext_listeners[EXT_ID] = [];
                    window.__invisurf_last_ext_id = EXT_ID;

                    // Isolated listeners list for this extension instance
                    const _extListeners = [];

                    const _sendMessage = (extIdOrMsg, msgOrOpts, optsOrCallback, maybeCb) => {
                        let targetId = EXT_ID;
                        let message = extIdOrMsg;
                        let cb = null;
                        if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
                            targetId = extIdOrMsg;
                            message = msgOrOpts;
                            if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                            else if (typeof maybeCb === 'function') cb = maybeCb;
                        } else {
                            if (typeof msgOrOpts === 'function') cb = msgOrOpts;
                            else if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                        }

                        if (typeof chrome !== 'undefined' && chrome?.runtime) chrome.runtime.lastError = null;
                        if (window.chrome?.runtime) window.chrome.runtime.lastError = null;

                        const p = fetch('invisurf-ext://api/call', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                method: 'runtime.sendMessage',
                                args: { targetExtId: targetId, message, tabId: TAB_ID },
                                extensionId: EXT_ID,
                                tabId: TAB_ID
                            })
                        }).then(r => r.json()).then(d => d && d.ok ? d.result : null).catch(() => null);

                        if (typeof cb === 'function') {
                            p.then(res => {
                                if (typeof chrome !== 'undefined' && chrome?.runtime) chrome.runtime.lastError = null;
                                if (window.chrome?.runtime) window.chrome.runtime.lastError = null;
                                try { cb(res); } catch (_) {}
                            });
                        }
                        return p;
                    };

                    const _onMessage = {
                        addListener: (fn) => {
                            if (typeof fn === 'function') {
                                if (!_extListeners.includes(fn)) _extListeners.push(fn);
                                if (!window.__invisurf_ext_listeners[EXT_ID].includes(fn)) {
                                    window.__invisurf_ext_listeners[EXT_ID].push(fn);
                                }
                                if (window.chrome?.runtime?.onMessage?._listeners && !window.chrome.runtime.onMessage._listeners.includes(fn)) {
                                    window.chrome.runtime.onMessage._listeners.push(fn);
                                }
                            }
                        },
                        removeListener: (fn) => {
                            const idx = _extListeners.indexOf(fn);
                            if (idx !== -1) _extListeners.splice(idx, 1);
                            const winIdx = window.__invisurf_ext_listeners[EXT_ID].indexOf(fn);
                            if (winIdx !== -1) window.__invisurf_ext_listeners[EXT_ID].splice(winIdx, 1);
                            if (window.chrome?.runtime?.onMessage?._listeners) {
                                const gIdx = window.chrome.runtime.onMessage._listeners.indexOf(fn);
                                if (gIdx !== -1) window.chrome.runtime.onMessage._listeners.splice(gIdx, 1);
                            }
                        },
                        hasListener: (fn) => _extListeners.includes(fn),
                        _listeners: _extListeners,
                    };

                    window.addEventListener('message', (ev) => {
                        if (ev.source === window && ev.data && ev.data.source === 'invisurf-ext-event') {
                            const payload = ev.data.payload;
                            if (payload && payload.eventName === 'chrome.runtime.onMessage') {
                                const targetExt = payload.targetExtId || payload.extensionId || (payload.args && payload.args[1] && payload.args[1].id);
                                if (targetExt && String(targetExt).toLowerCase() !== EXT_ID) {
                                    return;
                                }
                                const args = payload.args || [];
                                const callbackId = payload.callbackId || null;
                                let responded = false;
                                let asyncWait = false;
                                const sendResponse = (response) => {
                                    if (responded) return;
                                    responded = true;
                                    if (callbackId) {
                                        window.postMessage({
                                            source: 'invisurf-ext-response',
                                            callbackId,
                                            response
                                        }, '*');
                                    }
                                };
                                for (const fn of _extListeners.slice()) {
                                    try {
                                        const r = fn(args[0], args[1], sendResponse);
                                        if (r === true) {
                                            asyncWait = true;
                                        } else if (r && typeof r.then === 'function') {
                                            asyncWait = true;
                                            r.then(sendResponse).catch(() => sendResponse(undefined));
                                        }
                                    } catch (e) {
                                        console.error(e);
                                    }
                                }
                                if (!asyncWait && !responded && callbackId) {
                                    setTimeout(() => {
                                        if (!responded) sendResponse(undefined);
                                    }, 20);
                                }
                            }
                        }
                    });

                    const _connect = (connectOpts = {}) => {
                        const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
                        const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                        const _msgListeners = [];
                        const _discListeners = [];
                        let _disconnected = false;

                        fetch('invisurf-ext://api/call', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                method: 'runtime.connect',
                                args: { portId, name: portName, targetExtId: EXT_ID, tabId: TAB_ID },
                                extensionId: EXT_ID,
                                tabId: TAB_ID
                            })
                        }).catch(() => {});

                        const _handlePortEvent = (ev) => {
                            if (ev.source === window && ev.data && ev.data.source === 'invisurf-ext-event') {
                                const payload = ev.data.payload;
                                if (!payload) return;
                                if (payload.eventName === ('chrome.runtime.portOnMessage_' + portId)) {
                                    const msgArg = payload.args && payload.args.length > 0 ? payload.args[0] : undefined;
                                    for (const fn of _msgListeners.slice()) {
                                        try { fn(msgArg); } catch (e) { console.error(e); }
                                    }
                                } else if (payload.eventName === ('chrome.runtime.portOnDisconnect_' + portId)) {
                                    _disconnected = true;
                                    window.removeEventListener('message', _handlePortEvent);
                                    for (const fn of _discListeners.slice()) {
                                        try { fn(); } catch (e) { console.error(e); }
                                    }
                                }
                            }
                        };
                        window.addEventListener('message', _handlePortEvent);

                        return {
                            name: portName,
                            postMessage: (message) => {
                                if (_disconnected) return;
                                fetch('invisurf-ext://api/call', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        method: 'runtime.portPostMessage',
                                        args: { portId, message, targetExtId: EXT_ID, tabId: TAB_ID },
                                        extensionId: EXT_ID,
                                        tabId: TAB_ID
                                    })
                                }).catch(() => {});
                            },
                            disconnect: () => {
                                if (_disconnected) return;
                                _disconnected = true;
                                window.removeEventListener('message', _handlePortEvent);
                                fetch('invisurf-ext://api/call', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        method: 'runtime.portDisconnect',
                                        args: { portId, targetExtId: EXT_ID, tabId: TAB_ID },
                                        extensionId: EXT_ID,
                                        tabId: TAB_ID
                                    })
                                }).catch(() => {});
                                for (const fn of _discListeners.slice()) {
                                    try { fn(); } catch (_) {}
                                }
                            },
                            onMessage: {
                                addListener: (fn) => { if (typeof fn === 'function' && !_msgListeners.includes(fn)) _msgListeners.push(fn); },
                                removeListener: (fn) => { const i = _msgListeners.indexOf(fn); if (i !== -1) _msgListeners.splice(i, 1); },
                                hasListener: (fn) => _msgListeners.includes(fn),
                            },
                            onDisconnect: {
                                addListener: (fn) => { if (typeof fn === 'function' && !_discListeners.includes(fn)) _discListeners.push(fn); },
                                removeListener: (fn) => { const i = _discListeners.indexOf(fn); if (i !== -1) _discListeners.splice(i, 1); },
                                hasListener: (fn) => _discListeners.includes(fn),
                            },
                        };
                    };

                    const _storageArea = (areaName) => ({
                        get: (keys, cb) => {
                            let callback = cb;
                            let queryKeys = keys;
                            if (typeof keys === 'function') {
                                callback = keys;
                                queryKeys = null;
                            }
                            const p = fetch('invisurf-ext://api/call', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    method: 'storage.' + areaName + '.get',
                                    args: { keys: queryKeys },
                                    extensionId: EXT_ID,
                                    tabId: TAB_ID
                                })
                            }).then(r => r.json()).then(d => d && d.ok ? (d.result || {}) : {}).catch(() => ({}));
                            if (typeof callback === 'function') {
                                p.then(res => { try { callback(res); } catch (_) {} });
                            }
                            return p;
                        },
                        set: (items, cb) => {
                            const p = fetch('invisurf-ext://api/call', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    method: 'storage.' + areaName + '.set',
                                    args: { items },
                                    extensionId: EXT_ID,
                                    tabId: TAB_ID
                                })
                            }).then(r => r.json()).then(d => d && d.ok ? d.result : null).catch(() => null);
                            if (typeof cb === 'function') {
                                p.then(res => { try { cb(res); } catch (_) {} });
                            }
                            return p;
                        },
                    });

                    const _storage = {
                        local: _storageArea('local'),
                        sync: _storageArea('sync'),
                        session: _storageArea('session'),
                    };

                    const _runtime = {
                        id: EXT_ID,
                        lastError: null,
                        getURL: (p) => 'chrome-extension://' + EXT_ID + '/' + (p ? String(p).replace(/^\\//, '') : ''),
                        sendMessage: _sendMessage,
                        onMessage: _onMessage,
                        connect: _connect,
                    };

                    // Lexical declarations that shadow window.chrome for scripts inside this wrapper
                    var chrome = {
                        runtime: _runtime,
                        storage: _storage,
                    };
                    var browser = chrome;

                    // Ensure window.chrome fallback exists and routes safely
                    if (!window.chrome) window.chrome = {};
                    if (!window.chrome.runtime) window.chrome.runtime = {};
                    if (!window.chrome.storage) window.chrome.storage = _storage;
                    if (!window.chrome.runtime.onMessage) {
                        const _globalListeners = [];
                        window.chrome.runtime.onMessage = {
                            addListener: (fn) => { if (typeof fn === 'function' && !_globalListeners.includes(fn)) _globalListeners.push(fn); },
                            removeListener: (fn) => { const idx = _globalListeners.indexOf(fn); if (idx !== -1) _globalListeners.splice(idx, 1); },
                            hasListener: (fn) => _globalListeners.includes(fn),
                            _listeners: _globalListeners,
                        };
                    }
                    window.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts, optsOrCallback, maybeCb) => {
                        let targetId = null;
                        let message = extIdOrMsg;
                        let cb = null;
                        if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
                            targetId = extIdOrMsg;
                            message = msgOrOpts;
                            if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                            else if (typeof maybeCb === 'function') cb = maybeCb;
                        } else {
                            if (typeof msgOrOpts === 'function') cb = msgOrOpts;
                            else if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                        }
                        let callerExtId = EXT_ID;
                        try {
                            const stack = (new Error()).stack || '';
                            const match = stack.match(/chrome-extension:\\/\\/([a-z0-9_-]+)/i) || stack.match(/__invisurf_injected_([a-z0-9_-]+)_/i);
                            if (match && match[1]) callerExtId = match[1];
                        } catch (_) {}
                        if (!targetId) targetId = callerExtId;

                        if (window.chrome?.runtime) window.chrome.runtime.lastError = null;

                        const p = fetch('invisurf-ext://api/call', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                method: 'runtime.sendMessage',
                                args: { targetExtId: targetId, message, tabId: TAB_ID },
                                extensionId: callerExtId,
                                tabId: TAB_ID
                            })
                        }).then(r => r.json()).then(d => d && d.ok ? d.result : null).catch(() => null);

                        if (typeof cb === 'function') {
                            p.then(res => {
                                if (window.chrome?.runtime) window.chrome.runtime.lastError = null;
                                try { cb(res); } catch (_) {}
                            });
                        }
                        return p;
                    };
                    if (!window.chrome.runtime.connect) {
                        window.chrome.runtime.connect = _connect;
                    }

                    ${codeContent}
                } catch (err) {
                    console.warn('[ScriptingManager ContentScript Error]:', err);
                }
            })();
        `;
    }

    /**
     * Retrieves scripts that must be executed at document_start in the MAIN or ISOLATED world (e.g. React DevTools hook).
     * @param {string} url The page URL being navigated to
     * @param {string} [profileId] Profile ID
     * @param {number|string} [tabId] WebContents/Tab ID
     * @returns {Array<{ id: string, world: string, code: string, extensionId: string }>}
     */
    getDocumentStartScripts(url, profileId = null, tabId = 0) {
        // Only ignore internal browser UI pages (invisurf://, app://, devtools), but allow web URLs and initial/about:blank navigation
        if (url && (url.startsWith('invisurf://') || url.startsWith('chrome://') || url.startsWith('app://') || url.startsWith('chrome-devtools://')) && !url.includes('chromewebstore')) {
            return [];
        }
        const results = [];
        const seenScriptKeys = new Set();

        const pId = ExtensionStorage.safeProfileId(profileId || State.defaultProfileId);
        const state = ExtensionStorage.readState(pId);
        this._loadRegisteredScripts(pId);

        if (!this._scriptCodeCache) {
            this._scriptCodeCache = new Map();
        }

        const readCachedCode = (filePath) => {
            if (!this._scriptCodeCache.has(filePath)) {
                try {
                    this._scriptCodeCache.set(filePath, fs.readFileSync(filePath, 'utf-8'));
                } catch (_) {
                    return null;
                }
            }
            return this._scriptCodeCache.get(filePath);
        };

        // 1. Proactive auto-detection of React DevTools in all enabled extensions
        for (const [extId, extData] of Object.entries(state)) {
            if (!extData.enabled || !extData.path || !fs.existsSync(extData.path)) continue;

            const hookPath = path.join(extData.path, 'build', 'installHook.js');
            if (fs.existsSync(hookPath)) {
                const reactScripts = [
                    { id: '@react-devtools/hook', file: 'build/installHook.js', world: 'MAIN', wrap: false },
                    { id: '@react-devtools/fallback-eval-context', file: 'build/fallbackEvalContext.js', world: 'MAIN', wrap: false },
                    { id: '@react-devtools/hook-settings-injector', file: 'build/hookSettingsInjector.js', world: 'ISOLATED', wrap: true },
                    { id: '@react-devtools/proxy', file: 'build/proxy.js', world: 'ISOLATED', wrap: true },
                    { id: 'manifest:build/prepareInjection.js', file: 'build/prepareInjection.js', world: 'ISOLATED', wrap: true },
                ];

                for (const item of reactScripts) {
                    const fullPath = path.join(extData.path, item.file);
                    const scriptKey = `${extId}:${item.file}`;
                    if (!seenScriptKeys.has(scriptKey) && fs.existsSync(fullPath)) {
                        seenScriptKeys.add(scriptKey);
                        const rawCode = readCachedCode(fullPath);
                        if (rawCode) {
                            const code = item.wrap
                                ? this.buildContentScriptWrapper(extId, tabId, rawCode, item.file)
                                : rawCode;
                            results.push({
                                id: item.id,
                                world: item.world,
                                code,
                                extensionId: extId,
                            });
                        }
                    }
                }
            }
        }

        // 2. Check dynamically registered content scripts for runAt: 'document_start'
        if (this.registeredScripts) {
            for (const [extId, scriptsMap] of this.registeredScripts.entries()) {
                const extData = state[extId];
                if (extData && !extData.enabled) continue;

                for (const script of scriptsMap.values()) {
                    const scriptRunAt = script.runAt || 'document_idle';
                    if (scriptRunAt !== 'document_start') continue;

                    const matches = Array.isArray(script.matches) ? script.matches : [];
                    const isMatch = matches.some(m => {
                        if (m === '<all_urls>') return true;
                        if (!url || url === 'about:blank') return true;
                        const rx = new RegExp('^' + m.replace(/\*/g, '.*') + '$');
                        return rx.test(url);
                    });

                    if (isMatch && Array.isArray(script.js) && script.extensionPath) {
                        for (const relJs of script.js) {
                            const cleanJs = String(relJs || '').replace(/^\/+/, '');
                            const key = `${extId}:${cleanJs}`;
                            if (seenScriptKeys.has(key)) continue;
                            seenScriptKeys.add(key);

                            const fullJs = path.join(script.extensionPath, cleanJs);
                            if (fs.existsSync(fullJs)) {
                                const rawCode = readCachedCode(fullJs);
                                if (rawCode) {
                                    const isMainWorld = script.world === 'MAIN';
                                    const code = isMainWorld
                                        ? rawCode
                                        : this.buildContentScriptWrapper(extId, tabId, rawCode, cleanJs);
                                    results.push({
                                        id: script.id,
                                        world: isMainWorld ? 'MAIN' : 'ISOLATED',
                                        code,
                                        extensionId: extId,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. Check manifest content_scripts for run_at: 'document_start' (e.g. prepareInjection.js)
        for (const [extId, extData] of Object.entries(state)) {
            if (!extData.enabled || !extData.path || !fs.existsSync(extData.path)) continue;
            const manifestPath = path.join(extData.path, 'manifest.json');
            if (!fs.existsSync(manifestPath)) continue;
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                if (Array.isArray(manifest.content_scripts)) {
                    for (const cs of manifest.content_scripts) {
                        const scriptRunAt = cs.run_at || 'document_idle';
                        if (scriptRunAt !== 'document_start') continue;

                        const matches = Array.isArray(cs.matches) ? cs.matches : [];
                        const isMatch = matches.some(m => {
                            if (m === '<all_urls>') return true;
                            if (!url || url === 'about:blank') return true;
                            const rx = new RegExp('^' + m.replace(/\*/g, '.*') + '$');
                            return rx.test(url);
                        });

                        if (isMatch && Array.isArray(cs.js)) {
                            for (const relJs of cs.js) {
                                const cleanJs = String(relJs || '').replace(/^\/+/, '');
                                const key = `${extId}:${cleanJs}`;
                                if (seenScriptKeys.has(key)) continue;
                                seenScriptKeys.add(key);

                                const fullJs = path.join(extData.path, cleanJs);
                                if (fs.existsSync(fullJs)) {
                                    const rawCode = readCachedCode(fullJs);
                                    if (rawCode) {
                                        const isMainWorld = cs.world === 'MAIN';
                                        const code = isMainWorld
                                            ? rawCode
                                            : this.buildContentScriptWrapper(extId, tabId, rawCode, cleanJs);
                                        results.push({
                                            id: `manifest:${cleanJs}`,
                                            world: isMainWorld ? 'MAIN' : 'ISOLATED',
                                            code,
                                            extensionId: extId,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (_) {}
        }

        return results;
    }

    /**
     * Injects matching registered content scripts when a tab loads or updates URL.
     * Supports runAtTarget filtering ('document_start', 'document_end', 'document_idle').
     */
    async injectMatchingScripts(tabId, url, webContents, runAtTarget = null) {
        if (!this.registeredScripts || !url || !webContents || webContents.isDestroyed()) return;

        for (const [extId, scriptsMap] of this.registeredScripts.entries()) {
            for (const script of scriptsMap.values()) {
                const scriptRunAt = script.runAt || 'document_idle';
                if (runAtTarget === 'document_start' && scriptRunAt !== 'document_start') continue;
                if (runAtTarget === 'document_idle' && scriptRunAt === 'document_start') continue;

                const matches = Array.isArray(script.matches) ? script.matches : [];
                const isMatch = matches.some(m => {
                    if (m === '<all_urls>') return url.startsWith('http://') || url.startsWith('https://');
                    const rx = new RegExp('^' + m.replace(/\*/g, '.*') + '$');
                    return rx.test(url);
                });

                if (isMatch) {
                    // Inject CSS
                    if (Array.isArray(script.css)) {
                        for (const relCss of script.css) {
                            const fullCss = path.join(script.extensionPath, relCss);
                            if (fs.existsSync(fullCss)) {
                                try {
                                    await webContents.insertCSS(fs.readFileSync(fullCss, 'utf-8'));
                                } catch (_) {}
                            }
                        }
                    }
                    // Inject JS
                    if (Array.isArray(script.js)) {
                        for (const relJs of script.js) {
                            const cleanJs = String(relJs || '').replace(/^\/+/, '');
                            const fullJs = path.join(script.extensionPath, cleanJs);
                            if (fs.existsSync(fullJs)) {
                                try {
                                    const codeContent = fs.readFileSync(fullJs, 'utf-8');
                                    // If MAIN world (e.g. React DevTools installHook.js), execute directly in main world
                                    if (script.world === 'MAIN') {
                                        await webContents.executeJavaScript(codeContent);
                                    } else {
                                        const wrapper = this.buildContentScriptWrapper(extId, tabId, codeContent, cleanJs);
                                        await webContents.executeJavaScript(wrapper);
                                    }
                                } catch (_) {}
                            }
                        }
                    }
                }
            }
        }
    }
}

// Singleton
let instance = null;
function getScriptingManager() {
    if (!instance) {
        instance = new ScriptingManager();
    }
    return instance;
}

module.exports = {
    ScriptingManager,
    getScriptingManager,
};
