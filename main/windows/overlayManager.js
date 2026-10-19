
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
        if (context.activeExtensionInstallPrompt) {
            showExtensionInstallPromptOverlay(context, context.activeExtensionInstallPrompt);
        }
        if (context.activeDesktopMediaPicker) {
            showDesktopMediaPickerOverlay(context, context.activeDesktopMediaPicker);
        }
        if (context.activeExtensionPopup) {
            const { currentWidth, currentHeight } = context.activeExtensionPopup;
            updateExtensionPopupShadow(context, currentWidth || 380, currentHeight || 420);
        }
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
            } catch (_) { }
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
        } catch (_) { }
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
            } catch (_) { }
        };

        if (context.statusBubbleView.webContents.isLoading()) {
            context.statusBubbleView.webContents.once('did-finish-load', sendUpdate);
        } else {
            sendUpdate();
        }
    } catch (_) { }
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
    } catch (_) { }
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
        } catch (_) { }
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
    } catch (_) { }
}

function layoutStatusBubble(context) {
    if (!context?.statusBubbleState?.url) return;
    const bounds = getStatusBubbleBounds(context);
    try {
        if (context.statusBubbleView && !context.statusBubbleView.webContents.isDestroyed()) {
            context.statusBubbleView.setBounds(bounds);
        }
    } catch (_) { }
}

function sendStatusBubbleThemePatch(context) {
    if (!context?.statusBubbleView || context.statusBubbleView.webContents.isDestroyed()) return;
    try {
        const settingsService = require('../services/settingsService');
        const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
        context.statusBubbleView.webContents.send(C.IPC_EVENT.STATUS_BUBBLE_THEME, themePatch);
    } catch (_) { }
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
        } catch (_) { }

        const w = 80;
        const h = 180;
        let x = Math.round((rect?.x || 0) + (rect?.width || 30) / 2 - w / 2);
        try {
            const winBounds = context.window.getContentBounds();
            x = Math.max(0, Math.min(x, winBounds.width - w));
        } catch (_) { }
        const y = Math.round(rect?.y || 0);

        context.downloadAttentionView.setBounds({ x, y, width: w, height: h });

        const sendPlay = () => {
            if (context.downloadAttentionView && !context.downloadAttentionView.webContents.isDestroyed()) {
                try {
                    const settingsService = require('../services/settingsService');
                    const themePatch = settingsService.getChromeOverlayThemePatchForContext(context);
                    context.downloadAttentionView.webContents.send('download-attention:play', themePatch);
                } catch (_) { }
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
        const hasTopModal = !!(context.activeDesktopMediaPicker || context.activeExtensionInstallPrompt);

        if (hasTopModal) {
            // When a modal dialog is active, extension popup goes beneath the modal overlay
            if (context.activeExtensionPopup?.view && !context.activeExtensionPopup.view.webContents.isDestroyed()) {
                cv.addChildView(context.activeExtensionPopup.view);
            }
            if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                cv.addChildView(context.chromeShellMenuOverlayView);
            }
        } else {
            // Normal overlay ordering: shell menus beneath extension popup
            if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                cv.addChildView(context.chromeShellMenuOverlayView);
            }
            if (context.activeExtensionPopup?.view && !context.activeExtensionPopup.view.webContents.isDestroyed()) {
                cv.addChildView(context.activeExtensionPopup.view);
            }
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

    if (kind === 'extensionInstallPrompt') {
        const panelWidth = 400;
        const left = clampNumber(Math.round((windowW - panelWidth) / 2), pad, windowW - panelWidth - pad);
        const top = 50;
        const height = Math.min(520, windowH - top - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height }, {
            shadowMarginTop: 24,
            shadowMarginBottom: 48,
            shadowMarginLeft: 36,
            shadowMarginRight: 36,
        });
    }

    if (kind === 'desktopMediaPicker') {
        return {
            x: 0,
            y: 0,
            width: windowW,
            height: windowH,
            viewportWidth: windowW,
            viewportHeight: windowH,
        };
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

    if (kind === 'cookieControls' || kind === 'downloadPanel' || kind === 'extensionMenu') {
        const ar = patch.anchorRect || {};
        const isContextMenuOnly = kind === 'extensionMenu' && patch.contextMenuOnly;
        const panelWidth = kind === 'cookieControls' ? 340 : (kind === 'extensionMenu' ? (isContextMenuOnly ? 240 : 320) : 300);
        const left0 = Math.round(Number(ar.right != null ? ar.right - panelWidth : ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 220 - pad);
        const height = Math.max(240, Math.min(windowH * 0.65, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height }, {
            extraLeft: kind === 'extensionMenu' ? 560 : 0,
            extraRight: kind === 'extensionMenu' ? 280 : 0,
            shadowMarginTop: 16,
            shadowMarginBottom: 32,
            shadowMarginLeft: 24,
            shadowMarginRight: 24,
        });
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
        const top = clampNumber(anchorT + anchorH + 6, pad, windowH - panelHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height: panelHeight }, {
            shadowMarginTop: 6,
            shadowMarginBottom: 24,
            shadowMarginLeft: 24,
            shadowMarginRight: 24,
        });
    }

    if (kind === 'clickThroughOSD') {
        // Natural menu-styled notification panel, floating below the toolbar
        const osdWidth = 280;
        const osdHeight = 78;
        const left = Math.round((windowW - osdWidth) / 2);
        const top = clampNumber(80, pad, windowH - osdHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: osdWidth, height: osdHeight }, { shadowMargin: 28 });
    }

    if (kind === 'extensionPopupShadow') {
        const pr = patch.popupRect || {};
        const panelRect = {
            left: Math.round(Number(pr.left) || 0),
            top: Math.round(Number(pr.top) || 0),
            width: Math.max(1, Math.round(Number(pr.width) || 380)),
            height: Math.max(1, Math.round(Number(pr.height) || 420)),
        };
        return menuOverlayBoundsFromPanel(context, panelRect, {
            shadowMarginTop: 14,
            shadowMarginBottom: 38,
            shadowMarginLeft: 38,
            shadowMarginRight: 38,
        });
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
    if (context.activeDesktopMediaPicker || context.activeExtensionInstallPrompt) return;
    if (context.chromeShellMenuOverlayBlurDismissPending) return;
    context.chromeShellMenuOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            if (context.activeDesktopMediaPicker || context.activeExtensionInstallPrompt) return;
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
        patch.overlayBounds = bounds;
        patch.overlayViewport = { width: bounds.viewportWidth, height: bounds.viewportHeight };
    }
    ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
}

