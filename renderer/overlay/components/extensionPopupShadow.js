import { DOM, hideAll } from '../state.js';
import { toCompactMenuPoint } from '../utils/dom.js';

/**
 * Renders a native-like drop shadow panel behind an active extension WebContentsView popup.
 *
 * @param {Object} payload
 * @param {Object} payload.popupRect { left, top, width, height }
 */
export function renderExtensionPopupShadow(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.popupRect || {};
    const w = Math.max(1, Math.round(Number(r.width) || 380));
    const h = Math.max(1, Math.round(Number(r.height) || 420));
    const panelPoint = toCompactMenuPoint(payload, r.left, r.top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = w + 'px';
    DOM.panel.style.minWidth = w + 'px';
    DOM.panel.style.maxWidth = w + 'px';
    DOM.panel.style.height = h + 'px';
    DOM.panel.style.minHeight = h + 'px';
    DOM.panel.style.maxHeight = h + 'px';
    DOM.panel.style.display = 'block';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.style.borderRadius = '8px';
    DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.14))';
    DOM.panel.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.3), 0 4px 14px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    DOM.panel.style.pointerEvents = 'none';
    DOM.panel.classList.remove('co-panel--app-menu');
    DOM.panel.classList.add('co-visible');
    DOM.backdrop.classList.add('co-visible');
}
