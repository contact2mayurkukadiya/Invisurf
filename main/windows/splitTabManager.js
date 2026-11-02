const { UI_HEIGHT } = require('../constants/defaults');
const C = require('../../src/constants/conditionStrings.cjs');
const State = require('../state');
const { resolveTabLoadUrl } = require('../utils/navigation');

let splitCounter = 0;

function ensureSplitContext(context) {
    if (!context) return null;
    if (!context.splitPairs) {
        context.splitPairs = new Map();
    }
    return context.splitPairs;
}

function getSplitPair(context, splitId) {
    const pairs = ensureSplitContext(context);
    return pairs ? pairs.get(splitId) || null : null;
}

function getSplitPairByTabId(context, tabId) {
    const pairs = ensureSplitContext(context);
    if (!pairs || !tabId) return null;
    for (const pair of pairs.values()) {
        if (pair.leftTabId === tabId || pair.rightTabId === tabId) {
            return pair;
        }
    }
    return null;
}

function isTabInSplit(context, tabId) {
    return !!getSplitPairByTabId(context, tabId);
}

function clampRatio(val) {
    const num = Number(val);
    if (isNaN(num)) return 0.5;
    return Math.max(0.2, Math.min(0.8, num));
}

function broadcastSplitUpdate(context, pair, options = {}) {
    if (!context?.window || context.window.isDestroyed()) return;
    const wc = context.window.webContents;
    if (!wc || wc.isDestroyed()) return;

    wc.send(C.IPC_EVENT.SPLIT_TAB_UPDATED, {
        splitId: pair ? pair.id : null,
        removed: options.removed === true,
        pair: pair && !options.removed ? {
            id: pair.id,
            leftTabId: pair.leftTabId,
            rightTabId: pair.rightTabId,
            ratio: pair.ratio,
            focusedSide: pair.focusedSide,
            isChoosing: !!pair.isChoosing,
            isSwapped: !!pair.isSwapped,
        } : null,
    });
}

function layoutSplitTabViews(context, splitId) {
    if (!context?.window || context.window.isDestroyed()) return;
    const pair = typeof splitId === 'string' ? getSplitPair(context, splitId) : splitId;
    if (!pair) return;

    const leftView = context.tabs?.[pair.leftTabId];
    if (!leftView || leftView.webContents?.isDestroyed()) {
        return;
    }
    const rightView = pair.rightTabId ? context.tabs?.[pair.rightTabId] : null;

    try {
        const { width, height } = context.window.getContentBounds();
        const isFullscreen = context.window.isFullScreen();
        const contentTop = isFullscreen ? 0 : UI_HEIGHT;
        const contentHeight = isFullscreen ? height : Math.max(0, height - UI_HEIGHT);

        const { getSidePanelWidth } = require('./sidePanelManager');
        const sidePanelWidth = getSidePanelWidth(context) || 0;
        const availableTotalWidth = Math.max(0, width - sidePanelWidth);

        // Visual spacing between and around panes matching side panel card design
        const leftMargin = isFullscreen ? 0 : 8;
        const topMargin = isFullscreen ? 0 : 4;
        const bottomMargin = isFullscreen ? 0 : 8;
        const rightMargin = isFullscreen ? 0 : (sidePanelWidth > 0 ? 6 : 8);
        const paneGap = isFullscreen ? 2 : 8; // Spacing between the two panes

        const usableTotalWidth = Math.max(0, availableTotalWidth - leftMargin - rightMargin - paneGap);
        const minViewWidth = 240;

        let leftWidth = Math.floor(usableTotalWidth * (pair.ratio || 0.5));
        let rightWidth = usableTotalWidth - leftWidth;

        if (usableTotalWidth >= minViewWidth * 2) {
            if (leftWidth < minViewWidth) {
                leftWidth = minViewWidth;
                rightWidth = usableTotalWidth - leftWidth;
            } else if (rightWidth < minViewWidth) {
                rightWidth = minViewWidth;
                leftWidth = usableTotalWidth - rightWidth;
            }
        }

        const leftX = leftMargin;
        const rightX = leftMargin + leftWidth + paneGap;
        const contentY = contentTop + topMargin;
        const paneHeight = Math.max(0, contentHeight - topMargin - bottomMargin);

        const { setNativeViewCornerRadius } = require('./tabManager');
        const cornerRadius = isFullscreen ? 0 : 14;

        // Content view side swapping:
        // When pair.isSwapped is true, viewOnLeft is rightView and viewOnRight is leftView.
        const isSwapped = !!pair.isSwapped;
        const viewOnLeft = isSwapped ? rightView : leftView;
        const viewOnRight = isSwapped ? leftView : rightView;

        if (viewOnLeft && !viewOnLeft.webContents?.isDestroyed()) {
            viewOnLeft.setBounds({
                x: leftX,
                y: contentY,
                width: Math.max(0, leftWidth),
                height: paneHeight,
            });
            setNativeViewCornerRadius(viewOnLeft, cornerRadius);
        }

        if (viewOnRight && !viewOnRight.webContents?.isDestroyed()) {
            viewOnRight.setBounds({
                x: rightX,
                y: contentY,
                width: Math.max(0, rightWidth),
                height: paneHeight,
            });
            setNativeViewCornerRadius(viewOnRight, cornerRadius);
        }

        if (context.tabContentView && typeof context.tabContentView.setBackgroundColor === 'function') {
            context.tabContentView.setBackgroundColor('#00000000');
        }
    } catch (err) {
        console.warn('layoutSplitTabViews error:', err?.message || err);
    }
}