function hidePermissionPromptOverlay(context) {
    if (!context) return;
    dismissChromeShellMenuOverlay(context);
}

function showExtensionInstallPromptOverlay(context, promptPayload) {
    if (!context?.window || context.window.isDestroyed()) return;
    createChromeShellMenuOverlayLayer(context);
    const ov = context.chromeShellMenuOverlayView;
    if (!isViewWebContentsAlive(ov)) return;

    context.activeExtensionInstallPrompt = promptPayload;
    context.chromeShellMenuOverlayAcquireCount = (context.chromeShellMenuOverlayAcquireCount || 0) + 1;
    ensureChromeOverlayOnTop(context);

    const { getChromeOverlayThemePatchForContext } = require('../services/settingsService');
    const themePatch = getChromeOverlayThemePatchForContext(context);
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, themePatch);
    } catch (_) { }

    const patch = {
        kind: 'extensionInstallPrompt',
        theme: themePatch,
        ...promptPayload,
    };

    const bounds = computeMenuOverlayBounds(context, patch);
    if (bounds) {
        ov.setBounds(bounds);
        patch.overlayBounds = bounds;
        patch.overlayViewport = { width: bounds.viewportWidth, height: bounds.viewportHeight };
    }
    ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    focusChromeShellMenuOverlayWebContents(context);
}

function hideExtensionInstallPromptOverlay(context) {
    if (!context) return;
    context.activeExtensionInstallPrompt = null;
    if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }
    dismissChromeShellMenuOverlay(context);
}

