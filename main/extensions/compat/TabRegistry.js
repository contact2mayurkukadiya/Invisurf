const { webContents, BrowserWindow } = require('electron');
const State = require('../../state');

/**
 * TabRegistry
 * Bridges Electron's WebContentsView-based tab architecture to Chrome's chrome.tabs extension API.
 * Uses Electron numeric webContents.id as the Chrome integer tabId.
 */
class TabRegistry {
    /**
     * Resolves a numeric tabId (webContents.id) to its InviSurf tab information:
     * { context, stringTabId, view, webContents, window }
     */
    resolveTab(tabId) {
        let stringTabId = null;
        let numericId = Number(tabId);
        if (numericId === -1 || numericId === 0) {
            const active = this.getActiveTab();
            if (active && active.id) {
                numericId = active.id;
            }
        }
        if (!isNaN(numericId) && numericId > 0) {
            stringTabId = State.webContentsIdToTabId.get(numericId);
            if (!stringTabId) {
                for (const [winId, ctx] of State.windowContextsById.entries()) {
                    if (ctx?.tabs) {
                        for (const [tid, view] of Object.entries(ctx.tabs)) {
                            if (view?.webContents && !view.webContents.isDestroyed() && view.webContents.id === numericId) {
                                stringTabId = tid;
                                State.webContentsIdToTabId.set(numericId, tid);
                                State.tabIdToWindowId.set(tid, winId);
                                break;
                            }
                        }
                    }
                    if (stringTabId) break;
                }
            }
        } else if (typeof tabId === 'string' && State.tabIdToWindowId.has(tabId)) {
            stringTabId = tabId;
        }

        if (!stringTabId) {
            if (isNaN(numericId)) return null;
            // Check if tabId itself is a webContents that exists
            const wc = webContents.fromId(numericId);
            if (!wc || wc.isDestroyed()) return null;
            return {
                context: null,
                stringTabId: null,
                view: null,
                webContents: wc,
                window: BrowserWindow.fromWebContents(wc) || null,
            };
        }

        const windowId = State.tabIdToWindowId.get(stringTabId);
        const context = windowId ? State.windowContextsById.get(windowId) : null;
        const view = context?.tabs?.[stringTabId] || null;
        const wc = view?.webContents || webContents.fromId(numericId);

        return {
            context,
            stringTabId,
            view,
            webContents: wc,
            window: context?.window || (wc ? BrowserWindow.fromWebContents(wc) : null),
        };
    }

    /**
     * Resolves the Chrome integer tabId for a given Electron webContents.id.
     */
    getTabIdForWebContentsId(webContentsId) {
        if (!webContentsId) return -1;
        return Number(webContentsId);
    }

    /**
     * Serializes a WebContentsView or WebContents into a standard Chrome Tab object.
     */
    formatTab(context, stringTabId, view, wc) {
        if (!wc || wc.isDestroyed()) return null;

        const id = wc.id;
        const windowId = context?.window?.id || 1;
        const isActive = context ? context.activeTabId === stringTabId : false;

        let url = '';
        let title = '';
        let isLoading = false;

        try {
            url = wc.getURL() || '';
            title = wc.getTitle() || '';
            isLoading = wc.isLoading();
        } catch (_) {}

        let width = 0;
        let height = 0;
        try {
            if (view && typeof view.getBounds === 'function') {
                const b = view.getBounds();
                width = b.width;
                height = b.height;
            } else if (context?.window) {
                const b = context.window.getContentBounds();
                width = b.width;
                height = b.height;
            }
        } catch (_) {}

        let tabIndex = 0;
        if (context && Array.isArray(context.tabOrder) && stringTabId) {
            const idx = context.tabOrder.indexOf(stringTabId);
            if (idx !== -1) tabIndex = idx;
        }

        return {
            id,
            index: tabIndex,
            windowId,
            highlighted: isActive,
            active: isActive,
            selected: isActive,
            pinned: false,
            hidden: false,
            url,
            title,
            favIconUrl: '',
            status: isLoading ? 'loading' : 'complete',
            incognito: !!context?.stealthWindow,
            width,
            height,
            audible: wc.isCurrentlyAudible ? wc.isCurrentlyAudible() : false,
            mutedInfo: {
                muted: wc.isAudioMuted ? wc.isAudioMuted() : false,
            },
        };
    }

