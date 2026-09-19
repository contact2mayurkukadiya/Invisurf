import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

// ---------------------------------------------------------------------------
// Transparency Menu — horizontal [−] [slider] [+] popup
// Opens below the eye icon button, styled exactly like the standard overlay
// panel (same DOM.panel element, same CSS tokens, same backdrop).
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 260;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function dispatchOpacity(pct) {
    notifyHost({ type: 'transparencySetOpacity', opacity: clamp(pct, 2, 100) / 100 });
}

function syncFill(slider, pct) {
    slider.value = String(pct);
    slider.style.setProperty('--tm-pct', pct + '%');
}

export function renderTransparencyMenu(patch) {
    hideAll({ hideLens: false });

    let pct = typeof patch.opacityPercent === 'number'
        ? clamp(Math.round(patch.opacityPercent), 2, 100)
        : 100;

    // ── Position: drop below the trigger button ───────────────────────────
    const r       = patch.anchorRect || {};
    const metrics = getCompactMenuMetrics(patch);
    const pad     = 8;

    const anchorL = Math.round(r.left   != null ? r.left   : 0);
    const anchorT = Math.round(r.top    != null ? r.top    : 0);
    const anchorH = Math.max(1, Math.round(r.height != null ? r.height : 32));

    // Align right edge of panel with right edge of anchor button
    const right0  = anchorL + Math.round(r.width != null ? r.width : 0);
    const left0   = right0 - PANEL_WIDTH;
    const left    = clamp(left0, pad, metrics.viewportWidth - PANEL_WIDTH - pad);
    const top     = clamp(anchorT + anchorH + 6, pad, metrics.viewportHeight - 80 - pad);
    const pt      = toCompactMenuPoint(patch, left, top);

    // ── Build panel ───────────────────────────────────────────────────────
    DOM.panel.innerHTML = '';
    DOM.panel.style.left     = pt.left + 'px';
    DOM.panel.style.top      = pt.top  + 'px';
    DOM.panel.style.width    = PANEL_WIDTH + 'px';
    DOM.panel.style.minWidth = PANEL_WIDTH + 'px';
    DOM.panel.style.maxWidth = PANEL_WIDTH + 'px';
    DOM.panel.style.maxHeight = 'none';
    DOM.panel.style.height    = 'auto';
    DOM.panel.style.overflow  = 'hidden';
    DOM.panel.style.padding   = '10px 14px';
    DOM.panel.style.display   = 'flex';
    DOM.panel.style.alignItems = 'center';
    DOM.panel.style.gap       = '10px';
    DOM.panel.style.boxSizing = 'border-box';

    // ── Step button factory ───────────────────────────────────────────────
    function makeStepBtn(glyph, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.textContent = glyph;
        btn.style.cssText = [
            'flex-shrink:0',
            'width:28px', 'height:28px',
            'display:inline-flex', 'align-items:center', 'justify-content:center',
            'border-radius:6px',
            'border:1px solid var(--chrome-tab-separator,rgba(0,0,0,0.15))',
            'background:transparent',
            'color:var(--chrome-fg,inherit)',
            'font-size:16px', 'font-weight:400',
            'cursor:pointer',
            'transition:background 0.1s ease',
            'line-height:1',
        ].join(';');
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'var(--chrome-tab-hover-bg,rgba(0,0,0,0.07))';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'transparent';
        });
        return btn;
    }

    const minusBtn = makeStepBtn('−', 'Decrease opacity');
    const plusBtn  = makeStepBtn('+', 'Increase opacity');

    // ── Slider ────────────────────────────────────────────────────────────
    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '2';
    slider.max   = '100';
    slider.step  = '1';
    slider.className = 'tm-slider';
    slider.setAttribute('aria-label', 'Window opacity');
    slider.style.flex = '1';
    syncFill(slider, pct);

    // ── Events ────────────────────────────────────────────────────────────
    // Visual update fires on every tick (live badge + fill) — no IPC here.
    slider.addEventListener('input', () => {
        pct = Number(slider.value);
        syncFill(slider, pct);
    });

    // Opacity is only applied when pointer is released — prevents Chromium
    // from breaking pointer capture due to win.setOpacity() layer repaint.
    slider.addEventListener('change', () => {
        pct = Number(slider.value);
        syncFill(slider, pct);
        dispatchOpacity(pct);
    });

    minusBtn.addEventListener('click', () => {
        // Snap to nearest 5% multiple then step down
        const snapped = Math.round(pct / 5) * 5;
        pct = clamp(snapped - 5, 2, 100);
        if (pct < 5) pct = 2;
        syncFill(slider, pct);
        dispatchOpacity(pct);
    });

    plusBtn.addEventListener('click', () => {
        const snapped = Math.round(pct / 5) * 5;
        pct = clamp(snapped + 5, 2, 100);
        syncFill(slider, pct);
        dispatchOpacity(pct);
    });

    // ── Assemble ──────────────────────────────────────────────────────────
    DOM.panel.appendChild(minusBtn);
    DOM.panel.appendChild(slider);
    DOM.panel.appendChild(plusBtn);

    // Show — standard backdrop + panel visibility
    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}