function showDesktopMediaPickerOverlay(context, pickerPayload) {
    if (!context?.window || context.window.isDestroyed()) return;
    createChromeShellMenuOverlayLayer(context);
    const ov = context.chromeShellMenuOverlayView;
    if (!isViewWebContentsAlive(ov)) return;

    context.activeDesktopMediaPicker = pickerPayload;
    if (context.activeExtensionPopup?.blurTimer) {
        clearTimeout(context.activeExtensionPopup.blurTimer);
        context.activeExtensionPopup.blurTimer = null;
    }
    context.chromeShellMenuOverlayAcquireCount = (context.chromeShellMenuOverlayAcquireCount || 0) + 1;
    ensureChromeOverlayOnTop(context);

    try {
        if (context.window?.contentView) {
            context.window.contentView.addChildView(ov);
        }
    } catch (_) { }

    const { getChromeOverlayThemePatchForContext } = require('../services/settingsService');
    const themePatch = getChromeOverlayThemePatchForContext(context);
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, themePatch);
    } catch (_) { }

    const patch = {
        kind: 'desktopMediaPicker',
        theme: themePatch,
        ...pickerPayload,
    };

    const bounds = computeMenuOverlayBounds(context, patch);
    if (bounds) {
        ov.setBounds(bounds);
        patch.overlayBounds = bounds;
        patch.overlayViewport = { width: bounds.viewportWidth, height: bounds.viewportHeight };
    }
    ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    focusChromeShellMenuOverlayWebContents(context);
}

function hideDesktopMediaPickerOverlay(context) {
    if (!context) return;
    context.activeDesktopMediaPicker = null;
    if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }
    dismissChromeShellMenuOverlay(context);
    ensureChromeOverlayOnTop(context);

    if (context.activeExtensionPopup && !context.activeExtensionPopup.view.webContents.isDestroyed()) {
        const { currentWidth, currentHeight } = context.activeExtensionPopup;
        updateExtensionPopupShadow(context, currentWidth || 380, currentHeight || 420);
        try {
            context.activeExtensionPopup.view.webContents.focus();
        } catch (_) { }
    }
}

