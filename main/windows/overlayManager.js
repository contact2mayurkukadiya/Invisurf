
const { WebContentsView } = require('electron');
const path = require('path');
const State = require('../state');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');
const { isViewWebContentsAlive } = require('./windowContextUtils');
const { sendChromeOverlayThemePatch, sendChromeOmniboxOverlayThemePatch, sendChromeShellMenuOverlayThemePatch } = require('../services/settingsService');
const C = require('../../src/constants/conditionStrings.cjs');

function createChromeOverlayLayer(context) {
    if (context.chromeOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeOverlayThemePatch(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html').catch((err) => {
        console.error('chrome-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOverlayView = overlayView;
}

function createChromeOmniboxOverlayLayer(context) {
    if (context.chromeOmniboxOverlayView) return;
    context.chromeOmniboxOverlayReady = false;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        context.chromeOmniboxOverlayReady = true;
        sendChromeOmniboxOverlayThemePatch(context);
        replayOmniboxOverlayPatchIfNeeded(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissOmniboxChromeOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?omnibox=1').catch((err) => {
        console.error('chrome-omnibox-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOmniboxOverlayView = overlayView;
}

function createChromeShellMenuOverlayLayer(context) {
    if (context.chromeShellMenuOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeShellMenuOverlayThemePatch(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissChromeShellMenuOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?shellMenu=1').catch((err) => {
        console.error('chrome-shell-menu-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeShellMenuOverlayView = overlayView;
}

function createTooltipOverlay(context) {
    const tooltipView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });

    applyIdentityToWebContents(tooltipView.webContents);
    tooltipView.setBackgroundColor('#00000000'); // Transparent background
    tooltipView.webContents.loadURL('app://localhost/tooltip.html');

    // Add it last so it's on top of all other views
    context.window.contentView.addChildView(tooltipView);
    tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // Hide initially
    context.tooltipView = tooltipView;
}

function createStatusBubbleOverlay(context) {
    if (context.statusBubbleView) return;
    const view = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(view.webContents);
    view.setBackgroundColor('#00000000');
    view.webContents.loadURL('app://localhost/status-bubble.html').catch((err) => {
        console.error('status-bubble load', err);
    });
    context.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.statusBubbleView = view;
    context.statusBubbleState = {
        url: '',
        side: 'left',
        width: 0,
        height: 24,
        isLoaded: false,
    };
    view.webContents.once('did-finish-load', () => {
        if (context.statusBubbleState) {
            context.statusBubbleState.isLoaded = true;
            try {
                const settingsService = require('../services/settingsService');
                const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
                view.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_THEME, themePatch);
            } catch (_) {}
            if (context.statusBubbleState.url) {
                updateStatusBubble(context, context.statusBubbleState.url);
            }
        }
    });
}

function getStatusBubbleBounds(context) {
    if (!context?.window || context.window.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
    const state = context.statusBubbleState;
    if (!state || !state.url) return { x: 0, y: 0, width: 0, height: 0 };

    const winBounds = context.window.getContentBounds();
    const windowW = Math.max(1, winBounds.width);
    const windowH = Math.max(1, winBounds.height);
    const maxBubbleWidth = Math.max(100, Math.floor(windowW * 0.5));
    const bubbleHeight = 24;

    const baseWidth = state.width > 0
        ? state.width
        : Math.max(120, Math.ceil(state.url.length * 7.2) + 20);
    const bubbleWidth = Math.min(maxBubbleWidth, Math.max(60, baseWidth));

    const x = state.side === 'left' ? 0 : Math.max(0, windowW - bubbleWidth);
    const y = Math.max(0, windowH - bubbleHeight);

    return { x, y, width: bubbleWidth, height: bubbleHeight };
}

function updateStatusBubble(context, targetUrl) {
    if (!context?.window || context.window.isDestroyed()) return;
    if (!context.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) {
        createStatusBubbleOverlay(context);
    }
    if (!context.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) return;

    if (!context.statusBubbleState) {
        context.statusBubbleState = { url: '', side: 'left', width: 0, height: 24, isLoaded: false };
    }

    const cleanUrl = typeof targetUrl === 'string' ? targetUrl.trim() : '';
    if (!cleanUrl) {
        context.statusBubbleState.url = '';
        context.statusBubbleState.side = 'left';
        context.statusBubbleState.width = 0;
        try {
            context.statusBubbleView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            if (context.statusBubbleState.isLoaded) {
                context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_UPDATE, { url: '' });
            }
        } catch (_) {}
        return;
    }

    if (context.statusBubbleState.url !== cleanUrl) {
        context.statusBubbleState.width = 0;
    }
    context.statusBubbleState.url = cleanUrl;
    const bounds = getStatusBubbleBounds(context);

    try {
        const cv = context.window.contentView;
        cv.addChildView(context.statusBubbleView);
        if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOmniboxOverlayView);
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeShellMenuOverlayView);
        }
        if (context.tooltipView && !context.tooltipView.webContents.isDestroyed()) {
            cv.addChildView(context.tooltipView);
        }
        context.statusBubbleView.setBounds(bounds);

        const sendUpdate = () => {
            if (!context.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) return;
            try {
                const settingsService = require('../services/settingsService');
                const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);

                context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_UPDATE, {
                    url: cleanUrl,
                    side: context.statusBubbleState.side,
                    theme: themePatch,
                });
            } catch (_) {}
        };

        if (context.statusBubbleView.webContents.isLoading()) {
            context.statusBubbleView.webContents.once('did-finish-load', sendUpdate);
        } else {
            sendUpdate();
        }
    } catch (_) {}
}