    /**
     * Finds active tab in the focused or specified window context.
     */
    getActiveTab(context = null) {
        let ctx = context;
        if (!ctx) {
            const focusedWin = BrowserWindow.getFocusedWindow();
            if (focusedWin) {
                ctx = State.windowContextsById.get(focusedWin.id);
            }
        }
        if (!ctx && State.windowContextsById.size > 0) {
            ctx = State.windowContextsById.values().next().value;
        }

        if (!ctx || !ctx.activeTabId) return null;
        const view = ctx.tabs?.[ctx.activeTabId];
        if (!view || !view.webContents || view.webContents.isDestroyed()) return null;

        return this.formatTab(ctx, ctx.activeTabId, view, view.webContents);
    }

    /**
     * chrome.tabs.query(queryInfo)
     */
    async query(queryInfo = {}, senderContext = null) {
        const results = [];
        let targetWindowId = queryInfo.windowId;
        if (targetWindowId === -2 || (targetWindowId === undefined && queryInfo.currentWindow)) {
            targetWindowId = undefined;
            if (senderContext?.window?.id) {
                targetWindowId = senderContext.window.id;
            } else if (senderContext?.senderWebContents) {
                const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
                const ctx = getWindowContextByEventSender(senderContext.senderWebContents);
                if (ctx?.window?.id) targetWindowId = ctx.window.id;
            }
            if (targetWindowId === undefined) {
                const { getFocusedShellWindow } = require('../../windows/windowContextUtils');
                const focused = getFocusedShellWindow() || State.mainWindow;
                if (focused?.id) targetWindowId = focused.id;
            }
        }

        for (const [winId, ctx] of State.windowContextsById.entries()) {
            if (targetWindowId !== undefined && targetWindowId !== null && Number(winId) !== Number(targetWindowId)) {
                continue;
            }

            if (!ctx?.tabs) continue;

            const orderedIds = (Array.isArray(ctx.tabOrder) && ctx.tabOrder.length > 0)
                ? [
                    ...ctx.tabOrder.filter(tid => ctx.tabs[tid]),
                    ...Object.keys(ctx.tabs).filter(tid => !ctx.tabOrder.includes(tid)),
                  ]
                : Object.keys(ctx.tabs);

            let tabIndex = 0;
            for (const strId of orderedIds) {
                const view = ctx.tabs[strId];
                if (!view?.webContents || view.webContents.isDestroyed()) continue;

                const tab = this.formatTab(ctx, strId, view, view.webContents);
                if (!tab) continue;
                tab.index = tabIndex++;

                // Filter by active
                if (queryInfo.active !== undefined && tab.active !== queryInfo.active) {
                    continue;
                }

                // Filter by highlighted
                if (queryInfo.highlighted !== undefined && tab.highlighted !== queryInfo.highlighted) {
                    continue;
                }

                // Filter by index
                if (queryInfo.index !== undefined && tab.index !== queryInfo.index) {
                    continue;
                }

                // Filter by status
                if (queryInfo.status !== undefined && tab.status !== queryInfo.status) {
                    continue;
                }

                // Filter by url match
                if (queryInfo.url) {
                    const pattern = queryInfo.url;
                    if (Array.isArray(pattern)) {
                        if (!pattern.some(p => this._matchesUrl(tab.url, p))) continue;
                    } else if (!this._matchesUrl(tab.url, pattern)) {
                        continue;
                    }
                }

                // Filter by title match
                if (queryInfo.title && !tab.title.includes(queryInfo.title)) {
                    continue;
                }

                results.push(tab);
            }
        }

        return results;
    }

    _matchesUrl(targetUrl, pattern) {
        if (!targetUrl || !pattern) return false;
        if (pattern === '<all_urls>') return true;
        try {
            const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return regex.test(targetUrl);
        } catch {
            return targetUrl.includes(pattern);
        }
    }

