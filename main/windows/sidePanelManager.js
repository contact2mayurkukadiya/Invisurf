'use strict';

const State = require('../state');
const { UI_HEIGHT } = require('../constants/defaults');

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
    }
    if (partial.width != null) {
        state.width = clampSidePanelWidth(context, partial.width);
    }
    if (typeof partial.activePanelId === 'string') {
        state.activePanelId = partial.activePanelId;
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

    // Relayout tab content container and active tab view (purely resizes the tab area)
    const { layoutTabContentContainer, layoutActiveTabView } = require('./tabManager');
    layoutTabContentContainer(context);
    if (context.activeTabId) {
        layoutActiveTabView(context, context.activeTabId);
    }
}

function destroySidePanel(context) {
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
    destroySidePanel,
};
