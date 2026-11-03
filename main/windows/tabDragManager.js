'use strict';

const { BrowserWindow } = require('electron');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { toDisplayUrl } = require('../utils/navigation');

let activeDrag = null;

function getTabStripPaddingLeft() {
    return process.platform === 'darwin' ? 90 : 10;
}

function findTargetWindowForReattach(excludeWindowId, screenX, screenY, sourceContext) {
    if (!State.windowContextsById) return null;
    for (const [winId, ctx] of State.windowContextsById.entries()) {
        if (winId === excludeWindowId) continue;
        if (!ctx?.window || ctx.window.isDestroyed() || !ctx.window.isVisible()) continue;
        if (ctx.window.isMinimized()) continue;
        if (!!ctx.stealthWindow !== !!sourceContext?.stealthWindow) continue;
        if (ctx.profileId !== sourceContext?.profileId) continue;

        const bounds = ctx.window.getBounds();
        const insideX = screenX >= bounds.x && screenX <= bounds.x + bounds.width;
        // Tab bar height is ~45px with 10px buffer
        const insideY = screenY >= bounds.y && screenY <= bounds.y + 55;
        if (insideX && insideY) {
            return { targetContext: ctx, bounds };
        }
    }
    return null;
}

function startDetach(sourceContext, payload = {}) {
    if (!sourceContext || !sourceContext.window || sourceContext.window.isDestroyed()) {
        return { ok: false };
    }

    const {
        tabId,
        screenX = 0,
        screenY = 0,
        grabOffsetX = 50,
        grabOffsetY = 20,
        isSingleTab = false,
        tabData: clientTabData = null,
    } = payload;

    if (!tabId || typeof tabId !== 'string') return { ok: false };

    const tabManager = require('./tabManager');
    const windowManager = require('./windowManager');

    const tabCount = Array.isArray(sourceContext.tabOrder) ? sourceContext.tabOrder.length : 0;
    const isSingle = typeof isSingleTab === 'boolean' ? isSingleTab : tabCount <= 1;

    try {
        if (typeof tabManager.activateOrWakeTab === 'function') {
            tabManager.activateOrWakeTab(tabId);
        }
    } catch (_) { }

    const view = sourceContext.tabs?.[tabId] || null;

    let url = clientTabData?.url || '';
    let title = clientTabData?.title || '';
    let favicon = clientTabData?.favicon || null;
    let isLoading = clientTabData?.isLoading ?? false;
    let history = null;

    if (view && view.webContents && (typeof view.webContents.isDestroyed !== 'function' || !view.webContents.isDestroyed())) {
        url = typeof view.webContents.getURL === 'function' ? view.webContents.getURL() : url;
        title = typeof view.webContents.getTitle === 'function' ? view.webContents.getTitle() : title;
        if (view._favicon) {
            favicon = view._favicon;
        }
        if (typeof view.webContents.isLoading === 'function') {
            isLoading = view.webContents.isLoading();
        }
        try {
            const { captureNavigationHistorySnapshot } = require('../services/sessionService');
            history = captureNavigationHistorySnapshot(view.webContents);
        } catch (_) { }
    } else if (sourceContext.sleepingTabs?.[tabId]) {
        const sleep = sourceContext.sleepingTabs[tabId];
        url = sleep.url || url;
        title = sleep.title || title;
        favicon = sleep.favicon || favicon;
        history = sleep.history || null;
    }

    if (!title && clientTabData?.title) {
        title = clientTabData.title;
    }
    if (!url && clientTabData?.url) {
        url = clientTabData.url;
    }

    const tabData = {
        id: tabId,
        url: toDisplayUrl(url),
        title: title || 'New Tab',
        favicon: favicon || null,
        isLoading: !!isLoading,
        isStealth: !!sourceContext.stealthWindow,
        history,
    };

    // Case 1: Single tab window - drag moves the entire window directly
    if (isSingle) {
        try {
            if (typeof sourceContext.window.setAlwaysOnTop === 'function') {
                sourceContext.window.setAlwaysOnTop(true, 'floating');
            }
            if (typeof sourceContext.window.moveTop === 'function') {
                sourceContext.window.moveTop();
            }
        } catch (_) { }

        activeDrag = {
            tabId,
            sourceContext,
            currentContext: sourceContext,
            detachedWindow: sourceContext.window,
            detachedContext: sourceContext,
            tabData,
            view,
            grabOffsetX: Number(grabOffsetX) || 50,
            grabOffsetY: Number(grabOffsetY) || 20,
            isSingleTabDrag: true,
            isDocked: false,
        };
        return { ok: true, isSingleTab: true };
    }

    // Detach view from source context
    try {
        if (view) tabManager.removeTabContentChildView(sourceContext, view);
    } catch (_) { }

    delete sourceContext.tabs?.[tabId];
    delete sourceContext.sleepingTabs?.[tabId];
    if (Array.isArray(sourceContext.tabOrder)) {
        sourceContext.tabOrder = sourceContext.tabOrder.filter((tid) => tid !== tabId);
    }

    // If active tab was detached, switch source context to next adjacent tab
    if (sourceContext.activeTabId === tabId) {
        const remainingTabs = sourceContext.tabOrder || [];
        const nextId = remainingTabs[0] || null;
        if (nextId) {
            tabManager.activateTabInContext(sourceContext, nextId);
        } else {
            sourceContext.activeTabId = null;
        }
    }

    try {
        require('./lensManager').destroyLensSession(sourceContext, tabId);
    } catch (_) { }

    // Calculate initial window placement
    const padLeft = getTabStripPaddingLeft();
    const targetX = Math.round(screenX - (Number(grabOffsetX) || 50) - padLeft);
    const targetY = Math.round(screenY - (Number(grabOffsetY) || 20) - 5);

    const bootstrapPayload = {
        detachedTab: {
            id: tabId,
            url: toDisplayUrl(url),
            title: title || 'New Tab',
            favicon: favicon || null,
            isLoading: !!isLoading,
            isStealth: !!sourceContext.stealthWindow,
            history,
        },
    };

    const targetContext = windowManager.createWindow({
        profileId: sourceContext.profileId,
        stealthWindow: sourceContext.stealthWindow,
        bounds: {
            x: targetX,
            y: targetY,
            width: 1100,
            height: 750,
        },
        bootstrapPayload,
        show: false,
        focusable: false,
        alwaysOnTop: true,
    });

    if (!targetContext?.window || targetContext.window.isDestroyed()) {
        return { ok: false };
    }

    // Keep detached window floating on top of all existing windows during drag
    // while preventing it from stealing focus and breaking pointer capture
    try {
        if (typeof targetContext.window.setAlwaysOnTop === 'function') {
            targetContext.window.setAlwaysOnTop(true, 'floating');
        }
        if (typeof targetContext.window.setFocusable === 'function') {
            targetContext.window.setFocusable(false);
        }
        if (typeof targetContext.window.showInactive === 'function') {
            targetContext.window.showInactive();
        }
        if (typeof targetContext.window.moveTop === 'function') {
            targetContext.window.moveTop();
        }
    } catch (_) { }

    // Attach WebContentsView directly to target window without reloading
    if (view && !view.webContents.isDestroyed()) {
        if (!targetContext.tabs) targetContext.tabs = {};
        targetContext.tabs[tabId] = view;
        State.tabIdToWindowId.set(tabId, targetContext.window.id);
        State.webContentsIdToTabId.set(view.webContents.id, tabId);
        try {
            tabManager.addTabContentChildView(targetContext, view);
            targetContext.activeTabId = tabId;
            tabManager.layoutActiveTabView(targetContext, tabId);
        } catch (_) { }
    }

    activeDrag = {
        tabId,
        sourceContext,
        currentContext: targetContext,
        detachedWindow: targetContext.window,
        detachedContext: targetContext,
        tabData: {
            id: tabId,
            url: toDisplayUrl(url),
            title: title || 'New Tab',
            isStealth: !!sourceContext.stealthWindow,
            history,
        },
        view,
        grabOffsetX: Number(grabOffsetX) || 50,
        grabOffsetY: Number(grabOffsetY) || 20,
        isSingleTabDrag: false,
        isDocked: false,
    };

    return { ok: true, detachedWindowId: targetContext.windowId };
}

