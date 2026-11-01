'use strict';

const { WebContentsView } = require('electron');
const State = require('../state');
const { UI_HEIGHT } = require('../constants/defaults');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');

const SIDE_PANEL_MIN_WIDTH = 260;
const SIDE_PANEL_DEFAULT_WIDTH = 360;
const WEB_CONTENTS_MIN_WIDTH = 360;
const SIDE_PANEL_HEADER_HEIGHT = 40;

function getSidePanelState(context) {
    if (!context) return null;
    if (!context.sidePanelState) {
        context.sidePanelState = {
            isOpen: false,
            width: SIDE_PANEL_DEFAULT_WIDTH,
            activePanelId: 'reading-list',
            customUrl: null,
            webContentView: null,
        };
    }
    return context.sidePanelState;
}

function clampSidePanelWidth(context, requestedWidth) {
    const width = Number(requestedWidth) || SIDE_PANEL_DEFAULT_WIDTH;
    if (!context?.window || context.window.isDestroyed()) {
        return Math.max(SIDE_PANEL_MIN_WIDTH, width);
    }
    try {
        const bounds = context.window.getContentBounds();
        const maxW = Math.max(SIDE_PANEL_MIN_WIDTH, bounds.width - WEB_CONTENTS_MIN_WIDTH);
        return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(width, maxW));
    } catch (_) {
        return Math.max(SIDE_PANEL_MIN_WIDTH, width);
    }
}

function isSidePanelFullscreen(context) {
    if (!context?.window || context.window.isDestroyed()) return false;
    if (State.htmlFullscreenTabId && State.htmlFullscreenTabId === context.activeTabId) return true;
    try {
        return context.window.isFullScreen();
    } catch (_) {
        return false;
    }
}

function getSidePanelWidth(context) {
    const state = getSidePanelState(context);
    if (!state || !state.isOpen) return 0;
    if (isSidePanelFullscreen(context)) return 0;
    return clampSidePanelWidth(context, state.width);
}

function isSidePanelOpen(context) {
    const state = getSidePanelState(context);
    if (!state || !state.isOpen) return false;
    return !isSidePanelFullscreen(context);
}

function broadcastSidePanelState(context) {
    if (!context?.window || context.window.isDestroyed() || !context.window.webContents) return;
    const state = getSidePanelState(context);
    if (!state) return;
    const C = require('../../src/constants/conditionStrings.cjs');
    try {
        context.window.webContents.send(C.IPC_EVENT.SIDE_PANEL_STATE_CHANGED, {
            isOpen: state.isOpen,
            width: state.width,
            activePanelId: state.activePanelId,
            customUrl: state.customUrl,
        });
    } catch (_) { }
}

function setSidePanelWidth(context, width) {
    const state = getSidePanelState(context);
    if (!state) return;
    const clamped = clampSidePanelWidth(context, width);
    if (state.width === clamped) return;
    state.width = clamped;
    layoutSidePanel(context);
}

function setSidePanelState(context, partial = {}, options = {}) {
    const state = getSidePanelState(context);
    if (!state) return;
    if (typeof partial.isOpen === 'boolean') {
        state.isOpen = partial.isOpen;
        if (!state.isOpen && context.activeTabId && options.closeLens !== false) {
            try {
                const lensManager = require('./lensManager');
                if (lensManager.getLensSession(context, context.activeTabId, false)) {
                    lensManager.closeGoogleLensSelection(context, { closeSidebar: true });
                }
            } catch (_) { }
        }
    }
    if (partial.width != null) {
        state.width = clampSidePanelWidth(context, partial.width);
    }
    if (typeof partial.activePanelId === 'string') {
        const previousPanelId = state.activePanelId;
        state.activePanelId = partial.activePanelId;
        if (previousPanelId === 'lens' && partial.activePanelId !== 'lens' && context.activeTabId && options.closeLens !== false) {
            try {
                const lensManager = require('./lensManager');
                if (lensManager.getLensSession(context, context.activeTabId, false)) {
                    lensManager.closeGoogleLensSelection(context, { closeSidebar: false, destroySidebar: true });
                }
            } catch (_) { }
        }
    }
    if (typeof partial.customUrl !== 'undefined') {
        state.customUrl = partial.customUrl;
    }
    layoutSidePanel(context);
    if (options.broadcast === true) {
        broadcastSidePanelState(context);
    }
}

