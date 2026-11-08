
const { WebContentsView, clipboard, nativeImage } = require('electron');
const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const {
    UI_HEIGHT, LENS_SIDEBAR_MIN_WIDTH, LENS_SIDEBAR_DEFAULT_RATIO,
    LENS_SIDEBAR_MAX_RATIO, LENS_PANEL_GAP, LENS_WORKSPACE_PADDING,
    LENS_SITE_CONTAINER_MAX_SCALE, LENS_PAGE_MIN_SCALE, LENS_PANEL_RADIUS,
    LENS_MOBILE_USER_AGENT
} = require('../constants/defaults');
const { getWindowContextByBrowserWindow, isViewWebContentsAlive } = require('./windowContextUtils');

// Lazy requires for cyclic breaking
// const { layoutActiveTabView, addTabContentChildView, removeTabContentChildView, resetTabWebContentsScale } = require('./tabManager');
// const { createChromeOverlayLayer, layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
// const { loadSettings, getChromeOverlayThemePatchForContext } = require('../services/settingsService');
// const { isGoogleLensSearchableUrl } = require('../utils/navigation');

function getLensSession(context, tabId = context?.activeTabId, create = false) {
    if (!context || !tabId) return null;
    if (!context.lensSessions) context.lensSessions = new Map();
    let sessionState = context.lensSessions.get(tabId);
    if (!sessionState && create) {
        sessionState = {
            tabId,
            sidebarHostView: null,
            sidebarView: null,
            sidebarWidth: null,
            selectionActive: false,
            overlayAcquired: false,
            siteBounds: null,
            lastSelection: null,
            lastSelectionRatio: null,
            lastSelectionText: '',
            lastSelectionImage: null,
            textSnapshot: null,
            pageZoomFactorBeforeLens: null,
            pageScale: 1,
            sourceWidth: null,
            sourceHeight: null,
            magnifierImage: null,
            hasSearchResults: false,
            snapshotSentToOverlay: false,
        };
        context.lensSessions.set(tabId, sessionState);
    }
    return sessionState || null;
}

function destroyLensSidebarViews(context, lensSession) {
    if (!lensSession) return;
    const sidebarView = lensSession.sidebarView;
    const hostView = lensSession.sidebarHostView || sidebarView;
    if (hostView && context?.window?.contentView && typeof context.window.contentView.removeChildView === 'function') {
        try { context.window.contentView.removeChildView(hostView); } catch (_) { }
    }
    const { removeTabContentChildView } = require('./tabManager');
    if (sidebarView) {
        removeTabContentChildView(context, hostView);
        const wc = sidebarView.webContents;
        if (wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) {
            try { wc.removeAllListeners(); } catch (_) { }
            try {
                if (wc.debugger?.isAttached?.()) wc.debugger.detach();
            } catch (_) { }
            try { wc.destroy(); } catch (_) { }
        }
        lensSession.sidebarView = null;
    }
    if (lensSession.sidebarHostView) {
        try {
            if (sidebarView) lensSession.sidebarHostView.removeChildView(sidebarView);
        } catch (_) { }
        lensSession.sidebarHostView = null;
    }
    lensSession.hasSearchResults = false;
}

function suspendLensSessionPresentation(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!context || !tabId || !lensSession?.selectionActive) return false;
    const hostView = lensSession.sidebarHostView || lensSession.sidebarView;
    if (hostView && context?.window?.contentView && typeof context.window.contentView.removeChildView === 'function') {
        try { context.window.contentView.removeChildView(hostView); } catch (_) { }
    }
    const { removeTabContentChildView } = require('./tabManager');

    if (lensSession.sidebarView) {
        removeTabContentChildView(context, hostView);
    }

    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    lensSession.overlayAcquired = false;
    lensSession.snapshotSentToOverlay = false;
    repairLensChromeOverlayAcquireCount(context);

    if ((context.chromeOverlayAcquireCount || 0) <= 0 && isViewWebContentsAlive(context.chromeOverlayView)) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }

    if (context.activeTabId === tabId) {
        context.lensOverlayBounds = null;
        context.chromeOverlayFullWindowMode = false;
        context.isActiveTabTemporarilyHidden = false;
        context.activeTabViewRemovedForShellOverlay = false;
        context.isLensSidebarTemporarilyHidden = false;
    }
    return true;
}

function getFirstActiveLensTabId(context) {
    if (!context?.lensSessions) return null;
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        if (!sessionState?.selectionActive) continue;
        const view = context.tabs[tabId];
        if (view && !view.webContents.isDestroyed()) return tabId;
    }
    return null;
}

function findActiveLensTabForProfile(profileId) {
    if (!profileId) return null;
    for (const context of State.windowContextsById.values()) {
        if (!context || context.profileId !== profileId) continue;
        const tabId = getFirstActiveLensTabId(context);
        if (tabId) return { context, tabId };
    }
    return null;
}

function countLensOverlayAcquires(context) {
    if (!context?.lensSessions) return 0;
    let required = 0;
    for (const sessionState of context.lensSessions.values()) {
        if (sessionState?.selectionActive && sessionState.overlayAcquired) required += 1;
    }
    return required;
}

function repairLensChromeOverlayAcquireCount(context) {
    const required = countLensOverlayAcquires(context);
    if (required > 0 && (context.chromeOverlayAcquireCount || 0) < required) {
        context.chromeOverlayAcquireCount = required;
    }
}

function ensureLensOverlayAcquired(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return;
    const { createChromeOverlayLayer } = require('./overlayManager');
    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount = (context.chromeOverlayAcquireCount || 0) + 1;
        lensSession.overlayAcquired = true;
    } else if ((context.chromeOverlayAcquireCount || 0) <= 0) {
        context.chromeOverlayAcquireCount = 1;
    }
}

function restoreActiveLensTabPresentation(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return false;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return false;

    const sidePanelManager = require('./sidePanelManager');
    const spState = sidePanelManager.getSidePanelState(context);
    if (!spState?.isOpen || spState?.activePanelId !== 'lens') {
        sidePanelManager.setSidePanelState(context, {
            isOpen: true,
            activePanelId: 'lens',
            width: lensSession.sidebarWidth || sidePanelManager.getSidePanelWidth(context) || 380,
        }, { broadcast: true });
    }

    const { hideActiveTabViewForShellOverlay, layoutActiveTabView } = require('./tabManager');
    hideActiveTabViewForShellOverlay(context);
    context.isLensSidebarTemporarilyHidden = false;
    layoutActiveTabView(context, tabId);
    layoutLensSidebar(context, tabId);
    ensureLensOverlayAcquired(context, tabId);
    repairLensChromeOverlayAcquireCount(context);
    const result = postLensSelectionPatch(context, { forceSnapshot: true });
    const { ensureChromeOverlayOnTop } = require('./overlayManager');
    ensureChromeOverlayOnTop(context);
    return result;
}