    /**
     * chrome.tabs.get(tabId)
     */
    async get(tabId) {
        const resolved = this.resolveTab(tabId);
        if (!resolved || !resolved.webContents) {
            throw new Error(`No tab with id: ${tabId}`);
        }
        return this.formatTab(resolved.context, resolved.stringTabId, resolved.view, resolved.webContents);
    }

    /**
     * chrome.tabs.getCurrent()
     */
    async getCurrent(senderWebContentsId) {
        if (!senderWebContentsId) return null;
        return this.get(senderWebContentsId).catch(() => null);
    }

    /**
     * chrome.tabs.create(createProperties)
     */
    async create(createProperties = {}, senderContext = null) {
        const tabManager = require('../../windows/tabManager');
        const url = createProperties.url || 'about:blank';
        const activate = createProperties.active !== false;

        let ctx = null;
        if (createProperties.windowId) {
            ctx = State.windowContextsById.get(createProperties.windowId) || null;
        }
        if (!ctx && senderContext?.window && !senderContext.window.isDestroyed() && senderContext?.tabs) {
            ctx = senderContext;
        }
        if (!ctx && senderContext?.senderWebContents) {
            const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
            ctx = getWindowContextByEventSender(senderContext.senderWebContents);
        }
        if (!ctx) {
            const { getWindowContextForShellFallback } = require('../../windows/windowContextUtils');
            ctx = getWindowContextForShellFallback();
        }
        if (!ctx && State.windowContextsById.size > 0) {
            ctx = State.windowContextsById.values().next().value;
        }

        if (!ctx) {
            throw new Error('No active window context to create tab');
        }

        const newTabId = tabManager.generateTabId();
        const stealthTab = !!ctx.stealthWindow;
        const { resolveTabLoadUrl } = require('../../utils/navigation');
        const resolvedUrl = resolveTabLoadUrl(url);

        tabManager.createTab(ctx, newTabId, resolvedUrl, stealthTab, { activate });

        if (ctx.window && !ctx.window.isDestroyed() && ctx.window.webContents && !ctx.window.webContents.isDestroyed()) {
            ctx.window.webContents.send('tab-created', { id: newTabId, isStealth: stealthTab, url: resolvedUrl });
        }
        if (activate) {
            tabManager.activateTabInContext(ctx, newTabId);
        }

        const view = ctx.tabs[newTabId];
        const createdTab = view ? this.formatTab(ctx, newTabId, view, view.webContents) : null;
        return createdTab || { id: -1, url: resolvedUrl, active: activate };
    }

    /**
     * chrome.tabs.update(tabId, updateProperties)
     */
    async update(tabId, updateProperties = {}) {
        let resolved = tabId ? this.resolveTab(tabId) : null;
        if (!resolved) {
            const active = this.getActiveTab();
            if (active) resolved = this.resolveTab(active.id);
        }

        if (!resolved || !resolved.webContents || resolved.webContents.isDestroyed()) {
            throw new Error(`No tab with id: ${tabId}`);
        }

        const { context, stringTabId, webContents: wc } = resolved;
        const tabManager = require('../../windows/tabManager');

        if (updateProperties.url) {
            wc.loadURL(updateProperties.url).catch(() => {});
        }

        const shouldActivate = updateProperties.active || updateProperties.selected || updateProperties.highlighted;
        if (shouldActivate && context && stringTabId) {
            tabManager.activateTab(context, stringTabId);
        }

        if (updateProperties.muted !== undefined && typeof wc.setAudioMuted === 'function') {
            wc.setAudioMuted(!!updateProperties.muted);
        }

        return this.formatTab(context, stringTabId, resolved.view, wc);
    }

    /**
     * chrome.tabs.remove(tabIds)
     */
    async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const tabManager = require('../../windows/tabManager');