function flipStatusBubbleSide(context) {
    if (!context?.statusBubbleState || !context.statusBubbleState.url) return;
    context.statusBubbleState.side = context.statusBubbleState.side === 'left' ? 'right' : 'left';
    const bounds = getStatusBubbleBounds(context);
    try {
        if (context.statusBubbleView && !context.statusBubbleView.webContents.isDestroyed()) {
            context.statusBubbleView.setBounds(bounds);
            const settingsService = require('../services/settingsService');
            const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
            context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_UPDATE, {
                url: context.statusBubbleState.url,
                side: context.statusBubbleState.side,
                theme: themePatch,
            });
        }
    } catch (_) {}
}

function resizeStatusBubble(context, size) {
    if (!context?.statusBubbleState || !context.statusBubbleState.url) return;
    const reportedWidth = Number(size?.width);
    if (reportedWidth > 0 && Math.abs(reportedWidth - context.statusBubbleState.width) > 3) {
        context.statusBubbleState.width = reportedWidth;
        const bounds = getStatusBubbleBounds(context);
        try {
            if (context.statusBubbleView && !context.statusBubbleView.webContents.isDestroyed()) {
                context.statusBubbleView.setBounds(bounds);
            }
        } catch (_) {}
    }
}

function hideStatusBubble(context) {
    if (!context?.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) return;
    if (context.statusBubbleState) {
        context.statusBubbleState.url = '';
        context.statusBubbleState.side = 'left';
        context.statusBubbleState.width = 0;
    }
    try {
        context.statusBubbleView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_UPDATE, { url: '' });
    } catch (_) {}
}

function layoutStatusBubble(context) {
    if (!context?.statusBubbleState?.url) return;
    const bounds = getStatusBubbleBounds(context);
    try {
        if (context.statusBubbleView && !context.statusBubbleView.webContents.isDestroyed()) {
            context.statusBubbleView.setBounds(bounds);
        }
    } catch (_) {}
}

function sendStatusBubbleThemePatch(context) {
    if (!context?.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) return;
    try {
        const settingsService = require('../services/settingsService');
        const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
        context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_THEME, themePatch);
    } catch (_) {}
}

function createDownloadAttentionOverlay(context) {
    if (context.downloadAttentionView) return;
    const view = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(view.webContents);
    view.setBackgroundColor('#00000000');
    view.webContents.loadURL('app://localhost/download-attention.html').catch((err) => {
        console.error('download-attention load', err);
    });
    context.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.downloadAttentionView = view;
}