function enterSplitView(context, leftTabId, maybeRightTabId = null, options = {}) {
    if (!context || !leftTabId || !context.tabs?.[leftTabId]) return null;
    ensureSplitContext(context);

    // If left tab was already in a split pair, dissolve old split first
    const existing = getSplitPairByTabId(context, leftTabId);
    if (existing) {
        exitSplitView(context, existing.id, { activateRemaining: false });
    }

    const tabManager = require('./tabManager');
    const isChoosing = !maybeRightTabId || maybeRightTabId === 'choose-tab' || maybeRightTabId === 'new-tab' || (!context.tabs[maybeRightTabId] && !context.sleepingTabs?.[maybeRightTabId]);

    let rightTabId = null;
    if (!isChoosing) {
        rightTabId = maybeRightTabId;
        // If the right tab was sleeping, wake it up first
        if (!context.tabs[rightTabId] && context.sleepingTabs?.[rightTabId]) {
            const sleep = context.sleepingTabs[rightTabId];
            const resolvedUrl = resolveTabLoadUrl(sleep.url);
            const sleepHistory = sleep.history || null;
            delete context.sleepingTabs[rightTabId];
            tabManager.createTab(context, rightTabId, resolvedUrl, !!context.stealthWindow, {
                navigationHistory: sleepHistory,
                activate: false,
            });
            if (context.window && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send(C.IPC_EVENT.TAB_AWOKEN, { id: rightTabId });
            }
        }
        const rightExisting = getSplitPairByTabId(context, rightTabId);
        if (rightExisting) {
            exitSplitView(context, rightExisting.id, { activateRemaining: false });
        }
    }

    const splitId = `split-${Date.now()}-${++splitCounter}`;
    const initialFocusedSide = isChoosing ? 'left' : (options.focusedSide || 'left');

    const splitPair = {
        id: splitId,
        leftTabId,
        rightTabId: isChoosing ? null : rightTabId,
        ratio: 0.5,
        focusedSide: initialFocusedSide,
        isChoosing,
        isSwapped: false,
    };

    context.splitPairs.set(splitId, splitPair);

    // Remove any view that is not part of this split view (e.g. previous active tab's full-screen view)
    for (const tid of Object.keys(context.tabs || {})) {
        if (tid !== leftTabId && (isChoosing || tid !== rightTabId)) {
            try {
                tabManager.removeTabContentChildView(context, context.tabs[tid]);
            } catch (_) { }
        }
    }

    const leftView = context.tabs[leftTabId];
    if (leftView) tabManager.addTabContentChildView(context, leftView);

    if (!isChoosing && rightTabId) {
        if (Array.isArray(context.tabOrder) && leftTabId) {
            context.tabOrder = context.tabOrder.filter(id => id !== rightTabId);
            const leftIdx = context.tabOrder.indexOf(leftTabId);
            if (leftIdx !== -1) {
                context.tabOrder.splice(leftIdx + 1, 0, rightTabId);
            } else {
                context.tabOrder.push(rightTabId);
            }
        }
        const rightView = context.tabs[rightTabId];
        if (rightView) tabManager.addTabContentChildView(context, rightView);
    }

    context.activeTabId = leftTabId;

    layoutSplitTabViews(context, splitPair);

    if (leftView?.webContents && !leftView.webContents.isDestroyed()) {
        leftView.webContents.focus();
    }

    broadcastSplitUpdate(context, splitPair);

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id: context.activeTabId });
    }

    return splitPair;
}