function getLensSidebarWidth(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !lensSession.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return 0;
    const sidePanelManager = require('./sidePanelManager');
    const spWidth = sidePanelManager.getSidePanelWidth(context);
    if (spWidth > 0) return spWidth;
    const { width } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(width * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const preferredWidth = lensSession.sidebarWidth || Math.floor(width * LENS_SIDEBAR_DEFAULT_RATIO);
    return Math.max(minWidth, Math.min(preferredWidth, maxWidth));
}

function getLensLayoutMetrics(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return null;
    const { width, height } = context.window.getContentBounds();
    const fs = State.htmlFullscreenTabId === tabId;
    const sidebarWidth = fs ? 0 : getLensSidebarWidth(context, tabId);
    const topUiHeight = UI_HEIGHT + (context.isScreenSharingActive ? 38 : 0);
    const contentTop = fs ? 0 : topUiHeight;
    const contentHeight = fs ? height : Math.max(0, height - topUiHeight);
    const panelGap = fs || sidebarWidth <= 0 ? 0 : LENS_PANEL_GAP;
    const sidebarBounds = sidebarWidth > 0 ? {
        x: Math.max(0, width - sidebarWidth + 6),
        y: contentTop + 38,
        width: Math.max(0, sidebarWidth - 14),
        height: Math.max(0, contentHeight - 38 - 8),
    } : { x: width, y: contentTop, width: 0, height: contentHeight };
    const leftPanelBounds = sidebarWidth > 0 ? {
        x: 8,
        y: contentTop + 4,
        width: Math.max(0, width - sidebarWidth - 14),
        height: Math.max(0, contentHeight - 12),
    } : {
        x: 0,
        y: contentTop,
        width,
        height: contentHeight,
    };

    return { width, height, fs, sidebarWidth, panelGap, contentTop, contentHeight, sidebarBounds, leftPanelBounds };
}

function computeLensChromeOverlayBounds(context, tabId = context?.activeTabId) {
    const { width, height } = context.window.getContentBounds();
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics || metrics.sidebarWidth <= 0) {
        return { x: 0, y: UI_HEIGHT, width, height: Math.max(0, height - UI_HEIGHT) };
    }
    return {
        x: 0,
        y: metrics.contentTop,
        width: Math.max(0, width - metrics.sidebarWidth - 6),
        height: metrics.contentHeight,
    };
}

function getActiveTabContentBounds(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const lensSession = getLensSession(context, tabId, false);

    if (lensSession) {
        lensSession.siteBounds = metrics.leftPanelBounds;
        lensSession.pageScale = 1;
    }
    return {
        x: 0,
        y: metrics.fs ? 0 : UI_HEIGHT,
        width: metrics.width,
        height: metrics.contentHeight,
    };
}

function applyLensSidebarMobileViewport(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!context?.window || !sidebarView || sidebarView.webContents.isDestroyed()) return;

    try {
        if (typeof sidebarView.webContents.disableDeviceEmulation === 'function') {
            sidebarView.webContents.disableDeviceEmulation();
        }
    } catch (_) { }

    const metrics = getLensLayoutMetrics(context, tabId);
    const sidebarWidth = Math.max(260, metrics?.sidebarBounds?.width || 360);
    // When resized narrower than 360px, smoothly adjust zoom factor so mobile elements comfortably fit
    const targetZoom = Math.round(Math.min(1.0, Math.max(0.75, sidebarWidth / 360)) * 100) / 100;
    try {
        if (lensSession.lastEmulatedZoom !== targetZoom) {
            sidebarView.webContents.setZoomFactor(targetZoom);
            lensSession.lastEmulatedZoom = targetZoom;
        }
    } catch (_) { }
}

function layoutLensSidebar(context, tabId = context?.activeTabId) {
    if (tabId !== context?.activeTabId) return;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return;
    const hostView = lensSession.sidebarHostView || lensSession.sidebarView;

    if (!lensSession.hasSearchResults || context.isLensSidebarTemporarilyHidden) {
        try {
            hostView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
        return;
    }

    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return;
    const radius = metrics.sidebarWidth > 0 ? LENS_PANEL_RADIUS : 0;
    const { setNativeViewCornerRadius, removeTabContentChildView } = require('./tabManager');

    if (context.window?.contentView && typeof context.window.contentView.addChildView === 'function') {
        try {
            removeTabContentChildView(context, hostView);
            const children = context.window.contentView.children || [];
            if (!children.includes(hostView) || children[children.length - 1] !== hostView) {
                context.window.contentView.addChildView(hostView);
            }
        } catch (_) { }
    }

    const curHostBounds = hostView.getBounds ? hostView.getBounds() : null;
    const boundsChanged = !curHostBounds ||
        curHostBounds.x !== metrics.sidebarBounds.x ||
        curHostBounds.y !== metrics.sidebarBounds.y ||
        curHostBounds.width !== metrics.sidebarBounds.width ||
        curHostBounds.height !== metrics.sidebarBounds.height;

    if (boundsChanged) {
        hostView.setBounds(metrics.sidebarBounds);
    }
    setNativeViewCornerRadius(hostView, radius);
    if (typeof hostView.setBackgroundColor === 'function') {
        try { hostView.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    }
    if (lensSession.sidebarHostView) {
        const curSideBounds = lensSession.sidebarView.getBounds ? lensSession.sidebarView.getBounds() : null;
        if (!curSideBounds || curSideBounds.width !== metrics.sidebarBounds.width || curSideBounds.height !== metrics.sidebarBounds.height) {
            lensSession.sidebarView.setBounds({
                x: 0,
                y: 0,
                width: Math.max(0, metrics.sidebarBounds.width),
                height: Math.max(0, metrics.sidebarBounds.height),
            });
        }
        setNativeViewCornerRadius(lensSession.sidebarView, radius);
    } else {
        setNativeViewCornerRadius(lensSession.sidebarView, radius);
    }
    applyLensSidebarMobileViewport(context, tabId);

    // CRITICAL: Keep overlay menus and prompts strictly above the sidebar content viewer
    try {
        require('./overlayManager').ensureChromeOverlayOnTop(context);
    } catch (_) { }
}

function hideLensSidebarForShellOverlay(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return;
    const hostView = lensSession.sidebarHostView || lensSession.sidebarView;
    context.isLensSidebarTemporarilyHidden = true;
    try {
        if (context.window?.contentView && typeof context.window.contentView.removeChildView === 'function') {
            context.window.contentView.removeChildView(hostView);
        }
        hostView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    } catch (_) { }
}

function restoreLensSidebarFromShellOverlay(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) {
        context.isLensSidebarTemporarilyHidden = false;
        return;
    }
    context.isLensSidebarTemporarilyHidden = false;
    layoutLensSidebar(context, context.activeTabId);
}

function detachLensSidebarsExcept(context, activeTabId) {
    if (!context?.lensSessions) return;
    const { removeTabContentChildView } = require('./tabManager');
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        const sidebarView = sessionState?.sidebarView;
        if (!sidebarView || sidebarView.webContents.isDestroyed()) continue;
        if (tabId === activeTabId) continue;
        const hostView = sessionState.sidebarHostView || sidebarView;
        if (hostView && context?.window?.contentView && typeof context.window.contentView.removeChildView === 'function') {
            try { context.window.contentView.removeChildView(hostView); } catch (_) { }
        }
        removeTabContentChildView(context, hostView);
    }
}