function showDownloadAttentionOverlay(context, rect) {
    if (!context?.window || context.window.isDestroyed()) return;
    if (!context.downloadAttentionView || context.downloadAttentionView.webContents.isDestroyed()) {
        createDownloadAttentionOverlay(context);
    }
    const cv = context.window.contentView;
    if (context.downloadAttentionView) {
        // Guarantee attention overlay is physically at the top of contentView (above tab content)
        try {
            cv.addChildView(context.downloadAttentionView);
        } catch (_) {}

        const w = 80;
        const h = 180;
        let x = Math.round((rect?.x || 0) + (rect?.width || 30) / 2 - w / 2);
        try {
            const winBounds = context.window.getContentBounds();
            x = Math.max(0, Math.min(x, winBounds.width - w));
        } catch (_) {}
        const y = Math.round(rect?.y || 0);

        context.downloadAttentionView.setBounds({ x, y, width: w, height: h });

        const sendPlay = () => {
            if (context.downloadAttentionView && !context.downloadAttentionView.webContents.isDestroyed()) {
                try {
                    const settingsService = require('../services/settingsService');
                    const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
                    context.downloadAttentionView.webContents.send('download-attention:play', themePatch);
                } catch (_) {}
            }
        };

        if (context.downloadAttentionView.webContents.isLoading()) {
            context.downloadAttentionView.webContents.once('did-finish-load', sendPlay);
        } else {
            sendPlay();
        }

        if (context.downloadAttentionTimer) clearTimeout(context.downloadAttentionTimer);
        context.downloadAttentionTimer = setTimeout(() => {
            if (context.downloadAttentionView && !context.downloadAttentionView.webContents.isDestroyed()) {
                context.downloadAttentionView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        }, 1300);
    }
}

function ensureChromeOverlayOnTop(context) {
    if (!context?.window?.contentView) return;
    const cv = context.window.contentView;
    const activeId = context.activeTabId;
    const tabView = activeId && !State.detachedTabWindows.has(activeId) ? context.tabs[activeId] : null;

    // Lazy loaded to avoid circular dependencies
    const { getLensSession } = require('./lensManager');
    const { layoutTabContentContainer, addTabContentChildView } = require('./tabManager');

    const lensSession = getLensSession(context, activeId, false);
    try {
        if (context.tabContentView) {
            layoutTabContentContainer(context);
            cv.addChildView(context.tabContentView);
        }
        if (tabView && !tabView.webContents.isDestroyed()) {
            const hideTabForLens = lensSession?.selectionActive && context.activeTabViewRemovedForShellOverlay;
            if (!hideTabForLens) {
                addTabContentChildView(context, tabView);
            }
        }
        if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOverlayView);
        }
        if (context.statusBubbleView && !context.statusBubbleView.webContents.isDestroyed()) {
            cv.addChildView(context.statusBubbleView);
            if (context.statusBubbleState?.url) {
                context.statusBubbleView.setBounds(getStatusBubbleBounds(context));
            }
        }
        if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOmniboxOverlayView);
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeShellMenuOverlayView);
        }
        if (lensSession?.selectionActive && lensSession.sidebarView && !lensSession.sidebarView.webContents.isDestroyed()) {
            addTabContentChildView(context, lensSession.sidebarHostView || lensSession.sidebarView);
        }
        if (context.tooltipView && !context.tooltipView.webContents.isDestroyed()) {
            cv.addChildView(context.tooltipView);
        }
        if (context.downloadAttentionView && !context.downloadAttentionView.webContents.isDestroyed()) {
            cv.addChildView(context.downloadAttentionView);
        }
    } catch (err) {
        console.error('ensureChromeOverlayOnTop', err?.message || err);
    }
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function estimateMenuRowsHeight(items, rowHeight = 38, separatorHeight = 13, padding = 12) {
    if (!Array.isArray(items) || items.length === 0) return padding;
    return items.reduce((sum, item) => (
        sum + (item?.type === 'separator' ? separatorHeight : rowHeight)
    ), padding);
}