function handleDragMove(payload = {}) {
    if (!activeDrag) return;

    const screenX = Number(payload.screenX) || 0;
    const screenY = Number(payload.screenY) || 0;

    // Single tab drag: move source window
    if (activeDrag.isSingleTabDrag) {
        const win = activeDrag.sourceContext?.window;
        if (win && !win.isDestroyed()) {
            win.setPosition(
                Math.round(screenX - activeDrag.grabOffsetX),
                Math.round(screenY - activeDrag.grabOffsetY)
            );
            try {
                if (typeof win.moveTop === 'function') win.moveTop();
            } catch (_) { }
        }

        // Check if user dragged single tab window over another window's tab bar
        const target = findTargetWindowForReattach(
            activeDrag.sourceContext.window.id,
            screenX,
            screenY,
            activeDrag.sourceContext
        );
        if (target) {
            dockTabIntoWindow(target.targetContext, screenX, screenY);
            // Close the empty source window after docking
            try {
                if (win && !win.isDestroyed()) {
                    if (typeof win.setAlwaysOnTop === 'function') {
                        win.setAlwaysOnTop(false);
                    }
                    win.close();
                }
            } catch (_) { }
            activeDrag.isSingleTabDrag = false;
        }
        return;
    }

    // Detached multi-tab drag
    if (!activeDrag.isDocked) {
        const win = activeDrag.detachedWindow;
        if (win && !win.isDestroyed()) {
            const padLeft = getTabStripPaddingLeft();
            const x = Math.round(screenX - activeDrag.grabOffsetX - padLeft);
            const y = Math.round(screenY - activeDrag.grabOffsetY - 5);
            win.setPosition(x, y);
            try {
                if (typeof win.moveTop === 'function') win.moveTop();
            } catch (_) { }
        }

        // Check if cursor entered another window's tab bar
        const target = findTargetWindowForReattach(
            activeDrag.detachedWindow.id,
            screenX,
            screenY,
            activeDrag.sourceContext
        );
        if (target) {
            dockTabIntoWindow(target.targetContext, screenX, screenY);
        }
    } else {
        // Currently docked in another window: check if user dragged downward out of tab bar
        const bounds = activeDrag.currentContext?.window?.getBounds();
        if (bounds) {
            const outsideTabStrip =
                screenY > bounds.y + 60 ||
                screenY < bounds.y - 10 ||
                screenX < bounds.x - 20 ||
                screenX > bounds.x + bounds.width + 20;

            if (outsideTabStrip) {
                undockTabToDetachedWindow(screenX, screenY);
            }
        }
    }
}