function destroyLensSession(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession) return;
    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    destroyLensSidebarViews(context, lensSession);
    context.lensSessions.delete(tabId);
    repairLensChromeOverlayAcquireCount(context);
    const remainingLensTabId = getFirstActiveLensTabId(context);
    if (!remainingLensTabId && isViewWebContentsAlive(context.chromeOverlayView)) {
        context.chromeOverlayFullWindowMode = false;
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            if (context.chromeOverlayAcquireCount <= 0) {
                context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (_) { }
    } else if (
        context.activeTabId &&
        context.activeTabId === remainingLensTabId &&
        getLensSession(context, context.activeTabId, false)?.selectionActive
    ) {
        restoreActiveLensTabPresentation(context, context.activeTabId);
    }
}

function isLensDarkTheme(context) {
    try {
        const { getChromeOverlayThemePatchForContext } = require('../services/settingsService');
        const patch = getChromeOverlayThemePatchForContext(context);
        return !!patch?.effectiveDark;
    } catch (_) {
        const { nativeTheme } = require('electron');
        return !!nativeTheme?.shouldUseDarkColors;
    }
}

function injectLensSidebarBorderStyles(sidebarView, context) {
    if (!isViewWebContentsAlive(sidebarView)) return;
    const currentUrl = sidebarView.webContents.getURL() || '';
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (lensSession && lensSession.sidebarBorderInjectedForUrl === currentUrl && currentUrl !== '') {
        return;
    }
    if (lensSession) {
        lensSession.sidebarBorderInjectedForUrl = currentUrl;
    }

    const isDark = isLensDarkTheme(context);
    const borderColor = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)';
    const shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.08)';
    const insetShadow = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';

    const css = `
        html, body {
            border-radius: ${LENS_PANEL_RADIUS}px !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
            max-width: 100vw !important;
        }
        *, *::before, *::after {
            box-sizing: border-box !important;
        }
        #center_col, #rso, #cnt, .GyAeWb, .main, .mw, [role="main"] {
            min-width: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            box-sizing: border-box !important;
        }
        form[role="search"], input[type="text"], img {
            max-width: 100% !important;
            box-sizing: border-box !important;
        }
        #invisurf-lens-sidebar-border,
        body::after {
            content: "" !important;
            position: fixed !important;
            inset: 0 !important;
            border-radius: ${LENS_PANEL_RADIUS}px !important;
            border: 1px solid ${borderColor} !important;
            box-shadow: inset 0 0 0 1px ${insetShadow}, 0 1px 4px ${shadowColor} !important;
            pointer-events: none !important;
            z-index: 2147483647 !important;
            box-sizing: border-box !important;
        }
    `;
    sidebarView.webContents.insertCSS(css).catch(() => {});
}

function getChromeShellBackgroundColor(context) {
    const { nativeTheme } = require('electron');
    const { getChromeOverlayThemePatchForContext } = require('../services/settingsService');
    try {
        const patch = getChromeOverlayThemePatchForContext(context);
        return patch?.tokens?.['--chrome-shell-tint'] || patch?.tokens?.['--chrome-shell-bg'] || patch?.tokens?.['--chrome-body-bg'] || (patch?.effectiveDark ? '#253035' : '#ffffff');
    } catch (_) {
        return nativeTheme?.shouldUseDarkColors ? '#253035' : '#ffffff';
    }
}

function injectLensSidebarCloseButton(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!isViewWebContentsAlive(sidebarView)) return;
    const background = getChromeShellBackgroundColor(context);
    const script = `
        (() => {
            const style = document.getElementById('invisurf-lens-panel-style') || document.createElement('style');
            style.id = 'invisurf-lens-panel-style';
            style.textContent = \`
                html { background: ${background} !important; border-radius: ${LENS_PANEL_RADIUS}px !important; overflow-x: hidden !important; }
                body { min-height: 100vh; margin: 0 !important; overflow-x: hidden !important; background: ${background} !important; border-radius: ${LENS_PANEL_RADIUS}px !important; }
                body::-webkit-scrollbar { width: 6px; }
                body::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.4); border-radius: 999px; }
                #invisurf-lens-sidebar-border {
                    position: fixed !important;
                    inset: 0 !important;
                    border-radius: ${LENS_PANEL_RADIUS}px !important;
                    border: 1px solid rgba(128, 128, 128, 0.28) !important;
                    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05) !important;
                    pointer-events: none !important;
                    z-index: 2147483647 !important;
                }
            \`;
            if (!style.parentNode) document.head.appendChild(style);
            document.documentElement.style.backgroundColor = ${JSON.stringify(background)};
            if (document.body) document.body.style.backgroundColor = ${JSON.stringify(background)};

            if (!document.getElementById('invisurf-lens-sidebar-border')) {
                const b = document.createElement('div');
                b.id = 'invisurf-lens-sidebar-border';
                document.documentElement.appendChild(b);
            }

            const meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
            if (!meta.parentNode) document.head.appendChild(meta);
        })();
    `;
    sidebarView.webContents.executeJavaScript(script).catch(() => { });
}

