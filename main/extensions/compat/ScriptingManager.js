const fs = require('fs');
const path = require('path');
const { getTabRegistry } = require('./TabRegistry');

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
        if (!tabId) {
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
        const { webContents: wc } = this._getTargetWebContents(target);

        const results = [];

        // 1. If files specified
        if (Array.isArray(files) && files.length > 0) {
            for (const file of files) {
                let code = '';
                if (extensionPath) {
                    const fullPath = path.join(extensionPath, file);
                    if (fs.existsSync(fullPath)) {
                        code = fs.readFileSync(fullPath, 'utf-8');
                    }
                }

                if (code) {
                    try {
                        const result = await wc.executeJavaScript(code);
                        results.push({ frameId: 0, result });
                    } catch (err) {
                        console.warn(`[ScriptingManager] Failed to execute ${file} in tab:`, err?.message || err);
                        results.push({ frameId: 0, error: String(err?.message || err) });
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

            try {
                const result = await wc.executeJavaScript(code);
                if (result && result.__error) {
                    throw new Error(result.__error);
                }
                return [{ frameId: 0, result }];
            } catch (err) {
                throw new Error(`Script execution failed: ${err?.message || err}`);
            }
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

        for (const s of scripts) {
            if (!s || !s.id) continue;
            extScripts.set(s.id, {
                ...s,
                extensionPath,
            });
        }
    }

    /**
     * chrome.scripting.getRegisteredContentScripts(filter)
     */
    getRegisteredContentScripts(extensionId, filter = {}) {
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
    }

    /**
     * chrome.scripting.updateContentScripts(scripts)
     */
    updateContentScripts(extensionId, extensionPath, scripts = []) {
        this.registerContentScripts(extensionId, extensionPath, scripts);
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
                            const fullJs = path.join(script.extensionPath, relJs);
                            if (fs.existsSync(fullJs)) {
                                try {
                                    const codeContent = fs.readFileSync(fullJs, 'utf-8');
                                    // If MAIN world (e.g. React DevTools installHook.js), execute directly in main world
                                    if (script.world === 'MAIN') {
                                        await webContents.executeJavaScript(codeContent);
                                    } else {
                                        // ISOLATED or default: wrap with chrome compatibility API shim
                                        const cleanExtId = String(extId || '').trim().toLowerCase();
                                        const wrapper = `
                                            (() => {
                                                try {
                                                    const EXT_ID = ${JSON.stringify(cleanExtId)};
                                                    if (!window.chrome) window.chrome = {};
                                                    if (!window.chrome.runtime) window.chrome.runtime = {};
                                                    window.chrome.runtime.id = EXT_ID;
                                                    window.chrome.runtime.getURL = (p) => 'chrome-extension://' + EXT_ID + '/' + (p ? String(p).replace(/^\\//, '') : '');
                                                    if (!window.chrome.runtime.sendMessage) {
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
                                                    if (!window.chrome.runtime.onMessage) {
                                                        const _listeners = [];
                                                        window.chrome.runtime.onMessage = {
                                                            addListener: (fn) => { if (typeof fn === 'function' && !_listeners.includes(fn)) _listeners.push(fn); },
                                                            removeListener: (fn) => { const idx = _listeners.indexOf(fn); if (idx !== -1) _listeners.splice(idx, 1); },
                                                            hasListener: (fn) => _listeners.includes(fn),
                                                            _listeners,
                                                        };
                                                    }
                                                    if (!window.chrome.runtime.connect) {
                                                        window.chrome.runtime.connect = (connectOpts = {}) => {
                                                            const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
                                                            const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                                                            const _msgListeners = [];
                                                            const _discListeners = [];
                                                            let _disconnected = false;

                                                            fetch('invisurf-ext://api/call', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ method: 'runtime.connect', args: { portId, name: portName, targetExtId: EXT_ID }, extensionId: EXT_ID })
                                                            }).catch(() => {});

                                                            return {
                                                                name: portName,
                                                                postMessage: (message) => {
                                                                    if (_disconnected) return;
                                                                    fetch('invisurf-ext://api/call', {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ method: 'runtime.portPostMessage', args: { portId, message, targetExtId: EXT_ID }, extensionId: EXT_ID })
                                                                    }).catch(() => {});
                                                                },
                                                                disconnect: () => {
                                                                    if (_disconnected) return;
                                                                    _disconnected = true;
                                                                    fetch('invisurf-ext://api/call', {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ method: 'runtime.portDisconnect', args: { portId, targetExtId: EXT_ID }, extensionId: EXT_ID })
                                                                    }).catch(() => {});
                                                                    for (const fn of _discListeners) {
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
                                                    }

                                                    ${codeContent}
                                                } catch (err) {
                                                    console.warn('[ScriptingManager ContentScript Error]:', err);
                                                }
                                            })();
                                        `;
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