function menuOverlayBoundsFromPanel(context, panelRect, options = {}) {
    const pad = 8;
    const defaultMargin = Number.isFinite(Number(options.shadowMargin)) ? Number(options.shadowMargin) : 16;
    const shadowMarginLeft = Number.isFinite(Number(options.shadowMarginLeft)) ? Number(options.shadowMarginLeft) : defaultMargin;
    const shadowMarginRight = Number.isFinite(Number(options.shadowMarginRight)) ? Number(options.shadowMarginRight) : defaultMargin;
    const shadowMarginTop = Number.isFinite(Number(options.shadowMarginTop)) ? Number(options.shadowMarginTop) : defaultMargin;
    const shadowMarginBottom = Number.isFinite(Number(options.shadowMarginBottom)) ? Number(options.shadowMarginBottom) : defaultMargin;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const panelLeft = clampNumber(Math.round(Number(panelRect.left) || 0), pad, windowW - pad);
    const panelTop = clampNumber(Math.round(Number(panelRect.top) || 0), pad, windowH - pad);
    const panelWidth = Math.max(1, Math.round(Number(panelRect.width) || 1));
    const panelHeight = Math.max(1, Math.round(Number(panelRect.height) || 1));
    const extraLeft = Math.max(0, Math.round(Number(options.extraLeft) || 0));
    const extraRight = Math.max(0, Math.round(Number(options.extraRight) || 0));
    const extraTop = Math.max(0, Math.round(Number(options.extraTop) || 0));
    const extraBottom = Math.max(0, Math.round(Number(options.extraBottom) || 0));

    const wantedLeft = panelLeft - extraLeft - shadowMarginLeft;
    const wantedTop = panelTop - extraTop - shadowMarginTop;
    const wantedRight = panelLeft + panelWidth + extraRight + shadowMarginRight;
    const wantedBottom = panelTop + panelHeight + extraBottom + shadowMarginBottom;
    const x = Math.max(0, Math.min(windowW - 1, wantedLeft));
    const y = Math.max(0, Math.min(windowH - 1, wantedTop));
    const right = Math.max(x + 1, Math.min(windowW, wantedRight));
    const bottom = Math.max(y + 1, Math.min(windowH, wantedBottom));

    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        viewportWidth: windowW,
        viewportHeight: windowH,
    };
}