function dockTabIntoWindow(targetContext, screenX, screenY) {
    if (!activeDrag || !targetContext || !targetContext.window || targetContext.window.isDestroyed()) return;
    if (activeDrag.currentContext === targetContext && activeDrag.isDocked) return;

    const tabManager = require('./tabManager');

    // Hide temporary detached window while docked
    if (activeDrag.detachedWindow && !activeDrag.detachedWindow.isDestroyed()) {
        try {
            if (typeof activeDrag.detachedWindow.setAlwaysOnTop === 'function') {
                activeDrag.detachedWindow.setAlwaysOnTop(false);
            }
            activeDrag.detachedWindow.hide();
        } catch (_) { }
    }

    // Transfer WebContentsView to target context
    if (activeDrag.view && !activeDrag.view.webContents.isDestroyed()) {
        try {
            if (activeDrag.currentContext) {
                tabManager.removeTabContentChildView(activeDrag.currentContext, activeDrag.view);
                delete activeDrag.currentContext.tabs?.[activeDrag.tabId];
                if (Array.isArray(activeDrag.currentContext.tabOrder)) {
                    activeDrag.currentContext.tabOrder = activeDrag.currentContext.tabOrder.filter(tid => tid !== activeDrag.tabId);
                }
            }
            if (!targetContext.tabs) targetContext.tabs = {};
            targetContext.tabs[activeDrag.tabId] = activeDrag.view;
            targetContext.activeTabId = activeDrag.tabId;
            State.tabIdToWindowId.set(activeDrag.tabId, targetContext.window.id);
            if (!Array.isArray(targetContext.tabOrder)) {
                targetContext.tabOrder = [];
            }
            if (!targetContext.tabOrder.includes(activeDrag.tabId)) {
                targetContext.tabOrder.push(activeDrag.tabId);
            }
            tabManager.addTabContentChildView(targetContext, activeDrag.view);
            tabManager.layoutActiveTabView(targetContext, activeDrag.tabId);
        } catch (_) { }
    }

    // Update live favicon / loading state if available from the view
    if (activeDrag.view && !activeDrag.view.webContents.isDestroyed()) {
        if (activeDrag.view._favicon) {
            activeDrag.tabData.favicon = activeDrag.view._favicon;
        }
        if (typeof activeDrag.view.webContents.isLoading === 'function') {
            activeDrag.tabData.isLoading = activeDrag.view.webContents.isLoading();
        }
    }

    // Notify target window's React shell to insert tab at index
    if (targetContext.window.webContents && !targetContext.window.webContents.isDestroyed()) {
        targetContext.window.webContents.send(C.IPC_EVENT.TAB_REATTACHED, {
            tab: activeDrag.tabData,
            screenX,
            screenY,
        });
        if (activeDrag.tabData.favicon) {
            targetContext.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
                id: activeDrag.tabId,
                favicon: activeDrag.tabData.favicon,
                url: activeDrag.tabData.url,
                title: activeDrag.tabData.title,
                isLoading: activeDrag.tabData.isLoading,
            });
        }
    }

    activeDrag.currentContext = targetContext;
    activeDrag.isDocked = true;
}

