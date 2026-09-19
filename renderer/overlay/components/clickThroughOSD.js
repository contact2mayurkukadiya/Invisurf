import { DOM, hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

// ---------------------------------------------------------------------------
// Click-Through Notification Menu — rendered naturally like bookmarkContextMenu
// inside #panel with standard theme tokens, divider, and natural menu shadow.
// ---------------------------------------------------------------------------

let autoHideTimer = null;

onHideAll(() => {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }
});

export function renderClickThroughOSD(patch) {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }

    hideAll({ hideLens: false });

    const enabled = !!patch?.isClickThrough;
    const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
    const shortcut = patch?.shortcutLabel || (isMac ? '⌘⇧G' : 'Ctrl+Shift+G');

    const menuWidth = 280;
    const metrics = getCompactMenuMetrics(patch);
    const left = Math.round((metrics.viewportWidth - menuWidth) / 2);
    const top = 80;
    const panelPoint = toCompactMenuPoint(patch, left, top);

    // ── Panel (Exact same natural #panel structure as bookmarkContextMenu) ──
    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = menuWidth + 'px';
    DOM.panel.style.minWidth = menuWidth + 'px';
    DOM.panel.style.maxHeight = 'none';
    DOM.panel.style.height = 'auto';
    DOM.panel.style.overflow = 'hidden';

    // ── Row 1: Status & Badge ──────────────────────────────────────────────
    const row1 = document.createElement('div');
    row1.className = 'co-click-through-menu-row';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'co-click-through-menu-left';

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'font-size:15px;line-height:1;display:inline-flex;align-items:center;';
    icon.textContent = enabled ? '🖱️' : '🎯';

    const title = document.createElement('span');
    title.className = 'co-click-through-menu-title';
    title.textContent = enabled ? 'Click-Through ON' : 'Click-Through OFF';

    leftGroup.appendChild(icon);
    leftGroup.appendChild(title);

    const badge = document.createElement('span');
    const badgeDot = document.createElement('span');
    badgeDot.className = 'co-click-through-badge-dot';
    const badgeText = document.createElement('span');

    if (enabled) {
        badge.className = 'co-click-through-menu-badge co-click-through-menu-badge--passthrough';
        badgeText.textContent = 'Passthrough';
    } else {
        badge.className = 'co-click-through-menu-badge co-click-through-menu-badge--ghost';
        badgeText.textContent = 'Ghost';
    }
    badge.appendChild(badgeDot);
    badge.appendChild(badgeText);

    row1.appendChild(leftGroup);
    row1.appendChild(badge);

    // ── Divider (Standard natural menu divider) ────────────────────────────
    const divider = document.createElement('div');
    divider.className = 'co-divider';
    divider.setAttribute('role', 'separator');

    // ── Row 2: Shortcut hint ───────────────────────────────────────────────
    const row2 = document.createElement('div');
    row2.className = 'co-click-through-menu-hint';

    const hintText = document.createElement('span');
    hintText.textContent = enabled ? 'Clicks pass through' : 'Window captures clicks';

    const kbd = document.createElement('kbd');
    kbd.textContent = shortcut;

    row2.appendChild(hintText);
    row2.appendChild(kbd);

    DOM.panel.appendChild(row1);
    DOM.panel.appendChild(divider);
    DOM.panel.appendChild(row2);

    // Show panel (no backdrop so window remains clickable)
    DOM.panel.classList.add('co-visible');
    DOM.backdrop.classList.remove('co-visible');

    // Auto-hide after 2.2 seconds
    autoHideTimer = setTimeout(() => {
        autoHideTimer = null;
        hideAll({ hideLens: false });
        notifyHost({ type: 'clickThroughOSDHide' });
    }, 2200);
}
