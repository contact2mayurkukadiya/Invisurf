import { DOM, hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

let activeKeyDownHandler = null;

export function renderZoomReset(payload) {
    hideAll({ hideLens: false });

    const ar = payload.anchorRect || {};
    const panelWidth = 248;
    const panelHeight = 52;
    const left0 = Math.round(Number(ar.left) || 0);
    const top0 = Math.round(Number(ar.top) || 0);
    const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
    const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
    const metrics = getCompactMenuMetrics(payload);

    let left = left0 + w0 - panelWidth + 12;
    left = Math.max(8, Math.min(left, metrics.viewportWidth - panelWidth - 8));
    let top = top0 + h0 + 6;
    top = Math.max(8, Math.min(top, metrics.viewportHeight - panelHeight - 8));

    const panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.className = 'co-panel--zoom-bubble';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = panelWidth + 'px';
    DOM.panel.style.minWidth = panelWidth + 'px';
    DOM.panel.style.maxWidth = panelWidth + 'px';
    DOM.panel.style.height = panelHeight + 'px';
    DOM.panel.style.minHeight = panelHeight + 'px';
    DOM.panel.style.maxHeight = panelHeight + 'px';

    let currentZoom = Number(payload.zoomFactor) || 1.0;

    const container = document.createElement('div');
    container.className = 'co-zoom-container';

    const percentEl = document.createElement('span');
    percentEl.className = 'co-zoom-percent';
    percentEl.textContent = Math.round(currentZoom * 100) + '%';

    const controls = document.createElement('div');
    controls.className = 'co-zoom-controls';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'co-zoom-btn co-zoom-btn--minus';
    minusBtn.title = 'Zoom out';
    minusBtn.setAttribute('aria-label', 'Zoom out');
    minusBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'co-zoom-btn co-zoom-btn--plus';
    plusBtn.title = 'Zoom in';
    plusBtn.setAttribute('aria-label', 'Zoom in');
    plusBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'co-zoom-reset-btn';
    resetBtn.textContent = 'Reset';

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);

    container.appendChild(percentEl);
    container.appendChild(controls);
    container.appendChild(resetBtn);

    DOM.panel.appendChild(container);

    minusBtn.onclick = async function (e) {
        e.stopPropagation();
        try {
            if (window.electronAPI && window.electronAPI.tabZoomOut) {
                const newZoom = await window.electronAPI.tabZoomOut();
                if (newZoom != null) {
                    currentZoom = newZoom;
                    percentEl.textContent = Math.round(newZoom * 100) + '%';
                }
            }
        } catch (err) {
            console.error('tabZoomOut error:', err);
        }
    };

    plusBtn.onclick = async function (e) {
        e.stopPropagation();
        try {
            if (window.electronAPI && window.electronAPI.tabZoomIn) {
                const newZoom = await window.electronAPI.tabZoomIn();
                if (newZoom != null) {
                    currentZoom = newZoom;
                    percentEl.textContent = Math.round(newZoom * 100) + '%';
                }
            }
        } catch (err) {
            console.error('tabZoomIn error:', err);
        }
    };

    resetBtn.onclick = async function (e) {
        e.stopPropagation();
        try {
            if (window.electronAPI && window.electronAPI.tabZoomReset) {
                await window.electronAPI.tabZoomReset();
            }
            percentEl.textContent = '100%';
            hideAll();
            notifyHost({ type: 'dismiss' });
        } catch (err) {
            console.error('tabZoomReset error:', err);
        }
    };

    if (activeKeyDownHandler) {
        window.removeEventListener('keydown', activeKeyDownHandler);
        activeKeyDownHandler = null;
    }

    activeKeyDownHandler = function (e) {
        if (e.key === '=' || e.key === '+' || ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+'))) {
            e.preventDefault();
            plusBtn.click();
        } else if (e.key === '-' || ((e.ctrlKey || e.metaKey) && e.key === '-')) {
            e.preventDefault();
            minusBtn.click();
        } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            resetBtn.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideAll();
            notifyHost({ type: 'dismiss' });
        }
    };

    window.addEventListener('keydown', activeKeyDownHandler);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}

onHideAll(function () {
    if (activeKeyDownHandler) {
        window.removeEventListener('keydown', activeKeyDownHandler);
        activeKeyDownHandler = null;
    }
});