function buildLensSidebarPlaceholderHtml(context) {
    const background = getChromeShellBackgroundColor(context);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: ${background}; color: #7b8188; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { display: grid; place-items: center; }
    body::before { content: ""; position: fixed; inset: 0; border: 1px solid rgba(95, 99, 104, 0.24); border-radius: ${LENS_PANEL_RADIUS}px; box-sizing: border-box; pointer-events: none; }
    .placeholder { max-width: 220px; text-align: center; font-size: 13px; line-height: 1.45; font-weight: 500; }
  </style>
</head>
<body>
  <div class="placeholder">Drag on site to search on Google Lens</div>
</body>
</html>`;
}

function createLensSidebarHostView(context) {
    const { View } = require('electron');
    if (typeof View !== 'function') return null;
    try {
        const host = new View();
        if (typeof host.setBackgroundColor === 'function') {
            host.setBackgroundColor(getChromeShellBackgroundColor(context));
        }
        const { setNativeViewCornerRadius } = require('./tabManager');
        setNativeViewCornerRadius(host, LENS_PANEL_RADIUS);
        return host;
    } catch (_) {
        return null;
    }
}

function openLensSidebarNavigationInTab(context, url, options = {}) {
    const { extractDestinationUrl } = require('../utils/navigation');
    const targetUrl = extractDestinationUrl(String(url || '').trim());
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return false;
    }
    const { openUrlInNewTab } = require('./tabManager');
    return openUrlInNewTab(targetUrl, {
        context,
        background: options.background === true,
        keepLensOpen: true,
    });
}

function getLensSidebarCurrentUrl(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return null;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.sidebarView || !isViewWebContentsAlive(lensSession.sidebarView)) {
        return null;
    }
    try {
        const url = lensSession.sidebarView.webContents.getURL();
        if (url && /^https?:\/\//i.test(url)) {
            return url;
        }
    } catch (_) { }
    return null;
}

function openLensInNewTab(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return false;
    const currentUrl = getLensSidebarCurrentUrl(context, tabId) || 'https://lens.google.com';
    const { openUrlInNewTab } = require('./tabManager');
    return openUrlInNewTab(currentUrl, {
        context,
        background: false,
    });
}

function reloadLensSidebar(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return false;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.sidebarView || !isViewWebContentsAlive(lensSession.sidebarView)) {
        return false;
    }
    try {
        lensSession.sidebarView.webContents.reload();
        return true;
    } catch (_) {
        return false;
    }
}

function createLensSidebar(context, tabId = context?.activeTabId) {
    if (!context || context.window.isDestroyed() || !tabId) return null;
    const lensSession = getLensSession(context, tabId, true);
    if (lensSession.sidebarView && !isViewWebContentsAlive(lensSession.sidebarView)) {
        lensSession.sidebarView = null;
        lensSession.sidebarHostView = null;
    }
    if (isViewWebContentsAlive(lensSession.sidebarView)) {
        return lensSession.sidebarView;
    }

    const sidebar = new WebContentsView({
        webPreferences: buildSecureWebPreferences({ partition: context.partition }),
    });
    try { sidebar.webContents.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    let sidebarHostView = createLensSidebarHostView(context);
    if (sidebarHostView) {
        try {
            sidebarHostView.addChildView(sidebar);
        } catch (_) {
            sidebarHostView = null;
        }
    }

    const { isGoogleLensSidebarUrl, extractDestinationUrl } = require('../utils/navigation');

    sidebar.webContents.setWindowOpenHandler(({ url, disposition }) => {
        const destUrl = extractDestinationUrl(url);
        const lensUrl = isGoogleLensSidebarUrl(destUrl);
        if (lensUrl) {
            sidebar.webContents.loadURL(destUrl).catch(() => { });
            return { action: 'deny' };
        }
        openLensSidebarNavigationInTab(context, destUrl, {
            background: disposition === 'background-tab',
        });
        return { action: 'deny' };
    });
    sidebar.webContents.on('will-navigate', (event, url) => {
        if (String(url || '').startsWith('invisurf-lens://close')) {
            event.preventDefault();
            if (context.activeTabId === tabId) {
                closeGoogleLensSelection(context, { closeSidebar: true });
            } else {
                destroyLensSession(context, tabId);
            }
            return;
        }
        const destUrl = extractDestinationUrl(url);
        const lensUrl = isGoogleLensSidebarUrl(destUrl);
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, destUrl);
        }
    });
    sidebar.webContents.on('will-redirect', (event, url) => {
        const destUrl = extractDestinationUrl(url);
        const lensUrl = isGoogleLensSidebarUrl(destUrl);
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, destUrl);
        }
    });
    const applySidebarChrome = () => {
        applyLensSidebarMobileViewport(context, tabId);
        injectLensSidebarBorderStyles(sidebar, context);
        injectLensSidebarCloseButton(context, tabId);
    };
    sidebar.webContents.on('dom-ready', applySidebarChrome);
    sidebar.webContents.on('did-finish-load', applySidebarChrome);
    sidebar.webContents.on('did-navigate', applySidebarChrome);
    lensSession.sidebarHostView = sidebarHostView;
    lensSession.sidebarView = sidebar;
    sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(buildLensSidebarPlaceholderHtml(context)).toString('base64')}`).catch(() => { });

    if (tabId === context.activeTabId) {
        const hostView = sidebarHostView || sidebar;
        if (context.window?.contentView && typeof context.window.contentView.addChildView === 'function') {
            try {
                const children = context.window.contentView.children || [];
                if (!children.includes(hostView)) {
                    context.window.contentView.addChildView(hostView);
                }
            } catch (_) { }
        }
        layoutLensSidebar(context, tabId);
    }
    return sidebar;
}