function undockTabToDetachedWindow(screenX, screenY) {
    if (!activeDrag || !activeDrag.isDocked || !activeDrag.detachedContext) return;

    const tabManager = require('./tabManager');

    // Remove tab from previously docked window
    if (activeDrag.currentContext && activeDrag.currentContext !== activeDrag.detachedContext) {
        const win = activeDrag.currentContext.window;
        if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('tab-closed-external', { id: activeDrag.tabId });
        }
        if (activeDrag.view) {
            try {
                tabManager.removeTabContentChildView(activeDrag.currentContext, activeDrag.view);
                delete activeDrag.currentContext.tabs?.[activeDrag.tabId];
                if (Array.isArray(activeDrag.currentContext.tabOrder)) {
                    activeDrag.currentContext.tabOrder = activeDrag.currentContext.tabOrder.filter(tid => tid !== activeDrag.tabId);
                }
            } catch (_) { }
        }
    }

    // Transfer view back to detached window
    if (activeDrag.view && !activeDrag.view.webContents.isDestroyed()) {
        try {
            if (!activeDrag.detachedContext.tabs) activeDrag.detachedContext.tabs = {};
            activeDrag.detachedContext.tabs[activeDrag.tabId] = activeDrag.view;
            activeDrag.detachedContext.activeTabId = activeDrag.tabId;
            State.tabIdToWindowId.set(activeDrag.tabId, activeDrag.detachedContext.window.id);
            tabManager.addTabContentChildView(activeDrag.detachedContext, activeDrag.view);
            tabManager.layoutActiveTabView(activeDrag.detachedContext, activeDrag.tabId);
        } catch (_) { }
    }

    // Reveal and reposition detached window, ensuring it is on top of existing windows
    const win = activeDrag.detachedWindow;
    if (win && !win.isDestroyed()) {
        const padLeft = getTabStripPaddingLeft();
        win.setPosition(
            Math.round(screenX - activeDrag.grabOffsetX - padLeft),
            Math.round(screenY - activeDrag.grabOffsetY - 5)
        );
        try {
            if (typeof win.setAlwaysOnTop === 'function') {
                win.setAlwaysOnTop(true, 'floating');
            }
            if (typeof win.showInactive === 'function') {
                win.showInactive();
            }
            if (typeof win.moveTop === 'function') {
                win.moveTop();
            }
        } catch (_) { }
    }

    activeDrag.currentContext = activeDrag.detachedContext;
    activeDrag.isDocked = false;
}