function selectTabForSplit(context, splitId, targetTabId) {
    if (!context || !splitId) return false;
    const pair = getSplitPair(context, splitId);
    if (!pair) return false;

    const tabManager = require('./tabManager');

    let chosenTabId = targetTabId;
    if (chosenTabId === 'new-tab' || (!context.tabs[chosenTabId] && !context.sleepingTabs?.[chosenTabId])) {
        splitCounter += 1;
        chosenTabId = `tab-split-${Date.now()}-${splitCounter}`;
        const isStealth = !!context.stealthWindow;
        tabManager.createTab(context, chosenTabId, C.URL.NTP_DISPLAY, isStealth, { activate: false });
        if (context.window && !context.window.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, {
                id: chosenTabId,
                isStealth,
                url: C.URL.NTP_DISPLAY,
            });
        }
    } else {
        // If the selected tab was sleeping in background, wake it first
        if (!context.tabs[chosenTabId] && context.sleepingTabs?.[chosenTabId]) {
            const sleep = context.sleepingTabs[chosenTabId];
            const resolvedUrl = resolveTabLoadUrl(sleep.url);
            const sleepHistory = sleep.history || null;
            delete context.sleepingTabs[chosenTabId];
            tabManager.createTab(context, chosenTabId, resolvedUrl, !!context.stealthWindow, {
                navigationHistory: sleepHistory,
                activate: false,
            });
            if (context.window && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send(C.IPC_EVENT.TAB_AWOKEN, { id: chosenTabId });
            }
        }
        const existing = getSplitPairByTabId(context, chosenTabId);
        if (existing && existing.id !== splitId) {
            exitSplitView(context, existing.id, { activateRemaining: false });
        }
    }

    pair.rightTabId = chosenTabId;
    pair.isChoosing = false;
    pair.focusedSide = 'right';

    // Place chosenTabId immediately adjacent to pair.leftTabId in context.tabOrder
    if (Array.isArray(context.tabOrder) && pair.leftTabId) {
        context.tabOrder = context.tabOrder.filter(id => id !== chosenTabId);
        const leftIdx = context.tabOrder.indexOf(pair.leftTabId);
        if (leftIdx !== -1) {
            context.tabOrder.splice(leftIdx + 1, 0, chosenTabId);
        } else {
            context.tabOrder.push(chosenTabId);
        }
    }

    const rightView = context.tabs[chosenTabId];
    if (rightView) {
        tabManager.removeTabContentChildView(context, rightView);
        tabManager.addTabContentChildView(context, rightView);
        tabManager.resetTabWebContentsScale(rightView);
    }

    context.activeTabId = chosenTabId;
    layoutSplitTabViews(context, pair);

    if (rightView?.webContents && !rightView.webContents.isDestroyed()) {
        try { rightView.webContents.focus(); } catch (_) { }
    }

    broadcastSplitUpdate(context, pair);

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id: context.activeTabId });
        const currentZoom = typeof rightView?.webContents?.getZoomFactor === 'function' ? rightView.webContents.getZoomFactor() : 1.0;
        const currentUrl = typeof rightView?.webContents?.getURL === 'function' ? rightView.webContents.getURL() : '';
        const currentTitle = typeof rightView?.webContents?.getTitle === 'function' ? rightView.webContents.getTitle() : '';
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
            id: chosenTabId,
            url: currentUrl,
            title: currentTitle,
            zoomFactor: currentZoom,
        });
    }

    return true;
}