function readPopupConfiguredDimensions(extension) {
    let width = null;
    let height = null;
    const fs = require('fs');
    const path = require('path');

    try {
        let manifest = extension.manifest;
        if (!manifest && extension.path) {
            const manifestPath = path.join(extension.path, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            }
        }
        if (manifest) {
            const action = manifest.action || manifest.browser_action || {};
            const rawW = action.default_width || action.width || action.popup_width || manifest.default_width || manifest.popup_width;
            const rawH = action.default_height || action.height || action.popup_height || manifest.default_height || manifest.popup_height;
            if (rawW) width = parseInt(rawW, 10);
            if (rawH) height = parseInt(rawH, 10);
        }

        // Check popup HTML file for CSS width and height
        const popupFile = extension.popupFile || 'popup.html';
        if (extension.path && popupFile) {
            const popupPath = path.join(extension.path, popupFile);
            if (fs.existsSync(popupPath)) {
                const htmlContent = fs.readFileSync(popupPath, 'utf8');
                if (!width) {
                    const match = htmlContent.match(/(?:body|html)[^{]*\{[^}]*width:\s*(\d+)px/i) ||
                        htmlContent.match(/style=["'][^"']*width:\s*(\d+)px/i);
                    if (match) width = parseInt(match[1], 10);
                }
                if (!height) {
                    const match = htmlContent.match(/(?:body|html)[^{]*\{[^}]*height:\s*(\d+)px/i) ||
                        htmlContent.match(/style=["'][^"']*height:\s*(\d+)px/i);
                    if (match) height = parseInt(match[1], 10);
                }
            }
        }
    } catch (_) { }

    return {
        width: Number.isFinite(width) && width > 0 ? width : null,
        height: Number.isFinite(height) && height > 0 ? height : null,
    };
}

function computeExtensionPopupBounds(context, anchorRect, width = 380, height = 420) {
    const pad = 8;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const anchor = anchorRect || { left: 400, top: 40, right: 430, bottom: 68 };
    const top = Math.round(anchor.bottom != null ? anchor.bottom + 6 : 44);

    // Chrome limits: min 100x60, max 800x600, clamped to window bounds
    const maxAllowedWidth = Math.max(100, Math.min(800, windowW - 2 * pad));
    const maxAllowedHeight = Math.max(60, Math.min(600, windowH - top - pad));

    const finalW = clampNumber(Math.round(Number(width) || 380), 100, maxAllowedWidth);
    const finalH = clampNumber(Math.round(Number(height) || 420), 60, maxAllowedHeight);

    const anchorRight = anchor.right != null ? anchor.right : (anchor.left != null ? anchor.left + (anchor.width || 32) : 400);
    const left = clampNumber(anchorRight - finalW, pad, windowW - finalW - pad);

    return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(finalW),
        height: Math.round(finalH),
    };
}

function updateExtensionPopupShadow(context, width, height) {
    if (!context?.activeExtensionPopup) return;
    createChromeShellMenuOverlayLayer(context);
    const ov = context.chromeShellMenuOverlayView;
    if (!isViewWebContentsAlive(ov)) return;

    const { anchorRect } = context.activeExtensionPopup;
    const bounds = computeExtensionPopupBounds(context, anchorRect, width, height);
    const patch = {
        kind: 'extensionPopupShadow',
        anchorRect,
        popupRect: {
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
    };
    const ovBounds = computeMenuOverlayBounds(context, patch);
    if (ovBounds) {
        ov.setBounds(ovBounds);
        patch.overlayBounds = ovBounds;
        patch.overlayViewport = { width: ovBounds.viewportWidth, height: ovBounds.viewportHeight };
    }
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    } catch (_) { }
}

function resizeExtensionPopup(context, width, height) {
    if (!context?.activeExtensionPopup?.view) return;
    const { view, anchorRect } = context.activeExtensionPopup;
    if (view.webContents.isDestroyed()) return;

    const bounds = computeExtensionPopupBounds(context, anchorRect, width, height);
    const cur = view.getBounds();
    if (Math.abs(cur.width - bounds.width) > 1 || Math.abs(cur.height - bounds.height) > 1 ||
        Math.abs(cur.x - bounds.x) > 1 || Math.abs(cur.y - bounds.y) > 1) {
        view.setBounds(bounds);
        context.activeExtensionPopup.currentWidth = bounds.width;
        context.activeExtensionPopup.currentHeight = bounds.height;
        updateExtensionPopupShadow(context, bounds.width, bounds.height);
    }
}

function layoutExtensionPopupBounds(context) {
    if (!context?.activeExtensionPopup?.view) return;
    const { currentWidth, currentHeight } = context.activeExtensionPopup;
    resizeExtensionPopup(context, currentWidth || 380, currentHeight || 420);
}

const { ipcMain } = require('electron');
if (!global.__invisurfExtensionPopupResizeHandlerRegistered) {
    global.__invisurfExtensionPopupResizeHandlerRegistered = true;
    ipcMain.on('invisurf:resize-extension-popup', (event, data) => {
        const { getWindowContextByChromeOverlaySender } = require('./windowContextUtils');
        const ctx = getWindowContextByChromeOverlaySender(event.sender);
        if (ctx && ctx.activeExtensionPopup?.view?.webContents === event.sender) {
            resizeExtensionPopup(ctx, data?.width, data?.height);
        }
    });
}

async function showExtensionPopup(context, extension, anchorRect) {
    if (!context?.window || context.window.isDestroyed()) return;

    if (context.activeExtensionPopup) {
        const isSame = context.activeExtensionPopup.extensionId === extension.id;
        hideExtensionPopup(context);
        if (isSame) return;
    }

    const fs = require('fs');
    const path = require('path');
    const { session } = require('electron');

    if (!extension || !extension.path || !fs.existsSync(extension.path)) {
        console.warn(`[showExtensionPopup] Extension path not found on disk for ${extension?.id}: ${extension?.path}`);
        return;
    }

    const targetSession = context.partition ? session.fromPartition(context.partition) : session.defaultSession;
    let allLoaded = targetSession.extensions ? targetSession.extensions.getAllExtensions() : [];
    let loadedExt = allLoaded.find(e =>
        e.id === extension.id ||
        e.id === extension.runtimeId ||
        (e.path && path.resolve(e.path) === path.resolve(extension.path))
    );

    if (!loadedExt && targetSession.extensions) {
        try {
            const { ensureExtensionPolyfills } = require('../extensions/ExtensionInstaller');
            ensureExtensionPolyfills(extension.path, extension.id);
            loadedExt = await targetSession.extensions.loadExtension(extension.path);
            console.log(`[showExtensionPopup] Dynamically loaded extension ${extension.id} (id: ${loadedExt?.id}) into session partition: ${context.partition}`);
        } catch (loadErr) {
            console.error(`[showExtensionPopup] Failed to load extension ${extension.id} into session:`, loadErr);
            return;
        }
    }

    const actualId = loadedExt?.id || extension.runtimeId || extension.id;
    let popupUrl = '';
    const rawPopup = extension.popupFile || 'popup.html';
    if (rawPopup.startsWith('chrome-extension://')) {
        popupUrl = rawPopup;
    } else {
        popupUrl = `chrome-extension://${actualId}/${rawPopup.replace(/^\/+/, '')}`;
    }
    console.log(`[DEBUG-EXT] showExtensionPopup: actualId="${actualId}" rawPopup="${rawPopup}" finalUrl="${popupUrl}"`);

    if (actualId === 'fdpohaocaechififmbbbbbknoalclacl') {
        try {
            const { getTabRegistry } = require('../extensions/compat/TabRegistry');
            getTabRegistry().markCapturingActive?.(actualId);
        } catch (_) { }
    }

    const cv = context.window.contentView;
    const { buildExtensionWebPreferences } = require('../../runtime/webPreferences');

    const popupView = new WebContentsView({
        webPreferences: buildExtensionWebPreferences({
            partition: context.partition,
        }),
    });
    popupView.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[EXT-POPUP ${extension.id}] [lvl=${level}] ${message} (${sourceId}:${line})`);
    });
    try {
        popupView.setBackgroundColor('#00000000');
    } catch (_) { }

    const configured = readPopupConfiguredDimensions(extension);
    const initialWidth = configured.width || 380;
    const initialHeight = configured.height || 420;
    const bounds = computeExtensionPopupBounds(context, anchorRect, initialWidth, initialHeight);

    context.activeExtensionPopup = {
        extensionId: extension.id,
        view: popupView,
        anchorRect,
        currentWidth: bounds.width,
        currentHeight: bounds.height,
        configuredWidth: configured.width,
        configuredHeight: configured.height,
        blurTimer: null,
    };

    createChromeShellMenuOverlayLayer(context);
    const ov = context.chromeShellMenuOverlayView;
    if (ov && !ov.webContents.isDestroyed()) {
        updateExtensionPopupShadow(context, bounds.width, bounds.height);
        cv.addChildView(ov);
    }

    popupView.setBounds(bounds);
    cv.addChildView(popupView);

    let cleanupDone = false;
    const handlePopupError = (reason) => {
        if (cleanupDone) return;
        cleanupDone = true;
        console.error(`[showExtensionPopup] Popup failed to load (${reason}), hiding popup overlay.`);
        hideExtensionPopup(context);
    };

    const measureAndResize = async () => {
        if (!context?.activeExtensionPopup || popupView.webContents.isDestroyed()) return;
        try {
            const dims = await popupView.webContents.executeJavaScript(`
                (() => {
                    try {
                        const doc = document.documentElement;
                        const body = document.body;
                        if (!doc || !body) return null;
                        const rect = body.getBoundingClientRect();
                        const w = Math.max(doc.scrollWidth || 0, body.scrollWidth || 0, Math.ceil(rect.width) || 0);
                        const h = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0, Math.ceil(rect.height) || 0);
                        return { width: Math.round(w), height: Math.round(h) };
                    } catch (_) {
                        return null;
                    }
                })()
            `);
            if (dims && dims.width > 0 && dims.height > 0) {
                const targetW = context.activeExtensionPopup?.configuredWidth || dims.width;
                const targetH = context.activeExtensionPopup?.configuredHeight || dims.height;
                const safeW = Math.max(targetW, dims.width);
                const safeH = Math.max(targetH, dims.height);
                resizeExtensionPopup(context, safeW, safeH);
            }
        } catch (_) { }
    };

    popupView.webContents.on('dom-ready', () => {
        try {
            popupView.webContents.insertCSS(`
                html, body {
                    border-radius: 8px !important;
                }
            `);
        } catch (_) { }
        measureAndResize();
    });

    popupView.webContents.on('did-finish-load', () => {
        measureAndResize();
        setTimeout(measureAndResize, 80);
        setTimeout(measureAndResize, 250);
    });

    popupView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        handlePopupError(`${errorCode}: ${errorDescription} at ${validatedURL}`);
    });

    popupView.webContents.loadURL(popupUrl).catch(err => {
        handlePopupError(err?.message || err);
    });

    try {
        popupView.webContents.focus();
    } catch (_) { }

    const onBlur = () => {
        if (context.activeDesktopMediaPicker || context.activeExtensionInstallPrompt) {
            return;
        }
        try {
            const { getTabRegistry } = require('../extensions/compat/TabRegistry');
            if (getTabRegistry().isCapturingActive?.()) {
                return;
            }
        } catch (_) { }
        if (context.activeExtensionPopup) {
            if (context.activeExtensionPopup.extensionId === 'fdpohaocaechififmbbbbbknoalclacl') {
                return;
            }
            context.activeExtensionPopup.blurTimer = setTimeout(() => {
                if (context.activeDesktopMediaPicker || context.activeExtensionInstallPrompt) {
                    return;
                }
                try {
                    const { getTabRegistry } = require('../extensions/compat/TabRegistry');
                    if (getTabRegistry().isCapturingActive?.()) {
                        return;
                    }
                } catch (_) { }
                hideExtensionPopup(context);
            }, 350);
        }
    };
    const onFocus = () => {
        if (context.activeExtensionPopup?.blurTimer) {
            clearTimeout(context.activeExtensionPopup.blurTimer);
            context.activeExtensionPopup.blurTimer = null;
        }
    };
    popupView.webContents.on('blur', onBlur);
    popupView.webContents.on('focus', onFocus);
    popupView.webContents.on('close', () => {
        hideExtensionPopup(context);
    });
}

function hideExtensionPopup(context) {
    if (!context?.activeExtensionPopup) return;
    try {
        const view = context.activeExtensionPopup.view;
        if (context.activeExtensionPopup.blurTimer) {
            clearTimeout(context.activeExtensionPopup.blurTimer);
            context.activeExtensionPopup.blurTimer = null;
        }
        context.activeExtensionPopup = null;
        if (view && !view.webContents.isDestroyed()) {
            view.webContents.removeAllListeners('blur');
            view.webContents.removeAllListeners('focus');
            context.window.contentView.removeChildView(view);
            view.webContents.destroy();
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            if (!context.activeDesktopMediaPicker && !context.activeExtensionInstallPrompt) {
                try {
                    context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                    context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
                } catch (_) { }
            }
        }
    } catch (_) { }
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
    showExtensionInstallPromptOverlay,
    hideExtensionInstallPromptOverlay,
    showDesktopMediaPickerOverlay,
    hideDesktopMediaPickerOverlay,
    showExtensionPopup,
    hideExtensionPopup,
    resizeExtensionPopup,
    layoutExtensionPopupBounds,
    computeExtensionPopupBounds,
    readPopupConfiguredDimensions,
};