function computeMenuOverlayBounds(context, patch) {
    const pad = 8;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const kind = patch?.kind;

    if (kind === 'bookmarkContextMenu') {
        const menuWidth = 220;
        const fixedHeight = 290;
        const left = clampNumber(Math.round(Number(patch.clientX) || 0), pad, windowW - menuWidth - pad);
        const top = clampNumber(Math.round(Number(patch.clientY) || 0), pad, windowH - fixedHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: menuWidth, height: fixedHeight });
    }

    if (kind === 'bookmarkFolderMenu') {
        const ar = patch.anchorRect || {};
        const minW = 240;
        const maxW = 420;
        let width = Math.round(Number(ar.width) || 280);
        width = clampNumber(width, minW, maxW);
        const left = clampNumber(Math.round(Number(ar.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(ar.top) || 0) + Math.round(Number(ar.height) || 0) + 4, pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items.slice(0, 400) : [];
        const maxH = Math.max(100, Math.min(windowH * 0.9, windowH - top - pad));
        const listHeight = items.length === 0 ? 56 : Math.min(items.length * 36 + 8, maxH - 40);
        const height = Math.min(maxH, 40 + Math.max(56, listHeight));
        return menuOverlayBoundsFromPanel(context, { left, top, width, height }, {
            shadowMarginTop: 6,
            shadowMarginBottom: 28,
            shadowMarginLeft: 28,
            shadowMarginRight: 28,
        });
    }

    if (kind === 'bookmarkEditor') {
        const ar = patch.anchorRect || {};
        const panelWidth = Math.min(340, Math.max(280, windowW - 16));
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0 + w0 - panelWidth, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.min(480, windowH - top - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'profileMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 260);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const rows = items.length + 1 + (patch.showEdit ? 1 : 0);
        const separators = 1 + (patch.showEdit ? 1 : 0);
        const height = Math.min(windowH - top - pad, rows * 42 + separators * 13 + 16);
        return menuOverlayBoundsFromPanel(context, { left, top, width, height }, {
            shadowMarginTop: 6,
            shadowMarginBottom: 28,
            shadowMarginLeft: 28,
            shadowMarginRight: 28,
        });
    }

    if (kind === 'siteInfo') {
        const ar = patch.anchorRect || {};
        const panelWidth = 340;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.max(240, Math.min(windowH * 0.6, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'permissionPrompt') {
        const ar = patch.anchorRect || { left: 160, top: 44, width: 34, height: 34 };
        const panelWidth = 360;
        const left0 = Math.round(Number(ar.left) || 160);
        const top0 = Math.round(Number(ar.top) || 44);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 34));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 240 - pad);
        const height = 220;
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'downloadPanel') {
        const ar = patch.anchorRect || {};
        const panelWidth = 360;
        const left0 = Math.round(Number(ar.left) || 0);
        const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0 + w0 - panelWidth, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 220 - pad);
        const height = Math.max(180, Math.min(440, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height }, {
            shadowMarginTop: 6,
            shadowMarginBottom: 28,
            shadowMarginLeft: 28,
            shadowMarginRight: 28,
        });
    }

    if (kind === 'cookieControls') {
        const ar = patch.anchorRect || {};
        const panelWidth = 340;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 220 - pad);
        const height = Math.max(160, Math.min(windowH * 0.45, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'appMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 320);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const submenus = patch.submenus && typeof patch.submenus === 'object' ? patch.submenus : {};
        const submenuHeight = Object.values(submenus).reduce((maxHeight, submenuItems) => (
            Math.max(maxHeight, estimateMenuRowsHeight(submenuItems, 42, 13, 20))
        ), 0);
        const estimatedHeight = Math.max(240, estimateMenuRowsHeight(items, 42, 13, 20), Math.min(420, submenuHeight));
        const height = Math.min(windowH - top - pad, estimatedHeight);
        const submenuWidth = items.reduce((maxWidth, item) => {
            if (!item?.submenuKey || !Array.isArray(submenus[item.submenuKey])) return maxWidth;
            return Math.max(maxWidth, Math.round(Number(item.submenuWidth) || 320));
        }, 0);
        const maxAllowedExtraBottom = Math.max(0, windowH - top - height - pad);
        const extraBottom = submenuWidth ? Math.min(maxAllowedExtraBottom, Math.max(28, submenuHeight)) : 0;
        return menuOverlayBoundsFromPanel(context, { left, top, width, height }, {
            extraLeft: submenuWidth ? submenuWidth + 8 : 0,
            extraBottom,
            shadowMarginTop: 6,
            shadowMarginBottom: 28,
            shadowMarginLeft: 28,
            shadowMarginRight: 28,
        });
    }

    if (kind === 'transparencyMenu') {
        const ar = patch.anchorRect || {};
        const panelWidth = 260;
        const panelHeight = 52;
        const anchorL = Math.round(Number(ar.left) || 0);
        const anchorW = Math.max(1, Math.round(Number(ar.width) || 32));
        const anchorT = Math.round(Number(ar.top) || 0);
        const anchorH = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(anchorL + anchorW - panelWidth, pad, windowW - panelWidth - pad);
        const top  = clampNumber(anchorT + anchorH + 6, pad, windowH - panelHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height: panelHeight }, {
            shadowMarginTop: 6,
            shadowMarginBottom: 24,
            shadowMarginLeft: 24,
            shadowMarginRight: 24,
        });
    }

    if (kind === 'clickThroughOSD') {
        // Natural menu-styled notification panel, floating below the toolbar
        const osdWidth  = 280;
        const osdHeight = 78;
        const left = Math.round((windowW - osdWidth) / 2);
        const top  = clampNumber(80, pad, windowH - osdHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: osdWidth, height: osdHeight }, { shadowMargin: 28 });
    }

    return null;
}