function layoutSidePanel(context) {
    if (!context?.window || context.window.isDestroyed()) return;

    // Relayout tab content container and active tab view
    const { layoutTabContentContainer, layoutActiveTabView } = require('./tabManager');
    layoutTabContentContainer(context);
    if (context.activeTabId) {
        layoutActiveTabView(context, context.activeTabId);
    }

    // Position WebContentsView if a web/extension URL is active
    const state = getSidePanelState(context);
    if (state?.webContentView && !state.webContentView.webContents.isDestroyed()) {
        const sideWidth = getSidePanelWidth(context);
        if (sideWidth > 0 && state.customUrl && !context.isSidePanelWebContentViewTemporarilyHidden) {
            const { width, height } = context.window.getContentBounds();
            const panelX = Math.max(0, width - sideWidth + 6);
            const panelY = UI_HEIGHT + 38;
            const panelW = Math.max(0, sideWidth - 14);
            const panelH = Math.max(0, height - panelY - 8);
            state.webContentView.setBounds({
                x: panelX,
                y: panelY,
                width: panelW,
                height: panelH,
            });
            const { setNativeViewCornerRadius } = require('./tabManager');
            setNativeViewCornerRadius(state.webContentView, 14);
        } else {
            state.webContentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
    }

    try {
        require('./overlayManager').ensureChromeOverlayOnTop(context);
    } catch (_) { }
}

function attachSidePanelWebContentView(context, url) {
    const state = getSidePanelState(context);
    if (!state || !context?.window?.contentView) return null;

    if (!state.webContentView || state.webContentView.webContents.isDestroyed()) {
        const view = new WebContentsView({
            webPreferences: buildSecureWebPreferences(),
        });
        applyIdentityToWebContents(view.webContents);
        state.webContentView = view;
        context.window.contentView.addChildView(view);
    }

    state.customUrl = url;
    if (url) {
        state.webContentView.webContents.loadURL(url).catch((err) => {
            console.error('Failed to load side panel URL:', url, err?.message || err);
        });
    }
    layoutSidePanel(context);
    try {
        require('./overlayManager').ensureChromeOverlayOnTop(context);
    } catch (_) { }
    return state.webContentView;
}

function detachSidePanelWebContentView(context) {
    const state = getSidePanelState(context);
    if (!state?.webContentView) return;
    try {
        if (!state.webContentView.webContents.isDestroyed()) {
            state.webContentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            if (context?.window?.contentView) {
                context.window.contentView.removeChildView(state.webContentView);
            }
        }
    } catch (_) { }
    state.webContentView = null;
    state.customUrl = null;
    layoutSidePanel(context);
}

function hideSidePanelWebContentViewForShellOverlay(context) {
    const state = getSidePanelState(context);
    if (!state?.webContentView || state.webContentView.webContents.isDestroyed()) return;
    context.isSidePanelWebContentViewTemporarilyHidden = true;
    try {
        if (context.window?.contentView && typeof context.window.contentView.removeChildView === 'function') {
            context.window.contentView.removeChildView(state.webContentView);
        }
        state.webContentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    } catch (_) { }
}

function restoreSidePanelWebContentViewFromShellOverlay(context) {
    const state = getSidePanelState(context);
    if (!state?.webContentView || state.webContentView.webContents.isDestroyed()) {
        context.isSidePanelWebContentViewTemporarilyHidden = false;
        return;
    }
    context.isSidePanelWebContentViewTemporarilyHidden = false;
    layoutSidePanel(context);
}

function destroySidePanel(context) {
    detachSidePanelWebContentView(context);
    context.sidePanelState = null;
}

module.exports = {
    SIDE_PANEL_MIN_WIDTH,
    SIDE_PANEL_DEFAULT_WIDTH,
    WEB_CONTENTS_MIN_WIDTH,
    SIDE_PANEL_HEADER_HEIGHT,
    getSidePanelState,
    getSidePanelWidth,
    isSidePanelOpen,
    broadcastSidePanelState,
    setSidePanelWidth,
    setSidePanelState,
    layoutSidePanel,
    attachSidePanelWebContentView,
    detachSidePanelWebContentView,
    hideSidePanelWebContentViewForShellOverlay,
    restoreSidePanelWebContentViewFromShellOverlay,
    destroySidePanel,
};