function closeGoogleLensSelection(context, { closeSidebar = false, destroySidebar = closeSidebar } = {}) {
    if (!context) return;
    const tabId = context.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (lensSession) lensSession.selectionActive = false;
    context.lensOverlayBounds = null;
    context.chromeOverlayFullWindowMode = false;
    context.isLensSidebarTemporarilyHidden = false;
    if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
        } catch (_) { }
    }
    if (lensSession?.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
        lensSession.overlayAcquired = false;
        repairLensChromeOverlayAcquireCount(context);
        if (context.chromeOverlayAcquireCount <= 0 && context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            try { context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) { }
        }
    }
    if (lensSession) {
        if (context.activeTabId && context.tabs[context.activeTabId] && lensSession.pageZoomFactorBeforeLens !== null) {
            try { context.tabs[context.activeTabId].webContents.setZoomFactor(lensSession.pageZoomFactorBeforeLens || 1); } catch (_) { }
        }
        lensSession.pageZoomFactorBeforeLens = null;
        lensSession.pageScale = 1;
        lensSession.sourceWidth = null;
        lensSession.sourceHeight = null;
        lensSession.siteBounds = null;
        lensSession.fullSnapshot = null;
        lensSession.snapshotDataUrl = null;
        lensSession.magnifierImage = null;
        lensSession.lastSelectionRatio = null;
        lensSession.lastSelectionText = '';
        lensSession.textSnapshot = null;
        lensSession.hasSearchResults = false;
    }
    if ((destroySidebar || closeSidebar) && lensSession) {
        destroyLensSidebarViews(context, lensSession);
        context.lensSessions.delete(tabId);
    }
    if (closeSidebar) {
        const sidePanelManager = require('./sidePanelManager');
        const spState = sidePanelManager.getSidePanelState(context);
        if (spState && spState.activePanelId === 'lens') {
            sidePanelManager.setSidePanelState(context, { isOpen: false }, { broadcast: true });
        }
    }

    const { restoreActiveTabViewFromShellOverlay, layoutActiveTabView } = require('./tabManager');
    if (context.activeTabViewRemovedForShellOverlay || context.isActiveTabTemporarilyHidden) {
        restoreActiveTabViewFromShellOverlay(context);
    } else {
        layoutActiveTabView(context, tabId);
    }
    const { ensureChromeOverlayOnTop } = require('./overlayManager');
    ensureChromeOverlayOnTop(context);
}

function postLensSelectionPatch(context, options = {}) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return false;
    const lensSession = getLensSession(context, context.activeTabId, false);
    if (!lensSession?.selectionActive) return false;

    const forceSnapshot = options.forceSnapshot === true || !lensSession.snapshotSentToOverlay;
    if (forceSnapshot && lensSession.snapshotDataUrl) {
        lensSession.snapshotSentToOverlay = true;
    }

    const lensMetrics = getLensLayoutMetrics(context, context.activeTabId);
    const tabBounds = getActiveTabContentBounds(context, context.activeTabId);
    if (tabBounds.width < 40 || tabBounds.height < 40) return false;

    const { width: windowWidth, height: windowHeight } = context.window.getContentBounds();
    const sidebarWidth = getLensSidebarWidth(context, context.activeTabId);
    const overlayOriginY = context.chromeOverlayFullWindowMode ? 0 : (lensMetrics?.contentTop ?? UI_HEIGHT);
    const backdropTop = context.chromeOverlayFullWindowMode ? (lensMetrics?.contentTop ?? UI_HEIGHT) : 0;
    const overlayHeight = context.chromeOverlayFullWindowMode
        ? windowHeight
        : (lensMetrics?.contentHeight || 0);

    const leftPanel = lensMetrics?.leftPanelBounds || {
        x: 8,
        y: (lensMetrics?.contentTop ?? UI_HEIGHT) + 4,
        width: Math.max(0, windowWidth - sidebarWidth - 14),
        height: Math.max(0, (lensMetrics?.contentHeight ?? windowHeight) - 12),
    };
    const siteBounds = {
        x: leftPanel.x,
        y: Math.max(0, leftPanel.y - overlayOriginY),
        width: leftPanel.width,
        height: leftPanel.height,
    };
    lensSession.siteBounds = {
        x: leftPanel.x,
        y: leftPanel.y,
        width: leftPanel.width,
        height: leftPanel.height,
    };

    const selectionRatio = lensSession.lastSelectionRatio || null;
    const selectionRect = selectionRatio ? {
        x: Math.round(selectionRatio.x * siteBounds.width),
        y: Math.round(selectionRatio.y * siteBounds.height),
        width: Math.max(1, Math.round(selectionRatio.width * siteBounds.width)),
        height: Math.max(1, Math.round(selectionRatio.height * siteBounds.height)),
    } : (lensSession.lastSelection || null);

    const patch = {
        kind: 'lensSelection',
        hint: 'Select any text or image to search with Google Lens',
        sidebarWidth,
        minSidebarWidth: Math.min(LENS_SIDEBAR_MIN_WIDTH, Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO))),
        maxSidebarWidth: Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO)),
        windowWidth,
        panelRadius: LENS_PANEL_RADIUS,
        sourceWidth: lensSession.sourceWidth || windowWidth,
        sourceHeight: lensSession.sourceHeight || (lensMetrics?.contentHeight || 0),
        snapshotDataUrl: forceSnapshot ? lensSession.snapshotDataUrl : undefined,
        siteBounds,
        containerBounds: siteBounds,
        leftPanelBounds: lensMetrics ? {
            x: lensMetrics.leftPanelBounds.x,
            y: Math.max(0, lensMetrics.leftPanelBounds.y - overlayOriginY),
            width: lensMetrics.leftPanelBounds.width,
            height: lensMetrics.leftPanelBounds.height,
        } : null,
        sidebarBounds: lensMetrics ? {
            x: lensMetrics.sidebarBounds.x,
            y: Math.max(0, lensMetrics.sidebarBounds.y - overlayOriginY),
            width: lensMetrics.sidebarBounds.width,
            height: lensMetrics.sidebarBounds.height,
        } : null,
        panelGap: lensMetrics?.panelGap || LENS_PANEL_GAP,
        backdropTop,
        contentHeight: overlayHeight,
        selectionRect,
        selectionRatio,
        hasSearchResults: !!lensSession.hasSearchResults,
        hasSelectionText: !!lensSession.lastSelectionText,
        hasSelection: !!selectionRatio,
    };

    const { layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
    layoutChromeOverlayBounds(context, patch);
    ensureChromeOverlayOnTop(context);
    context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    return true;
}

function resizeGoogleLensSidebar(context, width) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return false;
    const { width: windowWidth } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(windowWidth * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const nextWidth = Math.max(minWidth, Math.min(Math.round(Number(width) || 0), maxWidth));
    lensSession.sidebarWidth = nextWidth;

    const sidePanelManager = require('./sidePanelManager');
    sidePanelManager.setSidePanelWidth(context, nextWidth);

    const { layoutActiveTabView } = require('./tabManager');
    layoutActiveTabView(context, context.activeTabId);

    if (lensSession.selectionActive) {
        const { layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
        layoutChromeOverlayBounds(context, { kind: 'lensSelection' });
        ensureChromeOverlayOnTop(context);
    }
    return true;
}

function commitGoogleLensSidebarResize(context, width) {
    const resized = resizeGoogleLensSidebar(context, width);
    if (resized) {
        applyLensSidebarMobileViewport(context, context?.activeTabId, { immediate: true });
        postLensSelectionPatch(context);
    }
    return resized;
}

function copyLensSelectionImage(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.lastSelectionImage) return false;
    try {
        clipboard.writeImage(nativeImage.createFromBuffer(lensSession.lastSelectionImage));
        return true;
    } catch (error) {
        console.error('Copy Lens image failed:', error?.message || error);
        return false;
    }
}