function computeOmniboxOverlayBounds(context, patch) {
    const dr = patch?.dropdownRect || {};
    const pad = 8;
    const shadowMargin = 12;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    let w = Math.round(Number(dr.width) || 320);
    let inputH = Math.round(Number(dr.height) || 34);
    let left = Math.round(Number(dr.left) || 0);
    let top = Math.round(Number(dr.top) || 0);
    w = Math.max(200, Math.min(w, windowW - 2 * pad));
    left = Math.max(pad, Math.min(left, windowW - w - pad));
    top = Math.max(pad, Math.min(top, windowH - 120 - pad));

    const items = Array.isArray(patch?.items) ? patch.items.slice(0, 24) : [];
    const rowHeight = 50;
    const scrollPad = 6;
    const maxScrollH = Math.min(412, Math.floor(windowH * 0.7));
    let scrollH = 0;
    if (items.length > 0) {
        scrollH = Math.min(items.length * rowHeight, maxScrollH);
    } else if (String(patch?.query || '').trim()) {
        scrollH = 36;
    }
    const panelH = inputH + scrollPad + scrollH;
    const panelHeight = Math.min(panelH, windowH - top - pad);
    const x = Math.max(0, left - shadowMargin);
    const y = Math.max(0, top - shadowMargin);
    const width = Math.min(windowW - x, w + (left - x) + shadowMargin);
    const height = Math.min(windowH - y, panelHeight + (top - y) + shadowMargin);
    return {
        x,
        y,
        width,
        height: Math.max(inputH + (top - y), height),
    };
}

function layoutOmniboxOverlayBounds(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return null;
    const bounds = computeOmniboxOverlayBounds(context, patch);
    try {
        context.chromeOmniboxOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutOmniboxOverlayBounds', err?.message || err);
        return null;
    }
}

function notifyOmniboxOverlayDelivered(context) {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED);
    } catch (err) {
        console.error('omnibox-overlay:delivered send', err?.message || err);
    }
}

function replayOmniboxOverlayPatchIfNeeded(context) {
    if (!context?.chromeOmniboxOverlayReady) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    const patch = context.lastOmniboxOverlayPatch;
    if (!patch || patch.kind !== 'omniboxSuggestions') return;
    if (!context.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    try {
        const replayPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, replayPatch);
        if (overlayBounds) replayPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, replayPatch);
        if (replayPatch.focusInput !== false) {
            setImmediate(() => {
                if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                focusChromeOmniboxOverlayWebContents(context);
            });
        }
        notifyOmniboxOverlayDelivered(context);
    } catch (err) {
        console.error('replayOmniboxOverlayPatchIfNeeded', err?.message || err);
    }
}

function deliverOmniboxOverlayPatch(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return { ok: false };
    try {
        context.chromeOverlayOmniboxMode = true;
        context.lastOmniboxOverlayPatch = patch;
        const deliverPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, deliverPatch);
        if (overlayBounds) deliverPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        if (context.chromeOmniboxOverlayReady) {
            context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, deliverPatch);
            if (deliverPatch.focusInput !== false) {
                setImmediate(() => {
                    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                    focusChromeOmniboxOverlayWebContents(context);
                });
            }
            notifyOmniboxOverlayDelivered(context);
        }
    } catch (err) {
        console.error('deliverOmniboxOverlayPatch', err?.message || err);
        return { ok: false };
    }
    return { ok: true, delivered: !!context.chromeOmniboxOverlayReady };
}

function focusChromeOmniboxOverlayWebContents(context) {
    if (context?.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeOmniboxOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeOmniboxOverlayWebContents', err?.message || err);
    }
}

/** @deprecated use focusChromeOmniboxOverlayWebContents for omnibox input */
function focusChromeOverlayWebContents(context) {
    focusChromeOmniboxOverlayWebContents(context);
}

