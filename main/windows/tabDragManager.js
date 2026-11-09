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
        splitPair: clientSplitPair = null,
        rightTabData: clientRightTabData = null,
        isGroupDetach = false,
        groupId = null,
        group = null,
        memberTabIds = [],
        memberTabsData = [],
        activeTabId = null,
    } = payload;

    // Detach an entire tab group into a new window via vertical drag
    if (isGroupDetach && group && Array.isArray(memberTabIds) && memberTabIds.length > 0) {
        const tabManager = require('./tabManager');
        const windowManager = require('./windowManager');

        const nonGroupTabs = Array.isArray(sourceContext.tabOrder)
            ? sourceContext.tabOrder.filter((tid) => !memberTabIds.includes(tid))
            : [];
        const isSingle = isSingleTab === true || nonGroupTabs.length === 0;

        if (isSingle) {
            try {
                if (typeof sourceContext.window.setAlwaysOnTop === 'function') {
                    sourceContext.window.setAlwaysOnTop(true, 'floating');
                }
                if (typeof sourceContext.window.moveTop === 'function') {
                    sourceContext.window.moveTop();
                }
            } catch (_) { }

            const resolvedMemberTabsData = (Array.isArray(memberTabsData) && memberTabsData.length > 0)
                ? memberTabsData
                : memberTabIds.map((tid) => {
                    const v = sourceContext.tabs?.[tid];
                    return {
                        id: tid,
                        url: v?.webContents?.getURL?.() || '',
                        title: v?.webContents?.getTitle?.() || 'New Tab',
                        favicon: v?._favicon || null,
                        isLoading: v?.webContents?.isLoading?.() || false,
                        isStealth: !!sourceContext.stealthWindow,
                    };
                });

            const memberViews = {};
            for (const tid of memberTabIds) {
                if (sourceContext.tabs?.[tid]) {
                    memberViews[tid] = sourceContext.tabs[tid];
                }
            }

            activeDrag = {
                isGroupDrag: true,
                groupId: group.id,
                group: { ...group },
                memberTabIds,
                memberTabsData: resolvedMemberTabsData,
                memberViews,
                activeTabId: activeTabId || memberTabIds[0],
                sourceContext,
                currentContext: sourceContext,
                detachedWindow: sourceContext.window,
                detachedContext: sourceContext,
                grabOffsetX: Number(grabOffsetX) || 50,
                grabOffsetY: Number(grabOffsetY) || 20,
                isSingleTabDrag: true,
                isDocked: false,
            };
            return { ok: true, isSingleTab: true };
        }

        // Multi-tab window detachment of an entire group
        const memberViews = {};
        for (const tid of memberTabIds) {
            const v = sourceContext.tabs?.[tid];
            if (v) {
                try {
                    tabManager.removeTabContentChildView(sourceContext, v);
                } catch (_) { }
                memberViews[tid] = v;
            }
            delete sourceContext.tabs?.[tid];
            delete sourceContext.sleepingTabs?.[tid];
            State.tabIdToWindowId.delete(tid);
        }
        if (Array.isArray(sourceContext.tabOrder)) {
            sourceContext.tabOrder = sourceContext.tabOrder.filter(tid => !memberTabIds.includes(tid));
        }
        delete sourceContext.tabGroups?.[group.id];

        // Switch source context to remaining tab
        const remainingTabs = sourceContext.tabOrder || [];
        if (memberTabIds.includes(sourceContext.activeTabId)) {
            if (remainingTabs.length > 0) {
                tabManager.activateTabInContext(sourceContext, remainingTabs[0]);
            } else {
                sourceContext.activeTabId = null;
            }
        }

        const padLeft = getTabStripPaddingLeft();
        const targetX = Math.round(screenX - (Number(grabOffsetX) || 50) - padLeft);
        const targetY = Math.round(screenY - (Number(grabOffsetY) || 20) - 5);

        const bootstrapPayload = {
            detachedGroup: {
                group: { ...group },
                tabs: memberTabsData,
                activeTabId: activeTabId || memberTabIds[0],
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

        if (!targetContext.tabs) targetContext.tabs = {};
        if (!targetContext.tabGroups) targetContext.tabGroups = {};
        targetContext.tabGroups[group.id] = { ...group };
        targetContext.tabOrder = [...memberTabIds];

        for (const tid of memberTabIds) {
            const v = memberViews[tid];
            if (v && !v.webContents.isDestroyed()) {
                targetContext.tabs[tid] = v;
                State.tabIdToWindowId.set(tid, targetContext.window.id);
                State.webContentsIdToTabId.set(v.webContents.id, tid);
                try {
                    tabManager.addTabContentChildView(targetContext, v);
                } catch (_) { }
            }
        }
        const actId = activeTabId || memberTabIds[0];
        targetContext.activeTabId = actId;
        tabManager.layoutActiveTabView(targetContext, actId);

        activeDrag = {
            isGroupDrag: true,
            groupId: group.id,
            group: { ...group },
            memberTabIds,
            memberTabsData,
            memberViews,
            sourceContext,
            currentContext: targetContext,
            detachedWindow: targetContext.window,
            detachedContext: targetContext,
            grabOffsetX: Number(grabOffsetX) || 50,
            grabOffsetY: Number(grabOffsetY) || 20,
            isSingleTabDrag: false,
            isDocked: false,
        };
        return { ok: true, isSingleTab: false };
    }

    if (!tabId || typeof tabId !== 'string') return { ok: false };

    const tabManager = require('./tabManager');
    const windowManager = require('./windowManager');
    const splitTabManager = require('./splitTabManager');

    const splitPair = clientSplitPair || splitTabManager.getSplitPairByTabId(sourceContext, tabId);
    const isSplit = !!splitPair;
    const leftTabId = isSplit ? splitPair.leftTabId : tabId;
    const rightTabId = isSplit ? splitPair.rightTabId : null;

    const nonSplitTabs = Array.isArray(sourceContext.tabOrder)
        ? sourceContext.tabOrder.filter((tid) => tid !== leftTabId && tid !== rightTabId)
        : [];
    const isSingle = isSplit
        ? (isSingleTab === true || nonSplitTabs.length === 0)
        : (typeof isSingleTab === 'boolean' ? isSingleTab : ((sourceContext.tabOrder?.length || 0) <= 1));

    try {
        if (typeof tabManager.activateOrWakeTab === 'function') {
            tabManager.activateOrWakeTab(leftTabId);
        }
    } catch (_) { }

    const leftView = sourceContext.tabs?.[leftTabId] || null;
    const view = leftView;

    let url = clientTabData?.url || '';
    let title = clientTabData?.title || '';
    let favicon = clientTabData?.favicon || null;
    let isLoading = clientTabData?.isLoading ?? false;
    let history = null;

    if (leftView && leftView.webContents && (typeof leftView.webContents.isDestroyed !== 'function' || !leftView.webContents.isDestroyed())) {
        url = typeof leftView.webContents.getURL === 'function' ? leftView.webContents.getURL() : url;
        title = typeof leftView.webContents.getTitle === 'function' ? leftView.webContents.getTitle() : title;
        if (leftView._favicon) {
            favicon = leftView._favicon;
        }
        if (typeof leftView.webContents.isLoading === 'function') {
            isLoading = leftView.webContents.isLoading();
        }
        try {
            const { captureNavigationHistorySnapshot } = require('../services/sessionService');
            history = captureNavigationHistorySnapshot(leftView.webContents);
        } catch (_) { }
    } else if (sourceContext.sleepingTabs?.[leftTabId]) {
        const sleep = sourceContext.sleepingTabs[leftTabId];
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

    const leftTabData = {
        id: leftTabId,
        url: toDisplayUrl(url),
        title: title || 'New Tab',
        favicon: favicon || null,
        isLoading: !!isLoading,
        isStealth: !!sourceContext.stealthWindow,
        history,
        groupId: clientTabData?.groupId || null,
    };

    let rightView = null;
    let rightTabData = null;
    if (isSplit && rightTabId) {
        try {
            if (typeof tabManager.activateOrWakeTab === 'function') {
                tabManager.activateOrWakeTab(rightTabId);
            }
        } catch (_) { }

        rightView = sourceContext.tabs?.[rightTabId] || null;
        let rUrl = clientRightTabData?.url || '';
        let rTitle = clientRightTabData?.title || '';
        let rFavicon = clientRightTabData?.favicon || null;
        let rIsLoading = clientRightTabData?.isLoading ?? false;
        let rHistory = null;

        if (rightView && rightView.webContents && (typeof rightView.webContents.isDestroyed !== 'function' || !rightView.webContents.isDestroyed())) {
            rUrl = typeof rightView.webContents.getURL === 'function' ? rightView.webContents.getURL() : rUrl;
            rTitle = typeof rightView.webContents.getTitle === 'function' ? rightView.webContents.getTitle() : rTitle;
            if (rightView._favicon) {
                rFavicon = rightView._favicon;
            }
            if (typeof rightView.webContents.isLoading === 'function') {
                rIsLoading = rightView.webContents.isLoading();
            }
            try {
                const { captureNavigationHistorySnapshot } = require('../services/sessionService');
                rHistory = captureNavigationHistorySnapshot(rightView.webContents);
            } catch (_) { }
        } else if (sourceContext.sleepingTabs?.[rightTabId]) {
            const sleep = sourceContext.sleepingTabs[rightTabId];
            rUrl = sleep.url || rUrl;
            rTitle = sleep.title || rTitle;
            rFavicon = sleep.favicon || rFavicon;
            rHistory = sleep.history || null;
        }

        if (!rTitle && clientRightTabData?.title) rTitle = clientRightTabData.title;
        if (!rUrl && clientRightTabData?.url) rUrl = clientRightTabData.url;

        rightTabData = {
            id: rightTabId,
            url: toDisplayUrl(rUrl),
            title: rTitle || 'New Tab',
            favicon: rFavicon || null,
            isLoading: !!rIsLoading,
            isStealth: !!sourceContext.stealthWindow,
            history: rHistory,
        };
    }

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
            splitPair: isSplit ? { ...splitPair } : null,
            leftTabId,
            rightTabId,
            leftTabData,
            rightTabData,
            leftView,
            rightView,
            sourceContext,
            currentContext: sourceContext,
            detachedWindow: sourceContext.window,
            detachedContext: sourceContext,
            tabData: leftTabData,
            view: leftView,
            grabOffsetX: Number(grabOffsetX) || 50,
            grabOffsetY: Number(grabOffsetY) || 20,
            isSingleTabDrag: true,
            isDocked: false,
        };
        return { ok: true, isSingleTab: true };
    }

    // Case 2: Multi-tab window detachment
    if (isSplit) {
        try {
            if (leftView) tabManager.removeTabContentChildView(sourceContext, leftView);
        } catch (_) { }
        try {
            if (rightView) tabManager.removeTabContentChildView(sourceContext, rightView);
        } catch (_) { }

        delete sourceContext.tabs?.[leftTabId];
        delete sourceContext.sleepingTabs?.[leftTabId];
        if (rightTabId) {
            delete sourceContext.tabs?.[rightTabId];
            delete sourceContext.sleepingTabs?.[rightTabId];
        }
        if (Array.isArray(sourceContext.tabOrder)) {
            sourceContext.tabOrder = sourceContext.tabOrder.filter((tid) => tid !== leftTabId && tid !== rightTabId);
        }
        if (sourceContext.splitPairs) {
            sourceContext.splitPairs.delete(splitPair.id);
        }
        splitTabManager.broadcastSplitUpdate(sourceContext, { id: splitPair.id }, { removed: true });

        // If active tab was in the split pair, switch source context to next adjacent tab
        if (sourceContext.activeTabId === leftTabId || sourceContext.activeTabId === rightTabId) {
            const remainingTabs = sourceContext.tabOrder || [];
            const nextId = remainingTabs[0] || null;
            if (nextId) {
                tabManager.activateTabInContext(sourceContext, nextId);
            } else {
                sourceContext.activeTabId = null;
            }
        }

        try {
            require('./lensManager').destroyLensSession(sourceContext, leftTabId);
            if (rightTabId) require('./lensManager').destroyLensSession(sourceContext, rightTabId);
        } catch (_) { }

        const padLeft = getTabStripPaddingLeft();
        const targetX = Math.round(screenX - (Number(grabOffsetX) || 50) - padLeft);
        const targetY = Math.round(screenY - (Number(grabOffsetY) || 20) - 5);

        const bootstrapPayload = {
            detachedSplit: {
                splitPair: { ...splitPair },
                leftTab: leftTabData,
                rightTab: rightTabData,
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

        if (!targetContext.tabs) targetContext.tabs = {};
        if (leftView && !leftView.webContents.isDestroyed()) {
            targetContext.tabs[leftTabId] = leftView;
            State.tabIdToWindowId.set(leftTabId, targetContext.window.id);
            State.webContentsIdToTabId.set(leftView.webContents.id, leftTabId);
            tabManager.addTabContentChildView(targetContext, leftView);
        }
        if (rightTabId && rightView && !rightView.webContents.isDestroyed()) {
            targetContext.tabs[rightTabId] = rightView;
            State.tabIdToWindowId.set(rightTabId, targetContext.window.id);
            State.webContentsIdToTabId.set(rightView.webContents.id, rightTabId);
            tabManager.addTabContentChildView(targetContext, rightView);
        }

        if (!targetContext.splitPairs) targetContext.splitPairs = new Map();
        targetContext.splitPairs.set(splitPair.id, { ...splitPair });
        targetContext.tabOrder = rightTabId ? [leftTabId, rightTabId] : [leftTabId];

        const activeTabId = (splitPair.focusedSide === 'right' && rightTabId) ? rightTabId : leftTabId;
        targetContext.activeTabId = activeTabId;

        splitTabManager.layoutSplitTabViews(targetContext, splitPair);

        activeDrag = {
            tabId,
            splitPair: { ...splitPair },
            leftTabId,
            rightTabId,
            leftTabData,
            rightTabData,
            leftView,
            rightView,
            sourceContext,
            currentContext: targetContext,
            detachedWindow: targetContext.window,
            detachedContext: targetContext,
            tabData: leftTabData,
            view: leftView,
            grabOffsetX: Number(grabOffsetX) || 50,
            grabOffsetY: Number(grabOffsetY) || 20,
            isSingleTabDrag: false,
            isDocked: false,
        };

        return { ok: true, detachedWindowId: targetContext.windowId };
    }

    // Detach single normal view from source context
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
            favicon: favicon || null,
            isLoading: !!isLoading,
            isStealth: !!sourceContext.stealthWindow,
            history,
            groupId: clientTabData?.groupId || null,
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

    // Group drag: moves either the single window or the detached window
    if (activeDrag.isGroupDrag) {
        if (!activeDrag.isDocked) {
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

                // Check if user dragged group window over another window's tab bar
                const target = findTargetWindowForReattach(
                    activeDrag.sourceContext.window.id,
                    screenX,
                    screenY,
                    activeDrag.sourceContext
                );
                if (target) {
                    dockGroupIntoWindow(target.targetContext, screenX, screenY);
                    try {
                        if (win && !win.isDestroyed()) {
                            win.setAlwaysOnTop(false);
                            win.hide();
                        }
                    } catch (_) { }
                    activeDrag.isSingleTabDrag = false;
                }
            } else {
                const win = activeDrag.detachedWindow;
                if (win && !win.isDestroyed()) {
                    const padLeft = getTabStripPaddingLeft();
                    win.setPosition(
                        Math.round(screenX - activeDrag.grabOffsetX - padLeft),
                        Math.round(screenY - activeDrag.grabOffsetY - 5)
                    );
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
                    dockGroupIntoWindow(target.targetContext, screenX, screenY);
                }
            }
        }
        return;
    }

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

function dockGroupIntoWindow(targetContext, screenX, screenY) {
    if (!activeDrag || !activeDrag.isGroupDrag) return;
    if (!targetContext || !targetContext.window || targetContext.window.isDestroyed()) return;
    if (activeDrag.currentContext === targetContext && activeDrag.isDocked) return;

    const tabManager = require('./tabManager');
    const { group, memberTabIds, memberTabsData, memberViews } = activeDrag;

    // Hide temporary detached window while docked
    if (activeDrag.detachedWindow && !activeDrag.detachedWindow.isDestroyed()) {
        try {
            if (typeof activeDrag.detachedWindow.setAlwaysOnTop === 'function') {
                activeDrag.detachedWindow.setAlwaysOnTop(false);
            }
            activeDrag.detachedWindow.hide();
        } catch (_) { }
    }

    if (!targetContext.tabs) targetContext.tabs = {};
    if (!targetContext.tabGroups) targetContext.tabGroups = {};
    if (!Array.isArray(targetContext.tabOrder)) targetContext.tabOrder = [];

    targetContext.tabGroups[group.id] = { ...group };

    for (const tid of memberTabIds) {
        const v = memberViews?.[tid] || activeDrag.currentContext?.tabs?.[tid] || activeDrag.sourceContext?.tabs?.[tid];
        if (v && !v.webContents.isDestroyed()) {
            if (activeDrag.currentContext && activeDrag.currentContext !== targetContext) {
                try {
                    tabManager.removeTabContentChildView(activeDrag.currentContext, v);
                    delete activeDrag.currentContext.tabs?.[tid];
                } catch (_) { }
            }
            if (activeDrag.sourceContext && activeDrag.sourceContext !== targetContext) {
                try {
                    tabManager.removeTabContentChildView(activeDrag.sourceContext, v);
                    delete activeDrag.sourceContext.tabs?.[tid];
                } catch (_) { }
            }
            targetContext.tabs[tid] = v;
            State.tabIdToWindowId.set(tid, targetContext.window.id);
            State.webContentsIdToTabId.set(v.webContents.id, tid);
            if (!targetContext.tabOrder.includes(tid)) {
                targetContext.tabOrder.push(tid);
            }
            tabManager.addTabContentChildView(targetContext, v);
        }
    }

    const primaryId = activeDrag.activeTabId || memberTabIds[0];
    targetContext.activeTabId = primaryId;
    tabManager.layoutActiveTabView(targetContext, primaryId);

    // Notify target window's React shell to insert the group and its member tabs
    if (targetContext.window.webContents && !targetContext.window.webContents.isDestroyed()) {
        targetContext.window.webContents.send(C.IPC_EVENT.TAB_REATTACHED, {
            group,
            tabs: memberTabsData,
            screenX,
            screenY,
        });
    }

    activeDrag.currentContext = targetContext;
    activeDrag.isDocked = true;
}

function dockTabIntoWindow(targetContext, screenX, screenY) {
    if (!activeDrag || !targetContext || !targetContext.window || targetContext.window.isDestroyed()) return;
    if (activeDrag.currentContext === targetContext && activeDrag.isDocked) return;

    const tabManager = require('./tabManager');
    const splitTabManager = require('./splitTabManager');

    // Hide temporary detached window while docked
    if (activeDrag.detachedWindow && !activeDrag.detachedWindow.isDestroyed()) {
        try {
            if (typeof activeDrag.detachedWindow.setAlwaysOnTop === 'function') {
                activeDrag.detachedWindow.setAlwaysOnTop(false);
            }
            activeDrag.detachedWindow.hide();
        } catch (_) { }
    }

    if (activeDrag.splitPair) {
        const { splitPair, leftTabId, rightTabId, leftView, rightView, leftTabData, rightTabData } = activeDrag;

        // Remove from current context
        if (activeDrag.currentContext) {
            try {
                if (leftView) tabManager.removeTabContentChildView(activeDrag.currentContext, leftView);
                if (rightView) tabManager.removeTabContentChildView(activeDrag.currentContext, rightView);
                delete activeDrag.currentContext.tabs?.[leftTabId];
                if (rightTabId) delete activeDrag.currentContext.tabs?.[rightTabId];
                if (Array.isArray(activeDrag.currentContext.tabOrder)) {
                    activeDrag.currentContext.tabOrder = activeDrag.currentContext.tabOrder.filter(tid => tid !== leftTabId && tid !== rightTabId);
                }
                if (activeDrag.currentContext.splitPairs) {
                    activeDrag.currentContext.splitPairs.delete(splitPair.id);
                }
            } catch (_) { }
        }

        // Remove any full-screen view from targetContext so it doesn't linger under split view
        if (targetContext.tabs) {
            for (const tid of Object.keys(targetContext.tabs)) {
                if (tid !== leftTabId && tid !== rightTabId) {
                    try {
                        tabManager.removeTabContentChildView(targetContext, targetContext.tabs[tid]);
                    } catch (_) { }
                }
            }
        }

        // Add to target context
        if (!targetContext.tabs) targetContext.tabs = {};
        if (!Array.isArray(targetContext.tabOrder)) targetContext.tabOrder = [];

        if (leftView && !leftView.webContents.isDestroyed()) {
            targetContext.tabs[leftTabId] = leftView;
            State.tabIdToWindowId.set(leftTabId, targetContext.window.id);
            State.webContentsIdToTabId.set(leftView.webContents.id, leftTabId);
            if (!targetContext.tabOrder.includes(leftTabId)) targetContext.tabOrder.push(leftTabId);
            tabManager.addTabContentChildView(targetContext, leftView);
        }

        if (rightTabId && rightView && !rightView.webContents.isDestroyed()) {
            targetContext.tabs[rightTabId] = rightView;
            State.tabIdToWindowId.set(rightTabId, targetContext.window.id);
            State.webContentsIdToTabId.set(rightView.webContents.id, rightTabId);
            if (!targetContext.tabOrder.includes(rightTabId)) targetContext.tabOrder.push(rightTabId);
            tabManager.addTabContentChildView(targetContext, rightView);
        }

        if (!targetContext.splitPairs) targetContext.splitPairs = new Map();
        targetContext.splitPairs.set(splitPair.id, { ...splitPair });

        const activeId = (splitPair.focusedSide === 'right' && rightTabId) ? rightTabId : leftTabId;
        targetContext.activeTabId = activeId;

        splitTabManager.layoutSplitTabViews(targetContext, splitPair);

        // Update live favicons / loading state if available
        if (leftView && !leftView.webContents.isDestroyed() && leftTabData) {
            if (leftView._favicon) leftTabData.favicon = leftView._favicon;
            if (typeof leftView.webContents.isLoading === 'function') leftTabData.isLoading = leftView.webContents.isLoading();
        }
        if (rightView && !rightView.webContents.isDestroyed() && rightTabData) {
            if (rightView._favicon) rightTabData.favicon = rightView._favicon;
            if (typeof rightView.webContents.isLoading === 'function') rightTabData.isLoading = rightView.webContents.isLoading();
        }

        if (targetContext.window.webContents && !targetContext.window.webContents.isDestroyed()) {
            targetContext.window.webContents.send(C.IPC_EVENT.TAB_REATTACHED, {
                splitPair,
                leftTab: leftTabData,
                rightTab: rightTabData,
                screenX,
                screenY,
            });
            splitTabManager.broadcastSplitUpdate(targetContext, splitPair);
        }

        activeDrag.currentContext = targetContext;
        activeDrag.isDocked = true;
        return;
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
    const splitTabManager = require('./splitTabManager');

    if (activeDrag.splitPair) {
        const { splitPair, leftTabId, rightTabId, leftView, rightView } = activeDrag;

        // Remove tab from previously docked window
        if (activeDrag.currentContext && activeDrag.currentContext !== activeDrag.detachedContext) {
            const win = activeDrag.currentContext.window;
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('tab-closed-external', { id: leftTabId });
                if (rightTabId) win.webContents.send('tab-closed-external', { id: rightTabId });
            }
            try {
                if (leftView) tabManager.removeTabContentChildView(activeDrag.currentContext, leftView);
                if (rightView) tabManager.removeTabContentChildView(activeDrag.currentContext, rightView);
                delete activeDrag.currentContext.tabs?.[leftTabId];
                if (rightTabId) delete activeDrag.currentContext.tabs?.[rightTabId];
                if (Array.isArray(activeDrag.currentContext.tabOrder)) {
                    activeDrag.currentContext.tabOrder = activeDrag.currentContext.tabOrder.filter(tid => tid !== leftTabId && tid !== rightTabId);
                }
                if (activeDrag.currentContext.splitPairs) {
                    activeDrag.currentContext.splitPairs.delete(splitPair.id);
                }
            } catch (_) { }
        }

        // Transfer view back to detached window
        if (!activeDrag.detachedContext.tabs) activeDrag.detachedContext.tabs = {};
        if (!Array.isArray(activeDrag.detachedContext.tabOrder)) activeDrag.detachedContext.tabOrder = [];

        if (leftView && !leftView.webContents.isDestroyed()) {
            activeDrag.detachedContext.tabs[leftTabId] = leftView;
            State.tabIdToWindowId.set(leftTabId, activeDrag.detachedContext.window.id);
            if (!activeDrag.detachedContext.tabOrder.includes(leftTabId)) activeDrag.detachedContext.tabOrder.push(leftTabId);
            tabManager.addTabContentChildView(activeDrag.detachedContext, leftView);
        }
        if (rightTabId && rightView && !rightView.webContents.isDestroyed()) {
            activeDrag.detachedContext.tabs[rightTabId] = rightView;
            State.tabIdToWindowId.set(rightTabId, activeDrag.detachedContext.window.id);
            if (!activeDrag.detachedContext.tabOrder.includes(rightTabId)) activeDrag.detachedContext.tabOrder.push(rightTabId);
            tabManager.addTabContentChildView(activeDrag.detachedContext, rightView);
        }

        if (!activeDrag.detachedContext.splitPairs) activeDrag.detachedContext.splitPairs = new Map();
        activeDrag.detachedContext.splitPairs.set(splitPair.id, { ...splitPair });

        const activeId = (splitPair.focusedSide === 'right' && rightTabId) ? rightTabId : leftTabId;
        activeDrag.detachedContext.activeTabId = activeId;
        splitTabManager.layoutSplitTabViews(activeDrag.detachedContext, splitPair);

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
        return;
    }

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

    if (activeDrag.isGroupDrag) {
        const { detachedWindow, isSingleTabDrag, currentContext, isDocked } = activeDrag;
        if (isDocked) {
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
                    const actView = currentContext?.tabs?.[currentContext.activeTabId];
                    if (actView && !actView.webContents.isDestroyed()) {
                        actView.webContents.focus();
                    }
                } catch (_) { }
            }
            activeDrag = null;
            return { ok: true };
        }

        if (!isSingleTabDrag && detachedWindow && !detachedWindow.isDestroyed()) {
            try {
                if (typeof detachedWindow.setAlwaysOnTop === 'function') {
                    detachedWindow.setAlwaysOnTop(false);
                }
                if (typeof detachedWindow.setFocusable === 'function') {
                    detachedWindow.setFocusable(true);
                }
                detachedWindow.focus();
                const actView = currentContext?.tabs?.[currentContext.activeTabId];
                if (actView && !actView.webContents.isDestroyed()) {
                    actView.webContents.focus();
                }
            } catch (_) { }
        } else if (isSingleTabDrag) {
            try {
                if (activeDrag.sourceContext?.window && !activeDrag.sourceContext.window.isDestroyed()) {
                    if (typeof activeDrag.sourceContext.window.setAlwaysOnTop === 'function') {
                        activeDrag.sourceContext.window.setAlwaysOnTop(false);
                    }
                }
            } catch (_) { }
        }
        activeDrag = null;
        return { ok: true };
    }

    const { isSingleTabDrag, isDocked, detachedWindow, currentContext, view, splitPair, leftView, rightView } = activeDrag;

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
                const activeFocusView = (splitPair && splitPair.focusedSide === 'right' && rightView) ? rightView : (leftView || view);
                if (activeFocusView && !activeFocusView.webContents.isDestroyed()) {
                    activeFocusView.webContents.focus();
                }
                if (splitPair) {
                    const splitTabManager = require('./splitTabManager');
                    splitTabManager.layoutSplitTabViews(currentContext, splitPair);
                    splitTabManager.broadcastSplitUpdate(currentContext, splitPair);
                } else if (currentContext.window.webContents && !currentContext.window.webContents.isDestroyed() && activeDrag.tabData?.favicon) {
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
                const activeFocusView = (splitPair && splitPair.focusedSide === 'right' && rightView) ? rightView : (leftView || view);
                if (activeFocusView && !activeFocusView.webContents.isDestroyed()) {
                    activeFocusView.webContents.focus();
                }
                if (splitPair) {
                    const splitTabManager = require('./splitTabManager');
                    splitTabManager.layoutSplitTabViews(activeDrag.detachedContext, splitPair);
                    splitTabManager.broadcastSplitUpdate(activeDrag.detachedContext, splitPair);
                } else if (detachedWindow.webContents && !detachedWindow.webContents.isDestroyed() && activeDrag.tabData?.favicon) {
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