        for (const tid of ids) {
            const resolved = this.resolveTab(tid);
            if (resolved?.context && resolved?.stringTabId) {
                tabManager.closeTab(resolved.context, resolved.stringTabId);
            } else if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
                resolved.webContents.destroy();
            }
        }
    }

    /**
     * chrome.tabs.reload(tabId, reloadProperties)
     */
    async reload(tabId, reloadProperties = {}) {
        const resolved = this.resolveTab(tabId);
        if (!resolved?.webContents || resolved.webContents.isDestroyed()) return;

        if (reloadProperties.bypassCache) {
            resolved.webContents.reloadIgnoringCache();
        } else {
            resolved.webContents.reload();
        }
    }

    /**
     * chrome.tabs.goBack(tabId)
     */
    async goBack(tabId) {
        const resolved = this.resolveTab(tabId);
        if (resolved?.webContents && resolved.webContents.canGoBack()) {
            resolved.webContents.goBack();
        }
    }

    /**
     * chrome.tabs.goForward(tabId)
     */
    async goForward(tabId) {
        const resolved = this.resolveTab(tabId);
        if (resolved?.webContents && resolved.webContents.canGoForward()) {
            resolved.webContents.goForward();
        }
    }

    /**
     * chrome.tabs.sendMessage(tabId, message, options)
     */
    async sendMessage(tabId, message, options = {}, sender = {}) {
        const resolved = this.resolveTab(tabId);
        if (!resolved?.webContents || resolved.webContents.isDestroyed()) {
            throw new Error(`Could not establish connection. Receiving end does not exist (tabId ${tabId}).`);
        }

        const wc = resolved.webContents;

        // Dispatches onMessage in tab's content script context and waits for response
        const dispatchScript = `
            (() => {
                return new Promise((resolve) => {
                    try {
                        const msg = ${JSON.stringify(message)};
                        const sender = ${JSON.stringify(sender)};
                        let responded = false;
                        const sendResponse = (res) => {
                            if (responded) return;
                            responded = true;
                            resolve(res);
                        };

                        if (window.chrome?.runtime?.onMessage?._listeners?.length) {
                            let asyncWait = false;
                            for (const fn of window.chrome.runtime.onMessage._listeners) {
                                try {
                                    const r = fn(msg, sender, sendResponse);
                                    if (r === true || (r && typeof r.then === 'function')) {
                                        asyncWait = true;
                                        if (r && typeof r.then === 'function') {
                                            r.then(sendResponse).catch(() => sendResponse(undefined));
                                        }
                                    }
                                } catch (_) {}
                            }
                            if (!asyncWait) setTimeout(() => resolve(undefined), 50);
                        } else {
                            const cbId = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                            const onResp = (ev) => {
                                if (ev.source === window && ev.data && ev.data.source === 'invisurf-ext-response' && ev.data.callbackId === cbId) {
                                    window.removeEventListener('message', onResp);
                                    sendResponse(ev.data.response);
                                }
                            };
                            window.addEventListener('message', onResp);
                            window.postMessage({
                                source: 'invisurf-ext-event',
                                payload: {
                                    eventName: 'chrome.runtime.onMessage',
                                    args: [msg, sender],
                                    callbackId: cbId
                                }
                            }, '*');
                            setTimeout(() => {
                                window.removeEventListener('message', onResp);
                                if (!responded) resolve(undefined);
                            }, 5000);
                        }
                    } catch (e) {
                        resolve(undefined);
                    }
                });
            })();
        `;

        try {
            return await wc.executeJavaScript(dispatchScript);
        } catch (err) {
            return undefined;
        }
    }

    /**
     * Captures the visible area of the active tab in the specified window context.
     */
    async captureVisibleTab(context, windowId, options = {}) {
        let wc = null;
        if (context && context.activeTabId && context.tabs && context.tabs[context.activeTabId]) {
            wc = context.tabs[context.activeTabId].webContents;
        } else {
            for (const ctx of State.windowContextsById.values()) {
                if (windowId && ctx.window?.id !== windowId) continue;
                if (ctx.activeTabId && ctx.tabs && ctx.tabs[ctx.activeTabId]) {
                    wc = ctx.tabs[ctx.activeTabId].webContents;
                    break;
                }
            }
        }

        if (!wc || wc.isDestroyed()) {
            throw new Error('No active tab found to capture');
        }

        const format = options.format === 'png' ? 'png' : 'jpeg';
        const quality = typeof options.quality === 'number' ? Math.min(100, Math.max(0, options.quality)) : 90;
        const nativeImage = await wc.capturePage();

        if (format === 'png') {
            return nativeImage.toDataURL();
        } else {
            const buf = nativeImage.toJPEG(quality);
            return `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
    }

    /**
     * Duplicates the tab with the specified ID.
     */
    async duplicate(tabIdOrContext, maybeTabId = undefined) {
        let tabId = tabIdOrContext;
        let sender = null;
        if (maybeTabId !== undefined) {
            if (typeof maybeTabId === 'number' || typeof maybeTabId === 'string') {
                tabId = maybeTabId;
                sender = tabIdOrContext;
            } else {
                tabId = tabIdOrContext;
                sender = maybeTabId;
            }
        }
        if (typeof tabId === 'object' && tabId !== null) {
            tabId = tabId.tabId || tabId.id;
        }

        let resolved = tabId ? this.resolveTab(tabId) : null;
        if (!resolved) {
            const active = this.getActiveTab();
            if (active) resolved = this.resolveTab(active.id);
        }

        if (!resolved || !resolved.webContents || resolved.webContents.isDestroyed()) {
            throw new Error(`Tab ${tabId} not found`);
        }

        const url = resolved.webContents.getURL() || 'about:blank';
        let ctx = resolved.context;
        if (!ctx && sender?.senderWebContents) {
            const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
            ctx = getWindowContextByEventSender(sender.senderWebContents);
        }
        if (!ctx && State.windowContextsById.size > 0) {
            ctx = State.windowContextsById.values().next().value;
        }
        if (!ctx) throw new Error('No active window context');

        const tabManager = require('../../windows/tabManager');
        const newTabId = tabManager.generateTabId();
        const stealthTab = !!ctx.stealthWindow;
        const { resolveTabLoadUrl } = require('../../utils/navigation');
        const resolvedUrl = resolveTabLoadUrl(url);

        tabManager.createTab(ctx, newTabId, resolvedUrl, stealthTab, { activate: true });

        // Maintain visual tab order immediately after the source tab
        if (Array.isArray(ctx.tabOrder) && resolved.stringTabId) {
            const srcIdx = ctx.tabOrder.indexOf(resolved.stringTabId);
            const curIdx = ctx.tabOrder.indexOf(newTabId);
            if (curIdx !== -1) ctx.tabOrder.splice(curIdx, 1);
            if (srcIdx !== -1) {
                ctx.tabOrder.splice(srcIdx + 1, 0, newTabId);
            } else {
                ctx.tabOrder.push(newTabId);
            }
        }

        if (ctx.window && !ctx.window.isDestroyed() && ctx.window.webContents && !ctx.window.webContents.isDestroyed()) {
            ctx.window.webContents.send('tab-created', { id: newTabId, isStealth: stealthTab, url: resolvedUrl });
        }

        tabManager.activateTabInContext(ctx, newTabId);

        const view = ctx.tabs[newTabId];
        return view ? this.formatTab(ctx, newTabId, view, view.webContents) : null;
    }

    /**
     * chrome.tabs.getZoom(tabId)
     */
    async getZoom(tabId) {
        const resolved = this.resolveTab(tabId);
        if (!resolved?.webContents || resolved.webContents.isDestroyed()) return 1.0;
        return resolved.webContents.getZoomFactor();
    }

    /**
     * chrome.tabs.setZoom(tabId, zoomFactor)
     */
    async setZoom(tabId, zoomFactor = 1.0) {
        const resolved = this.resolveTab(tabId);
        if (resolved?.webContents && !resolved.webContents.isDestroyed()) {
            resolved.webContents.setZoomFactor(Number(zoomFactor) || 1.0);
        }
        return true;
    }

    /**
     * chrome.tabs.discard(tabId)
     */
    async discard(tabId) {
        const resolved = this.resolveTab(tabId);
        if (!resolved) return null;
        return this.formatTab(resolved.context, resolved.stringTabId, resolved.view, resolved.webContents);
    }

    /**
     * chrome.tabs.highlight(highlightInfo)
     * Highlights the given tabs and activates the first specified tab index.
     * highlightInfo: { windowId?: number, tabs: number | number[] }
     */
    async highlight(highlightInfo = {}, sender = null) {
        let targetWindowId = highlightInfo.windowId;
        let ctx = null;

        if (targetWindowId !== undefined && targetWindowId !== null) {
            ctx = State.windowContextsById.get(Number(targetWindowId));
        }
        if (!ctx) {
            const focused = BrowserWindow.getFocusedWindow() || State.mainWindow;
            if (focused?.id) {
                ctx = State.windowContextsById.get(focused.id);
            }
        }
        if (!ctx && State.windowContextsById.size > 0) {
            ctx = State.windowContextsById.values().next().value;
        }

        if (!ctx || !ctx.tabs) {
            throw new Error('No window found for tabs.highlight');
        }

        const rawTabs = highlightInfo.tabs;
        const indices = (Array.isArray(rawTabs) ? rawTabs : [rawTabs]).map(Number);

        const orderedIds = (Array.isArray(ctx.tabOrder) && ctx.tabOrder.length > 0)
            ? [
                ...ctx.tabOrder.filter(tid => ctx.tabs[tid]),
                ...Object.keys(ctx.tabs).filter(tid => !ctx.tabOrder.includes(tid)),
              ]
            : Object.keys(ctx.tabs);

        if (orderedIds.length === 0) {
            return { id: ctx.window?.id || 1, tabs: [] };
        }

        let targetIndex = indices[0];
        if (isNaN(targetIndex)) targetIndex = 0;
        if (targetIndex < 0) {
            targetIndex = orderedIds.length + targetIndex;
        }
        targetIndex = Math.max(0, Math.min(targetIndex, orderedIds.length - 1));

        const targetTabId = orderedIds[targetIndex];
        if (targetTabId) {
            const tabManager = require('../../windows/tabManager');
            tabManager.activateTab(ctx, targetTabId);
        }

        const tabResults = [];
        for (let i = 0; i < orderedIds.length; i++) {
            const sId = orderedIds[i];
            const view = ctx.tabs[sId];
            if (view?.webContents && !view.webContents.isDestroyed()) {
                const formatted = this.formatTab(ctx, sId, view, view.webContents);
                if (formatted) {
                    formatted.index = i;
                    formatted.highlighted = indices.includes(i);
                    tabResults.push(formatted);
                }
            }
        }

        return {
            id: ctx.window?.id || 1,
            focused: true,
            incognito: !!ctx.stealthWindow,
            tabs: tabResults,
        };
    }

    /**
     * chrome.tabs.move(tabIds, moveProperties)
     */
    async move(tabIds, moveProperties = {}) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const results = [];
        const newIndex = moveProperties.index;

        for (const tid of ids) {
            const resolved = this.resolveTab(tid);
            if (!resolved?.context || !resolved?.stringTabId) continue;
            const { context: ctx, stringTabId } = resolved;

            if (Array.isArray(ctx.tabOrder) && typeof newIndex === 'number') {
                const curIdx = ctx.tabOrder.indexOf(stringTabId);
                if (curIdx !== -1) {
                    ctx.tabOrder.splice(curIdx, 1);
                    const targetIdx = newIndex === -1 ? ctx.tabOrder.length : Math.max(0, Math.min(newIndex, ctx.tabOrder.length));
                    ctx.tabOrder.splice(targetIdx, 0, stringTabId);
                }
            }

            const formatted = this.formatTab(ctx, stringTabId, resolved.view, resolved.webContents);
            if (formatted) results.push(formatted);
        }

        return Array.isArray(tabIds) ? results : (results[0] || null);
    }
}

// Singleton
let instance = null;
function getTabRegistry() {
    if (!instance) {
        instance = new TabRegistry();
    }
    return instance;
}

module.exports = {
    TabRegistry,
    getTabRegistry,
};
