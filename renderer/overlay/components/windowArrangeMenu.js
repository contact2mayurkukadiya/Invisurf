import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

const PANEL_WIDTH = 260;

function createArrangeIcon(layoutId) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 12');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.flexShrink = '0';

    // Outer frame
    const frame = document.createElementNS(svgNS, 'rect');
    frame.setAttribute('x', '0.6');
    frame.setAttribute('y', '0.6');
    frame.setAttribute('width', '14.8');
    frame.setAttribute('height', '10.8');
    frame.setAttribute('rx', '1.5');
    frame.setAttribute('fill', 'var(--chrome-tab-hover-bg, rgba(0,0,0,0.06))');
    frame.setAttribute('stroke', 'currentColor');
    frame.setAttribute('stroke-width', '1.2');
    frame.setAttribute('opacity', '0.65');
    svg.appendChild(frame);

    // Inner region representation
    const fill = document.createElementNS(svgNS, 'rect');
    fill.setAttribute('fill', 'currentColor');
    fill.setAttribute('opacity', '0.95');
    fill.setAttribute('rx', '0.5');

    switch (layoutId) {
        case 'leftHalf':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '9.6');
            break;
        case 'rightHalf':
            fill.setAttribute('x', '8');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '9.6');
            break;
        case 'centerHalf':
            fill.setAttribute('x', '4.6');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '9.6');
            break;
        case 'topHalf':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '13.6');
            fill.setAttribute('height', '4.8');
            break;
        case 'bottomHalf':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '6');
            fill.setAttribute('width', '13.6');
            fill.setAttribute('height', '4.8');
            break;
        case 'topLeft':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '4.8');
            break;
        case 'topRight':
            fill.setAttribute('x', '8');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '4.8');
            break;
        case 'bottomLeft':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '6');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '4.8');
            break;
        case 'bottomRight':
            fill.setAttribute('x', '8');
            fill.setAttribute('y', '6');
            fill.setAttribute('width', '6.8');
            fill.setAttribute('height', '4.8');
            break;
        case 'firstThird':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '4.5');
            fill.setAttribute('height', '9.6');
            break;
        case 'centerThird':
            fill.setAttribute('x', '5.75');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '4.5');
            fill.setAttribute('height', '9.6');
            break;
        case 'lastThird':
            fill.setAttribute('x', '10.3');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '4.5');
            fill.setAttribute('height', '9.6');
            break;
        case 'firstTwoThirds':
            fill.setAttribute('x', '1.2');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '9.1');
            fill.setAttribute('height', '9.6');
            break;
        case 'lastTwoThirds':
            fill.setAttribute('x', '5.7');
            fill.setAttribute('y', '1.2');
            fill.setAttribute('width', '9.1');
            fill.setAttribute('height', '9.6');
            break;
        default:
            break;
    }

    svg.appendChild(fill);
    return svg;
}

const ARRANGE_SECTIONS = [
    [
        { id: 'leftHalf', shortcutKey: 'windowArrangeLeftHalf', label: 'Left Half' },
        { id: 'rightHalf', shortcutKey: 'windowArrangeRightHalf', label: 'Right Half' },
        { id: 'centerHalf', shortcutKey: 'windowArrangeCenterHalf', label: 'Center Half' },
        { id: 'topHalf', shortcutKey: 'windowArrangeTopHalf', label: 'Top Half' },
        { id: 'bottomHalf', shortcutKey: 'windowArrangeBottomHalf', label: 'Bottom Half' },
    ],
    [
        { id: 'topLeft', shortcutKey: 'windowArrangeTopLeft', label: 'Top Left' },
        { id: 'topRight', shortcutKey: 'windowArrangeTopRight', label: 'Top Right' },
        { id: 'bottomLeft', shortcutKey: 'windowArrangeBottomLeft', label: 'Bottom Left' },
        { id: 'bottomRight', shortcutKey: 'windowArrangeBottomRight', label: 'Bottom Right' },
    ],
    [
        { id: 'firstThird', shortcutKey: 'windowArrangeFirstThird', label: 'First Third' },
        { id: 'centerThird', shortcutKey: 'windowArrangeCenterThird', label: 'Center Third' },
        { id: 'lastThird', shortcutKey: 'windowArrangeLastThird', label: 'Last Third' },
        { id: 'firstTwoThirds', shortcutKey: 'windowArrangeFirstTwoThirds', label: 'First Two Thirds' },
        { id: 'lastTwoThirds', shortcutKey: 'windowArrangeLastTwoThirds', label: 'Last Two Thirds' },
    ],
];

export function renderWindowArrangeMenu(patch) {
    hideAll({ hideLens: false });

    const width = PANEL_WIDTH;
    const r = patch.anchorRect || {};
    const metrics = getCompactMenuMetrics(patch);
    const pad = 8;

    const anchorL = Math.round(r.left != null ? r.left : 0);
    const anchorT = Math.round(r.top != null ? r.top : 0);
    const anchorH = Math.max(1, Math.round(r.height != null ? r.height : 32));

    // Align right edge of panel with right edge of anchor button
    const right0 = anchorL + Math.round(r.width != null ? r.width : 0);
    const left0 = right0 - width;
    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(anchorT + anchorH + 6, metrics.viewportHeight - 100 - pad));
    const pt = toCompactMenuPoint(patch, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = pt.left + 'px';
    DOM.panel.style.top = pt.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(200, window.innerHeight - pt.top - 20) + 'px';
    DOM.panel.style.overflowY = 'auto';
    DOM.panel.style.overflowX = 'hidden';
    DOM.panel.style.padding = '6px 0';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.gap = '0px';
    DOM.panel.style.boxSizing = 'border-box';
    DOM.panel.classList.add('co-visible');

    const shortcuts = patch.shortcuts || {};

    ARRANGE_SECTIONS.forEach((section, sIndex) => {
        if (sIndex > 0) {
            const divider = document.createElement('div');
            divider.className = 'co-divider';
            divider.setAttribute('role', 'separator');
            divider.style.margin = '4px 0';
            DOM.panel.appendChild(divider);
        }

        section.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'co-row co-row--arrange';
            row.setAttribute('role', 'menuitem');
            row.style.padding = '7px 14px';
            row.style.gap = '12px';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'co-row__icon';
            iconSpan.style.width = '18px';
            iconSpan.style.height = '14px';
            iconSpan.style.display = 'inline-flex';
            iconSpan.style.alignItems = 'center';
            iconSpan.style.justifyContent = 'center';
            iconSpan.style.flexShrink = '0';
            iconSpan.appendChild(createArrangeIcon(item.id));
            row.appendChild(iconSpan);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'co-row__label';
            labelSpan.textContent = item.label;
            labelSpan.style.fontSize = '13px';
            labelSpan.style.fontWeight = '400';
            row.appendChild(labelSpan);

            const shortcutStr = shortcuts[item.shortcutKey];
            if (shortcutStr) {
                const rightSpan = document.createElement('span');
                rightSpan.className = 'co-row__right';
                rightSpan.textContent = shortcutStr;
                rightSpan.style.fontSize = '12px';
                rightSpan.style.letterSpacing = '0.5px';
                rightSpan.style.opacity = '0.7';
                row.appendChild(rightSpan);
            }

            row.addEventListener('click', () => {
                notifyHost({ type: 'windowArrange', layout: item.id });
                hideAll({ hideLens: false });
            });

            DOM.panel.appendChild(row);
        });
    });
}