function handleDragEnd(payload = {}) {
    if (!activeDrag) return { ok: true };

    const { isSingleTabDrag, isDocked, detachedWindow, currentContext, view } = activeDrag;

    if (isSingleTabDrag) {
        try {
            if (activeDrag.sourceContext?.window && !activeDrag.sourceContext.window.isDestroyed()) {
                const keepOnTop = !!activeDrag.sourceContext?.ghostWindow;
                if (typeof activeDrag.sourceContext.window.setAlwaysOnTop === 'function') {
                    activeDrag.sourceContext.window.setAlwaysOnTop(keepOnTop, keepOnTop ? 'floating' : 'normal');
                }
            }
        } catch (_) { }
        activeDrag = null;
        return { ok: true };
    }

    if (isDocked) {
        // Tab docked into another window; destroy temporary detached window
        if (detachedWindow && !detachedWindow.isDestroyed()) {
            try {
                if (typeof detachedWindow.setAlwaysOnTop === 'function') {
                    detachedWindow.setAlwaysOnTop(false);
                }
                detachedWindow.destroy();
            } catch (_) { }
        }
        if (currentContext?.window && !currentContext.window.isDestroyed()) {
            try {
                currentContext.window.focus();
                if (view && !view.webContents.isDestroyed()) {
                    view.webContents.focus();
                }
                if (currentContext.window.webContents && !currentContext.window.webContents.isDestroyed() && activeDrag.tabData?.favicon) {
                    currentContext.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
                        id: activeDrag.tabId,
                        favicon: activeDrag.tabData.favicon,
                        url: activeDrag.tabData.url,
                        title: activeDrag.tabData.title,
                        isLoading: activeDrag.tabData.isLoading,
                    });
                }
            } catch (_) { }
        }
    } else {
        // Still in detached window; restore focusability, clear temporary alwaysOnTop, and focus
        if (detachedWindow && !detachedWindow.isDestroyed()) {
            try {
                const keepOnTop = !!activeDrag.detachedContext?.ghostWindow;
                if (typeof detachedWindow.setAlwaysOnTop === 'function') {
                    detachedWindow.setAlwaysOnTop(keepOnTop, keepOnTop ? 'floating' : 'normal');
                }
                if (typeof detachedWindow.setFocusable === 'function') {
                    detachedWindow.setFocusable(true);
                }
                if (typeof detachedWindow.show === 'function') {
                    detachedWindow.show();
                }
                detachedWindow.focus();
                if (view && !view.webContents.isDestroyed()) {
                    view.webContents.focus();
                }
                if (detachedWindow.webContents && !detachedWindow.webContents.isDestroyed() && activeDrag.tabData?.favicon) {
                    detachedWindow.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
                        id: activeDrag.tabId,
                        favicon: activeDrag.tabData.favicon,
                        url: activeDrag.tabData.url,
                        title: activeDrag.tabData.title,
                        isLoading: activeDrag.tabData.isLoading,
                    });
                }
            } catch (_) { }
        }
    }

    activeDrag = null;
    return { ok: true };
}

function getActiveDrag() {
    return activeDrag;
}

module.exports = {
    startDetach,
    handleDragMove,
    dockTabIntoWindow,
    undockTabToDetachedWindow,
    handleDragEnd,
    findTargetWindowForReattach,
    getActiveDrag,
};