function dismissOmniboxChromeOverlayOnBlur(context) {
    if (!context?.chromeOverlayOmniboxMode) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeOverlayBlurDismissPending) return;
    if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
    context.chromeOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            if (!context.chromeOverlayOmniboxMode) return;
            if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
            if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
            context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
                type: 'dismiss',
                reason: 'blur',
            });
        } catch (err) {
            console.error('chrome-overlay:v1:blur-dismiss', err?.message || err);
        } finally {
            setTimeout(() => {
                context.chromeOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function dismissChromeShellMenuOverlay(context, reason = 'outside') {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
            type: 'dismiss',
            reason,
        });
    } catch (err) {
        console.error('chrome-shell-menu-overlay:v1:dismiss', err?.message || err);
    }
}

function dismissChromeShellMenuOverlayOnBlur(context) {
    if ((context?.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeShellMenuOverlayBlurDismissPending) return;
    context.chromeShellMenuOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            dismissChromeShellMenuOverlay(context, 'blur');
        } finally {
            setTimeout(() => {
                context.chromeShellMenuOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function focusChromeShellMenuOverlayWebContents(context) {
    if (context?.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
    if (!context?.chromeShellMenuOverlayView || context.chromeShellMenuOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeShellMenuOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeShellMenuOverlayWebContents', err?.message || err);
    }
}

function layoutChromeOverlayBounds(context, patch) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if (context.chromeOverlayAcquireCount <= 0) return null;
    let bounds;

    const { getLensSession, computeLensChromeOverlayBounds } = require('./lensManager');

    if (patch?.kind === 'lensSelection') {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else {
        context.chromeOverlayFullWindowMode = false;
        const { width, height } = context.window.getContentBounds();
        bounds = { x: 0, y: 0, width, height };
    }
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayBounds', err?.message || err);
        return null;
    }
}

function layoutChromeOverlayFullWindowBounds(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOverlayAcquireCount || 0) <= 0) return null;
    context.chromeOverlayFullWindowMode = true;
    const { width, height } = context.window.getContentBounds();
    const bounds = { x: 0, y: 0, width, height };
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayFullWindowBounds', err?.message || err);
        return null;
    }
}

function showPermissionPromptOverlay(context, promptPayload) {
    if (!context?.window || context.window.isDestroyed()) return;
    createChromeShellMenuOverlayLayer(context);
    const ov = context.chromeShellMenuOverlayView;
    if (!isViewWebContentsAlive(ov)) return;

    context.chromeShellMenuOverlayAcquireCount = (context.chromeShellMenuOverlayAcquireCount || 0) + 1;
    ensureChromeOverlayOnTop(context);

    const patch = {
        kind: 'permissionPrompt',
        ...promptPayload,
    };

    const bounds = computeMenuOverlayBounds(context, patch);
    if (bounds) {
        ov.setBounds(bounds);
    }
    ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
}

function hidePermissionPromptOverlay(context) {
    if (!context) return;
    dismissChromeShellMenuOverlay(context);
}

module.exports = {
    createChromeOverlayLayer,
    createChromeOmniboxOverlayLayer,
    createChromeShellMenuOverlayLayer,
    createTooltipOverlay,
    ensureChromeOverlayOnTop,
    clampNumber,
    estimateMenuRowsHeight,
    menuOverlayBoundsFromPanel,
    computeMenuOverlayBounds,
    computeOmniboxOverlayBounds,
    layoutOmniboxOverlayBounds,
    notifyOmniboxOverlayDelivered,
    replayOmniboxOverlayPatchIfNeeded,
    deliverOmniboxOverlayPatch,
    focusChromeOmniboxOverlayWebContents,
    focusChromeOverlayWebContents,
    dismissOmniboxChromeOverlayOnBlur,
    dismissChromeShellMenuOverlay,
    dismissChromeShellMenuOverlayOnBlur,
    focusChromeShellMenuOverlayWebContents,
    layoutChromeOverlayBounds,
    layoutChromeOverlayFullWindowBounds,
    showPermissionPromptOverlay,
    hidePermissionPromptOverlay,
    createDownloadAttentionOverlay,
    showDownloadAttentionOverlay,
    createStatusBubbleOverlay,
    updateStatusBubble,
    flipStatusBubbleSide,
    resizeStatusBubble,
    hideStatusBubble,
    layoutStatusBubble,
    sendStatusBubbleThemePatch,
};