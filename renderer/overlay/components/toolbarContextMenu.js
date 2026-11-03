import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderToolbarContextMenu(payload) {
    hideAll({ hideLens: false });
    const buttonId = payload.buttonId;
    if (!buttonId || typeof buttonId !== 'string') return;
    const x = Math.round(Number(payload.clientX) || 0);
    const y = Math.round(Number(payload.clientY) || 0);
    const menuWidth = 190;
    const pad = 8;
    const metrics = getCompactMenuMetrics(payload);

    const fixedHeight = 85;
    let left = x;
    let top = y;
    left = Math.max(pad, Math.min(left, metrics.viewportWidth - menuWidth - pad));
    top = Math.max(pad, Math.min(top, metrics.viewportHeight - fixedHeight - pad));

    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = menuWidth + 'px';
    DOM.panel.style.minWidth = menuWidth + 'px';
    DOM.panel.style.maxHeight = 'none';
    DOM.panel.style.height = 'auto';
    DOM.panel.style.overflow = 'hidden';

    // 1. Unpin Option
    const unpinBtn = document.createElement('button');
    unpinBtn.type = 'button';
    unpinBtn.className = 'co-row';
    unpinBtn.setAttribute('role', 'menuitem');
    unpinBtn.textContent = 'Unpin';
    unpinBtn.addEventListener('click', function () {
        notifyHost({
            type: 'toolbarContextMenu',
            action: 'unpin',
            buttonId: buttonId,
            isPinnedSidepanel: !!payload.isPinnedSidepanel,
        });
    });
    DOM.panel.appendChild(unpinBtn);

    // 2. Customize Toolbar Option
    const customizeBtn = document.createElement('button');
    customizeBtn.type = 'button';
    customizeBtn.className = 'co-row';
    customizeBtn.setAttribute('role', 'menuitem');
    customizeBtn.textContent = 'Customize Toolbar';
    customizeBtn.addEventListener('click', function () {
        notifyHost({
            type: 'toolbarContextMenu',
            action: 'customize',
            buttonId: buttonId,
            isPinnedSidepanel: !!payload.isPinnedSidepanel,
        });
    });
    DOM.panel.appendChild(customizeBtn);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}