async function copyLensSelectionText(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    const text = String(lensSession?.lastSelectionText || '').trim();
    if (!text) return false;
    try {
        clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Copy Lens text failed:', error?.message || error);
        return false;
    }
}

async function extractLensPageTextSnapshot(activeView) {
    if (!activeView || activeView.webContents.isDestroyed()) return null;
    const script = `
        (() => {
            const root = document.body || document.documentElement;
            if (!root) return null;
            const vv = window.visualViewport;
            const viewportWidth = Math.max(1, Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1));
            const viewportHeight = Math.max(1, Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 1));
            const words = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const text = node.nodeValue || '';
                    if (!text.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent || parent.closest('script,style,noscript,template')) return NodeFilter.FILTER_REJECT;
                    const style = window.getComputedStyle(parent);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const intersectsViewport = (rect) =>
                rect.width > 0 && rect.height > 0 &&
                rect.right >= 0 && rect.bottom >= 0 &&
                rect.left <= viewportWidth && rect.top <= viewportHeight;
            let node;
            while ((node = walker.nextNode()) && words.length < 4000) {
                const text = node.nodeValue || '';
                const re = /\\S+/g;
                let match;
                while ((match = re.exec(text)) && words.length < 4000) {
                    const range = document.createRange();
                    try {
                        range.setStart(node, match.index);
                        range.setEnd(node, match.index + match[0].length);
                        const rects = Array.from(range.getClientRects()).filter(intersectsViewport);
                        for (const rect of rects) {
                            words.push({ text: match[0], x: rect.left, y: rect.top, width: rect.width, height: rect.height });
                        }
                    } catch (_) { } finally { range.detach(); }
                }
            }
            return { width: viewportWidth, height: viewportHeight, words };
        })();
    `;
    try {
        const snapshot = await activeView.webContents.executeJavaScript(script, true);
        if (!snapshot || !Array.isArray(snapshot.words)) return null;
        return snapshot;
    } catch (error) {
        console.warn('Lens text snapshot failed:', error?.message || error);
        return null;
    }
}

function getLensSelectionText(lensSession, selectionRatio) {
    const snapshot = lensSession?.textSnapshot;
    if (!snapshot?.words?.length || !selectionRatio) return '';
    const rect = {
        x: selectionRatio.x * snapshot.width,
        y: selectionRatio.y * snapshot.height,
        width: selectionRatio.width * snapshot.width,
        height: selectionRatio.height * snapshot.height,
    };
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const intersects = (word) => {
        const wordRight = word.x + word.width;
        const wordBottom = word.y + word.height;
        return wordRight >= rect.x && word.x <= right && wordBottom >= rect.y && word.y <= bottom;
    };
    const selected = snapshot.words
        .filter(intersects)
        .sort((a, b) => {
            const lineDelta = a.y - b.y;
            if (Math.abs(lineDelta) > 8) return lineDelta;
            return a.x - b.x;
        });
    if (!selected.length) return '';
    const lines = [];
    for (const word of selected) {
        const current = lines[lines.length - 1];
        if (!current || Math.abs(word.y - current.y) > Math.max(8, word.height * 0.8)) {
            lines.push({ y: word.y, words: [word.text] });
        } else {
            current.words.push(word.text);
        }
    }
    return lines.map((line) => line.words.join(' ')).join('\n').trim();
}