function exitSplitView(context, splitId, options = {}) {
    if (!context) return false;
    let pair = getSplitPair(context, splitId);
    if (!pair) {
        pair = getSplitPairByTabId(context, splitId);
    }
    if (!pair) return false;

    context.splitPairs.delete(pair.id);

    const tabManager = require('./tabManager');
    const { leftTabId, rightTabId } = pair;
    const targetTabId = options.keepTabId || (context.activeTabId === rightTabId ? rightTabId : leftTabId);
    const otherTabId = targetTabId === leftTabId ? rightTabId : leftTabId;

    // Reset native view corner radius and scale on both views
    const leftView = leftTabId ? context.tabs[leftTabId] : null;
    const rightView = rightTabId ? context.tabs[rightTabId] : null;

    if (leftView) {
        if (typeof tabManager.setNativeViewCornerRadius === 'function') {
            tabManager.setNativeViewCornerRadius(leftView, 0);
        }
        tabManager.resetTabWebContentsScale(leftView);
    }
    if (rightView) {
        if (typeof tabManager.setNativeViewCornerRadius === 'function') {
            tabManager.setNativeViewCornerRadius(rightView, 0);
        }
        tabManager.resetTabWebContentsScale(rightView);
    }

    // If options.closeOther is requested (e.g. user closed one side)
    if (options.closeOtherSide) {
        if (otherTabId) {
            tabManager.closeTab(context, otherTabId);
        }
    } else if (rightTabId) {
        // "Separate tabs": ensure both tabs stay open adjacent to each other in tabOrder
        if (Array.isArray(context.tabOrder)) {
            context.tabOrder = context.tabOrder.filter(id => id !== rightTabId);
            const leftIdx = context.tabOrder.indexOf(leftTabId);
            if (leftIdx !== -1) {
                context.tabOrder.splice(leftIdx + 1, 0, rightTabId);
            } else {
                context.tabOrder.push(rightTabId);
            }
        }
        // Remove the inactive tab's view from tabContentView so it doesn't linger in native hierarchy
        if (otherTabId && context.tabs[otherTabId]) {
            try {
                tabManager.removeTabContentChildView(context, context.tabs[otherTabId]);
            } catch (_) { }
        }
    }

    broadcastSplitUpdate(context, { id: pair.id }, { removed: true });

    if (options.activateRemaining !== false && targetTabId && context.tabs[targetTabId]) {
        tabManager.activateTab(context, targetTabId, { force: true });
    }

    return true;
}

function setSplitRatio(context, splitId, rawRatio) {
    const pair = getSplitPair(context, splitId);
    if (!pair) return false;

    pair.ratio = clampRatio(rawRatio);
    layoutSplitTabViews(context, pair);
    broadcastSplitUpdate(context, pair);
    return true;
}

function swapSplitSides(context, splitId) {
    const pair = getSplitPair(context, splitId);
    if (!pair) return false;

    // Do NOT reorder context.tabOrder or swap pair.leftTabId/pair.rightTabId.
    // The tab bar position remains exactly unchanged, and ONLY content view panes switch sides.
    pair.isSwapped = !pair.isSwapped;
    pair.focusedSide = pair.focusedSide === 'left' ? 'right' : 'left';

    layoutSplitTabViews(context, pair);
    broadcastSplitUpdate(context, pair);

    const activeTabId = pair.focusedSide === 'left' ? pair.leftTabId : pair.rightTabId;
    if (activeTabId) {
        context.activeTabId = activeTabId;
        const targetView = context.tabs[activeTabId];
        if (targetView?.webContents && !targetView.webContents.isDestroyed()) {
            try { targetView.webContents.focus(); } catch (_) { }
        }
        if (context.window && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id: activeTabId });
            const currentZoom = typeof targetView?.webContents?.getZoomFactor === 'function' ? targetView.webContents.getZoomFactor() : 1.0;
            const currentUrl = typeof targetView?.webContents?.getURL === 'function' ? targetView.webContents.getURL() : '';
            const currentTitle = typeof targetView?.webContents?.getTitle === 'function' ? targetView.webContents.getTitle() : '';
            context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
                id: activeTabId,
                url: currentUrl,
                title: currentTitle,
                zoomFactor: currentZoom,
            });
        }
    }

    return true;
}

