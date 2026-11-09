import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

const TAB_GROUP_COLORS = [
    { id: 'grey', name: 'Grey', lightBg: '#dadce0', darkBg: '#5f6368', text: '#202124', darkText: '#e8eaed' },
    { id: 'blue', name: 'Blue', lightBg: '#d2e3fc', darkBg: '#174ea6', text: '#174ea6', darkText: '#d2e3fc' },
    { id: 'red', name: 'Red', lightBg: '#fad2cf', darkBg: '#a50e0e', text: '#a50e0e', darkText: '#fad2cf' },
    { id: 'yellow', name: 'Yellow', lightBg: '#feefc3', darkBg: '#b06000', text: '#b06000', darkText: '#feefc3' },
    { id: 'green', name: 'Green', lightBg: '#ceead6', darkBg: '#0d652d', text: '#0d652d', darkText: '#ceead6' },
    { id: 'pink', name: 'Pink', lightBg: '#fddfe8', darkBg: '#b80672', text: '#b80672', darkText: '#fddfe8' },
    { id: 'purple', name: 'Purple', lightBg: '#f3e8fd', darkBg: '#7627bb', text: '#7627bb', darkText: '#f3e8fd' },
    { id: 'cyan', name: 'Cyan', lightBg: '#cbf0f8', darkBg: '#007b83', text: '#007b83', darkText: '#cbf0f8' },
    { id: 'orange', name: 'Orange', lightBg: '#fedfc8', darkBg: '#b03c00', text: '#b03c00', darkText: '#fedfc8' },
];

const CHECKMARK_SVG = `<svg class="group-editor-checkmark" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" /></svg>`;

export function renderTabGroupEditor(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const groupId = payload.groupId;
    let currentColor = payload.color || 'grey';
    const isDark = document.documentElement.getAttribute('data-forced-appearance') === 'dark'
        || (document.documentElement.style.colorScheme === 'dark');

    const ar = payload.anchorRect || {};
    const panelWidth = 260;
    const left0 = Math.round(Number(ar.left) || 0);
    const top0 = Math.round(Number(ar.top) || 0);
    const h0 = Math.max(1, Math.round(Number(ar.height) || 24));
    const metrics = getCompactMenuMetrics(payload);

    let left = Math.max(8, Math.min(left0, metrics.viewportWidth - panelWidth - 8));
    let top = top0 + h0 + 4;
    const estH = 310;
    top = Math.max(8, Math.min(top, metrics.viewportHeight - estH - 8));

    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = panelWidth + 'px';
    DOM.panel.style.minWidth = panelWidth + 'px';
    DOM.panel.style.maxWidth = panelWidth + 'px';
    DOM.panel.classList.add('co-panel--tab-group', 'group-editor-popup');

    // 1. Title Input
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'group-editor-input-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group-editor-title-input';
    input.placeholder = 'Name this group';
    input.maxLength = 50;
    input.value = payload.title || '';
    input.setAttribute('autocomplete', 'off');

    input.addEventListener('input', () => {
        notifyHost({
            type: 'tabGroupSetTitle',
            groupId,
            title: input.value,
        });
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            notifyHost({ type: 'dismiss', reason: e.key.toLowerCase() });
            hideAll({ hideLens: false });
        }
    });

    inputWrapper.appendChild(input);
    DOM.panel.appendChild(inputWrapper);

    // 2. Swatches Row
    const swatchesContainer = document.createElement('div');
    swatchesContainer.className = 'group-editor-swatches';
    swatchesContainer.setAttribute('role', 'radiogroup');
    swatchesContainer.setAttribute('aria-label', 'Group color');

    const swatchButtons = [];

    const updateSwatchSelection = (chosenId) => {
        currentColor = chosenId;
        swatchButtons.forEach(({ btn, colorDef }) => {
            const isSel = colorDef.id === chosenId;
            btn.classList.toggle('group-editor-swatch--selected', isSel);
            btn.setAttribute('aria-checked', isSel ? 'true' : 'false');
            btn.innerHTML = isSel ? CHECKMARK_SVG : '';
            if (isSel) {
                const mark = btn.querySelector('svg');
                if (mark) mark.style.fill = isDark ? colorDef.darkText : colorDef.text;
            }
        });
    };

    TAB_GROUP_COLORS.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'group-editor-swatch';
        btn.setAttribute('data-color', c.id);
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', c.name);
        btn.style.backgroundColor = isDark ? c.darkBg : c.lightBg;

        btn.addEventListener('click', () => {
            updateSwatchSelection(c.id);
            notifyHost({
                type: 'tabGroupSetColor',
                groupId,
                color: c.id,
            });
        });

        swatchButtons.push({ btn, colorDef: c });
        swatchesContainer.appendChild(btn);
    });

    updateSwatchSelection(currentColor);
    DOM.panel.appendChild(swatchesContainer);

    // 3. Divider
    const divider = document.createElement('div');
    divider.className = 'group-editor-divider';
    DOM.panel.appendChild(divider);

    // 4. Action Menu Buttons
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'group-editor-actions';

    const createActionBtn = (label, svgPath, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'group-editor-action-btn';

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'group-editor-action-icon');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('viewBox', '0 0 16 16');
        icon.setAttribute('fill', 'currentColor');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', svgPath);
        icon.appendChild(path);

        const span = document.createElement('span');
        span.textContent = label;

        btn.appendChild(icon);
        btn.appendChild(span);
        btn.addEventListener('click', () => {
            onClick();
            hideAll({ hideLens: false });
        });
        return btn;
    };

    // "New tab in group"
    actionsContainer.appendChild(createActionBtn(
        'New tab in group',
        'M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z',
        () => notifyHost({ type: 'tabGroupNewTab', groupId })
    ));

    // "Ungroup"
    actionsContainer.appendChild(createActionBtn(
        'Ungroup',
        'M2.5 4a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11zm0 4a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11zm0 4a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11z',
        () => notifyHost({ type: 'tabGroupUngroup', groupId })
    ));

    // "Close group"
    actionsContainer.appendChild(createActionBtn(
        'Close group',
        'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z',
        () => notifyHost({ type: 'tabGroupCloseGroup', groupId })
    ));

    // "Move group to new window"
    actionsContainer.appendChild(createActionBtn(
        'Move group to new window',
        'M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zm0 1h13a.5.5 0 0 1 .5.5V4H1v-.5a.5.5 0 0 1 .5-.5zM1 5h14v7.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V5z',
        () => notifyHost({ type: 'tabGroupMoveNewWindow', groupId })
    ));

    DOM.panel.appendChild(actionsContainer);

    if (DOM.backdrop) DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');

    requestAnimationFrame(() => {
        try {
            input.focus();
            input.select();
        } catch (_) {}
    });
}