async function startGoogleLensSelection(context = getWindowContextByBrowserWindow(State.mainWindow)) {
    if (!context || !context.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return false;
    const activeView = context.tabs[context.activeTabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;

    const { isGoogleLensSearchableUrl } = require('../utils/navigation');
    const { activateTabInContext, hideActiveTabViewForShellOverlay, layoutActiveTabView } = require('./tabManager');

    try {
        if (!isGoogleLensSearchableUrl(activeView.webContents.getURL())) return false;
    } catch (_) { return false; }

    const existingLens = findActiveLensTabForProfile(context.profileId);
    if (existingLens) {
        try {
            if (!existingLens.context.window.isDestroyed()) {
                existingLens.context.window.focus();
            }
        } catch (_) { }
        if (existingLens.tabId !== context.activeTabId || existingLens.context !== context) {
            activateTabInContext(existingLens.context, existingLens.tabId);
        } else {
            restoreActiveLensTabPresentation(context, existingLens.tabId);
        }
        return true;
    }

    const lensSession = getLensSession(context, context.activeTabId, true);
    lensSession.selectionActive = true;

    try {
        lensSession.textSnapshot = await extractLensPageTextSnapshot(activeView);
        const image = await activeView.webContents.capturePage();
        if (!image || image.isEmpty()) {
            lensSession.selectionActive = false;
            return false;
        }
        lensSession.fullSnapshot = image;
        const jpegBuffer = typeof image.toJPEG === 'function' ? image.toJPEG(85) : null;
        lensSession.snapshotDataUrl = jpegBuffer
            ? `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`
            : image.toDataURL();

        const size = image.getSize();
        lensSession.sourceWidth = size.width;
        lensSession.sourceHeight = size.height;
    } catch (err) {
        console.error('Failed to capture webpage for Lens:', err);
        lensSession.selectionActive = false;
        return false;
    }

    createLensSidebar(context, context.activeTabId);
    const sidePanelManager = require('./sidePanelManager');
    const { width: windowWidth } = context.window.getContentBounds();
    const defaultLensWidth = Math.max(390, Math.round(windowWidth * LENS_SIDEBAR_DEFAULT_RATIO));
    const initialSidebarWidth = Math.max(380, lensSession.sidebarWidth || sidePanelManager.getSidePanelWidth(context) || defaultLensWidth);
    lensSession.sidebarWidth = initialSidebarWidth;
    sidePanelManager.setSidePanelState(context, {
        isOpen: true,
        activePanelId: 'lens',
        width: initialSidebarWidth,
    }, { broadcast: true });

    // Detach active tab content view so user can interact with Lens selection canvas.
    // Also detach the other split view if active tab is in a split pair.
    if (context.activeTabId && !State.detachedTabWindows.has(context.activeTabId)) {
        const view = context.tabs[context.activeTabId];
        if (view && !view.webContents.isDestroyed()) {
            context.isActiveTabTemporarilyHidden = true;
            try {
                const { removeTabContentChildView } = require('./tabManager');
                removeTabContentChildView(context, view);
                context.activeTabViewRemovedForShellOverlay = true;
            } catch (_) {
                try { view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) {}
            }
        }

        const splitTabManager = require('./splitTabManager');
        const splitPair = splitTabManager.getSplitPairByTabId(context, context.activeTabId);
        if (splitPair) {
            const otherTabId = splitPair.leftTabId === context.activeTabId ? splitPair.rightTabId : splitPair.leftTabId;
            const otherView = otherTabId ? context.tabs[otherTabId] : null;
            if (otherView && !otherView.webContents?.isDestroyed()) {
                try {
                    const { removeTabContentChildView } = require('./tabManager');
                    removeTabContentChildView(context, otherView);
                } catch (_) {
                    try { otherView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) {}
                }
            }
        }
    }
    context.isLensSidebarTemporarilyHidden = false;
    layoutActiveTabView(context, context.activeTabId);

    const { createChromeOverlayLayer } = require('./overlayManager');
    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount += 1;
        lensSession.overlayAcquired = true;
    }

    return postLensSelectionPatch(context, { forceSnapshot: true });
}

async function submitLensImageInSidebar(context, tabId, pngBuffer, dimensions) {
    const sidebar = createLensSidebar(context, tabId);
    if (!isViewWebContentsAlive(sidebar)) return false;

    const background = getChromeShellBackgroundColor(context);
    const loadingHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Lens</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${background};color:#7b8188;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{display:grid;place-items:center}
    .loading{display:grid;place-items:center;gap:12px;text-align:center;font-size:13px;font-weight:500}
    .spinner{width:26px;height:26px;border:3px solid rgba(123,129,136,.28);border-top-color:#1a73e8;border-radius:50%;animation:s 1s linear infinite}
    body::before{content:"";position:fixed;inset:0;border:1px solid rgba(95,99,104,.24);border-radius:${LENS_PANEL_RADIUS}px;box-sizing:border-box;pointer-events:none}
    p{margin:0}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p>Searching with Google Lens...</p>
  </div>
</body>
</html>`;

    // Immediately present clean loading state in the sidebar
    try {
        await sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(loadingHtml).toString('base64')}`);
    } catch (_) { }

    try {
        const sess = sidebar.webContents.session;
        let cookieHeader = '';
        try {
            if (sess?.cookies) {
                const existing = await sess.cookies.get({ domain: '.google.com' });
                if (existing?.length) {
                    cookieHeader = existing.map(c => `${c.name}=${c.value}`).join('; ');
                }
            }
        } catch (_) { }

        const userAgent = sidebar.webContents.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
        const uploadUrl = `https://lens.google.com/v3/upload?ep=subb&hl=en&st=${Date.now()}`;
        const form = new FormData();
        const blob = new Blob([pngBuffer], { type: 'image/png' });
        form.append('encoded_image', blob, 'invisurf-lens.png');
        form.append('processed_image_dimensions', `${dimensions.width},${dimensions.height}`);

        const headers = {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://lens.google.com',
            'Referer': 'https://lens.google.com/',
        };
        if (cookieHeader) {
            headers['Cookie'] = cookieHeader;
        }

        const fetchFn = (sess?.net && typeof sess.net.fetch === 'function')
            ? sess.net.fetch.bind(sess.net)
            : fetch;

        const response = await fetchFn(uploadUrl, {
            method: 'POST',
            body: form,
            redirect: 'manual',
            headers,
        });

        // Sync returned Set-Cookie headers into sidebar session
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader && sess?.cookies) {
            const cookieEntries = setCookieHeader.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
            for (const cStr of cookieEntries) {
                const [nv] = cStr.split(';');
                const eqIdx = nv.indexOf('=');
                if (eqIdx > 0) {
                    const name = nv.slice(0, eqIdx).trim();
                    const value = nv.slice(eqIdx + 1).trim();
                    try {
                        await sess.cookies.set({
                            url: 'https://www.google.com',
                            name,
                            value,
                            domain: '.google.com',
                            path: '/',
                            secure: true,
                            sameSite: 'no_restriction',
                        });
                    } catch (_) { }
                }
            }
        }

        let targetUrl = response.headers.get('location');
        if (!targetUrl && (response.status === 200 || response.status === 302 || response.status === 303)) {
            targetUrl = response.url;
        }

        if (!targetUrl || targetUrl.includes('lens.google.com/v3/upload')) {
            targetUrl = 'https://www.google.com/search?q=google+lens';
        }

        if (!isViewWebContentsAlive(sidebar)) return false;

        return new Promise((resolve) => {
            let finished = false;
            const cleanup = () => {
                sidebar.webContents.removeListener('did-navigate', onNavigate);
                sidebar.webContents.removeListener('did-fail-load', onFail);
            };
            const onNavigate = (_event, url) => {
                const u = String(url || '');
                if (u.includes('google.') || u.includes('/search')) {
                    finished = true;
                    cleanup();
                    applyLensSidebarMobileViewport(context, tabId);
                    injectLensSidebarBorderStyles(sidebar, context);
                    injectLensSidebarCloseButton(context, tabId);
                    resolve(true);
                }
            };
            const onFail = (_event, _errorCode, errorDescription) => {
                if (finished) return;
                cleanup();
                console.error('Google Lens sidebar load failed:', errorDescription);
                resolve(false);
            };
            sidebar.webContents.on('did-navigate', onNavigate);
            sidebar.webContents.on('did-fail-load', onFail);

            sidebar.webContents.loadURL(targetUrl).catch((err) => {
                cleanup();
                console.error('Failed to load Google Lens target URL:', err?.message || err);
                resolve(false);
            });

            setTimeout(() => {
                if (finished || !isViewWebContentsAlive(sidebar)) return;
                cleanup();
                applyLensSidebarMobileViewport(context, tabId);
                resolve(true);
            }, 8000);
        });
    } catch (uploadError) {
        console.error('Google Lens main-process upload failed:', uploadError?.message || uploadError);
        return false;
    }
}