function setFocusedSplitSide(context, splitId, side) {
    const pair = getSplitPair(context, splitId);
    if (!pair || (side !== 'left' && side !== 'right')) return false;

    pair.focusedSide = side;
    const targetTabId = side === 'left' ? pair.leftTabId : pair.rightTabId;
    if (!targetTabId) {
        broadcastSplitUpdate(context, pair);
        return true;
    }
    context.activeTabId = targetTabId;

    const targetView = context.tabs[targetTabId];
    if (targetView?.webContents && !targetView.webContents.isDestroyed()) {
        try { targetView.webContents.focus(); } catch (_) { }
    }

    broadcastSplitUpdate(context, pair);

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id: targetTabId });
        const currentZoom = typeof targetView?.webContents?.getZoomFactor === 'function' ? targetView.webContents.getZoomFactor() : 1.0;
        const currentUrl = typeof targetView?.webContents?.getURL === 'function' ? targetView.webContents.getURL() : '';
        const currentTitle = typeof targetView?.webContents?.getTitle === 'function' ? targetView.webContents.getTitle() : '';
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, {
            id: targetTabId,
            url: currentUrl,
            title: currentTitle,
            zoomFactor: currentZoom,
        });
    }

    return true;
}

function handleTabDestroyed(context, tabId) {
    if (!context || !tabId) return;
    const pair = getSplitPairByTabId(context, tabId);
    if (!pair) return;

    const remainingTabId = pair.leftTabId === tabId ? pair.rightTabId : pair.leftTabId;
    context.splitPairs.delete(pair.id);
    broadcastSplitUpdate(context, { id: pair.id }, { removed: true });

    if (remainingTabId && context.tabs[remainingTabId]) {
        const tabManager = require('./tabManager');
        const remainingView = context.tabs[remainingTabId];
        if (remainingView) {
            if (typeof tabManager.setNativeViewCornerRadius === 'function') {
                tabManager.setNativeViewCornerRadius(remainingView, 0);
            }
            tabManager.resetTabWebContentsScale(remainingView);
        }
        tabManager.activateTab(context, remainingTabId, { force: true });
    }
}

function hideSplitViewsForShellOverlay(context, splitId) {
    const pair = getSplitPair(context, splitId);
    if (!pair) return;
    const tabManager = require('./tabManager');

    const leftView = context.tabs[pair.leftTabId];
    const rightView = context.tabs[pair.rightTabId];

    if (leftView) {
        try { tabManager.removeTabContentChildView(context, leftView); } catch (_) { }
        try { leftView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) { }
    }
    if (rightView) {
        try { tabManager.removeTabContentChildView(context, rightView); } catch (_) { }
        try { rightView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) { }
    }
}

function restoreSplitViewsFromShellOverlay(context, splitId) {
    const pair = getSplitPair(context, splitId);
    if (!pair) return;
    const tabManager = require('./tabManager');

    const leftView = context.tabs[pair.leftTabId];
    const rightView = context.tabs[pair.rightTabId];

    if (leftView) tabManager.addTabContentChildView(context, leftView);
    if (rightView) tabManager.addTabContentChildView(context, rightView);

    layoutSplitTabViews(context, pair);
}

module.exports = {
    getSplitPair,
    getSplitPairByTabId,
    isTabInSplit,
    enterSplitView,
    selectTabForSplit,
    exitSplitView,
    setSplitRatio,
    swapSplitSides,
    setFocusedSplitSide,
    layoutSplitTabViews,
    handleTabDestroyed,
    hideSplitViewsForShellOverlay,
    restoreSplitViewsFromShellOverlay,
    broadcastSplitUpdate,
};