async function captureGoogleLensSelection(context, payload = {}) {
    const tabId = context?.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !tabId) return false;
    const activeView = context.tabs[tabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;

    try {
        if (!lensSession.fullSnapshot || lensSession.fullSnapshot.isEmpty()) {
            try {
                const snap = await activeView.webContents.capturePage();
                if (snap && !snap.isEmpty()) {
                    lensSession.fullSnapshot = snap;
                    const jpegBuffer = typeof snap.toJPEG === 'function' ? snap.toJPEG(85) : null;
                    lensSession.snapshotDataUrl = jpegBuffer
                        ? `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`
                        : snap.toDataURL();
                    const s = snap.getSize();
                    lensSession.sourceWidth = s.width;
                    lensSession.sourceHeight = s.height;
                }
            } catch (_) { }
        }
        if (!lensSession.fullSnapshot || lensSession.fullSnapshot.isEmpty()) return false;

        const origSize = lensSession.fullSnapshot.getSize();
        let ratio = payload?.ratio || null;
        if (!ratio) {
            const r = payload?.rect || payload;
            if (r && typeof r === 'object') {
                const site = lensSession.siteBounds || { width: origSize.width, height: origSize.height };
                const rx = Number(r.x) || 0;
                const ry = Number(r.y) || 0;
                const rw = Number(r.width) || 0;
                const rh = Number(r.height) || 0;
                if (rw > 0 && rh > 0) {
                    ratio = {
                        x: rx / (site.width || 1),
                        y: ry / (site.height || 1),
                        width: rw / (site.width || 1),
                        height: rh / (site.height || 1),
                    };
                }
            }
        }
        if (!ratio) return false;

        const safeRatioX = Math.max(0, Math.min(1, Number(ratio.x) || 0));
        const safeRatioY = Math.max(0, Math.min(1, Number(ratio.y) || 0));
        const safeRatioW = Math.max(0.005, Math.min(1 - safeRatioX, Number(ratio.width) || 0));
        const safeRatioH = Math.max(0.005, Math.min(1 - safeRatioY, Number(ratio.height) || 0));

        const x = Math.max(0, Math.round(safeRatioX * origSize.width));
        const y = Math.max(0, Math.round(safeRatioY * origSize.height));
        const width = Math.max(1, Math.round(safeRatioW * origSize.width));
        const height = Math.max(1, Math.round(safeRatioH * origSize.height));

        const safeX = Math.min(x, origSize.width - 1);
        const safeY = Math.min(y, origSize.height - 1);
        const safeWidth = Math.max(1, Math.min(width, origSize.width - safeX));
        const safeHeight = Math.max(1, Math.min(height, origSize.height - safeY));

        const croppedImage = lensSession.fullSnapshot.crop({ x: safeX, y: safeY, width: safeWidth, height: safeHeight });
        const png = croppedImage.toPNG();

        lensSession.lastSelectionRatio = {
            x: safeRatioX,
            y: safeRatioY,
            width: safeRatioW,
            height: safeRatioH,
        };
        lensSession.lastSelection = {
            x: safeX,
            y: safeY,
            width: safeWidth,
            height: safeHeight,
        };
        lensSession.lastSelectionText = getLensSelectionText(lensSession, lensSession.lastSelectionRatio);
        lensSession.lastSelectionImage = png;
        lensSession.hasSearchResults = true;

        // Ensure sidebar is not marked temporarily hidden and ensure side panel is open in main & renderer
        context.isLensSidebarTemporarilyHidden = false;
        const sidePanelManager = require('./sidePanelManager');
        const spState = sidePanelManager.getSidePanelState(context);
        if (!spState?.isOpen || spState?.activePanelId !== 'lens') {
            sidePanelManager.setSidePanelState(context, {
                isOpen: true,
                activePanelId: 'lens',
                width: lensSession.sidebarWidth || sidePanelManager.getSidePanelWidth(context) || 380,
            }, { broadcast: true });
        }

        // Immediately update layout and broadcast patch so sidebar becomes visible with loading spinner
        layoutLensSidebar(context, tabId);
        postLensSelectionPatch(context);
        require('./overlayManager').ensureChromeOverlayOnTop(context);

        // Submit to Google Lens in sidebar (already mounted and visible to the user)
        await submitLensImageInSidebar(context, tabId, png, { width: safeWidth, height: safeHeight });

        if (context.activeTabId === tabId && lensSession.selectionActive) {
            postLensSelectionPatch(context);
            require('./overlayManager').ensureChromeOverlayOnTop(context);
            try {
                const sidebar = lensSession.sidebarView;
                if (sidebar && !sidebar.webContents.isDestroyed()) {
                    sidebar.webContents.focus();
                }
            } catch (_) { }
        }
        return true;
    } catch (error) {
        console.error('Google Lens capture failed:', error?.message || error);
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return false;
    }
}

async function refreshLensMagnifierSnapshot(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const view = tabId ? context?.tabs?.[tabId] : null;
    if (!lensSession?.selectionActive || !view || view.webContents.isDestroyed()) return false;
    try {
        const image = await view.webContents.capturePage();
        if (!image || image.isEmpty()) return false;
        lensSession.magnifierImage = image.toDataURL();
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return true;
    } catch (error) {
        console.error('Lens magnifier snapshot failed:', error?.message || error);
        return false;
    }
}

module.exports = {
    getLensSession,
    destroyLensSidebarViews,
    suspendLensSessionPresentation,
    getFirstActiveLensTabId,
    findActiveLensTabForProfile,
    countLensOverlayAcquires,
    repairLensChromeOverlayAcquireCount,
    ensureLensOverlayAcquired,
    restoreActiveLensTabPresentation,
    getLensSidebarWidth,
    getLensLayoutMetrics,
    computeLensChromeOverlayBounds,
    getActiveTabContentBounds,
    applyLensSidebarMobileViewport,
    layoutLensSidebar,
    hideLensSidebarForShellOverlay,
    restoreLensSidebarFromShellOverlay,
    detachLensSidebarsExcept,
    destroyLensSession,
    getChromeShellBackgroundColor,
    injectLensSidebarCloseButton,
    injectLensSidebarBorderStyles,
    isLensDarkTheme,
    buildLensSidebarPlaceholderHtml,
    createLensSidebarHostView,
    openLensSidebarNavigationInTab,
    getLensSidebarCurrentUrl,
    openLensInNewTab,
    reloadLensSidebar,
    createLensSidebar,
    closeGoogleLensSelection,
    postLensSelectionPatch,
    resizeGoogleLensSidebar,
    commitGoogleLensSidebarResize,
    copyLensSelectionImage,
    copyLensSelectionText,
    extractLensPageTextSnapshot,
    getLensSelectionText,
    startGoogleLensSelection,
    submitLensImageInSidebar,
    captureGoogleLensSelection,
    refreshLensMagnifierSnapshot
};