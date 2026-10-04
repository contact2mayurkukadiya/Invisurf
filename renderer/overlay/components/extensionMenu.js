import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

// SVG Assets
const PIN_ACTIVE_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="#1a73e8" stroke="#1a73e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="17" x2="12" y2="22"></line>
  <path d="M5 17h14v-2l-2-3V6a1 1 0 0 0-1-1h-1V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v2H9a1 1 0 0 0-1 1v6l-2 3v2z"></path>
</svg>
`;

const PIN_INACTIVE_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="17" x2="12" y2="22"></line>
  <path d="M5 17h14v-2l-2-3V6a1 1 0 0 0-1-1h-1V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v2H9a1 1 0 0 0-1 1v6l-2 3v2z"></path>
</svg>
`;

const DOTS_VERTICAL_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
  <circle cx="12" cy="5" r="2"></circle>
  <circle cx="12" cy="12" r="2"></circle>
  <circle cx="12" cy="19" r="2"></circle>
</svg>
`;

const CLOSE_SVG = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>
`;

const GEAR_SVG = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"></circle>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
</svg>
`;

/**
 * Renders Chrome-styled Extensions dropdown menu inside top-level overlay WebContentsView.
 * Fully theme-consistent with the active user setting (Light, Dark, Presets).
 * 
 * @param {Object} payload
 * @param {Array} payload.extensions
 * @param {Object} [payload.anchorRect]
 */
export function renderExtensionMenu(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.anchorRect || {};
    const width = 310;
    const metrics = getCompactMenuMetrics(payload);
    const pad = 8;

    const left0 = Math.round(r.right != null ? r.right - width : (r.left || 0));
    const top0 = Math.round(r.bottom != null ? r.bottom + 6 : ((r.top || 0) + (r.height || 32) + 6));

    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0, metrics.viewportHeight - 200 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(220, Math.min(500, metrics.viewportHeight - top - pad)) + 'px';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.overflow = 'visible';
    DOM.panel.style.borderRadius = '12px';
    DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.panel.style.color = 'var(--chrome-fg, #202124)';
    DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    DOM.panel.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.22), 0 0 0 1px var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    DOM.panel.classList.remove('co-panel--app-menu');
    DOM.panel.classList.add('co-visible');
    DOM.backdrop.classList.add('co-visible');

    const extensions = Array.isArray(payload.extensions) ? payload.extensions : [];

    // --- 1. Header (Extensions + Close Button) ---
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '12px 14px 10px';

    const title = document.createElement('span');
    title.textContent = 'Extensions';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';
    title.style.color = 'var(--chrome-fg, #202124)';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'var(--chrome-secondary-fg, #5f6368)';
    closeBtn.style.padding = '4px';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.transition = 'background-color 0.15s ease';
    closeBtn.onmouseenter = () => closeBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0,0,0,0.06))';
    closeBtn.onmouseleave = () => closeBtn.style.backgroundColor = 'transparent';
    closeBtn.onclick = () => {
        hideAll({ hideLens: false });
        notifyHost({ type: 'dismiss' });
    };

    header.appendChild(title);
    header.appendChild(closeBtn);
    DOM.panel.appendChild(header);

    // --- 2. Section: Full access ---
    const sectionIntro = document.createElement('div');
    sectionIntro.style.padding = '2px 14px 10px';

    const sectionTitle = document.createElement('div');
    sectionTitle.textContent = 'Full access';
    sectionTitle.style.fontSize = '12px';
    sectionTitle.style.fontWeight = '600';
    sectionTitle.style.color = 'var(--chrome-fg, #202124)';

    const sectionDesc = document.createElement('div');
    sectionDesc.textContent = 'These extensions can see and change information on this site.';
    sectionDesc.style.fontSize = '11px';
    sectionDesc.style.color = 'var(--chrome-secondary-fg, #5f6368)';
    sectionDesc.style.marginTop = '2px';
    sectionDesc.style.lineHeight = '1.35';

    sectionIntro.appendChild(sectionTitle);
    sectionIntro.appendChild(sectionDesc);
    DOM.panel.appendChild(sectionIntro);

    // --- 3. Extension List ---
    const listContainer = document.createElement('div');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.padding = '0 6px 8px';
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';
    listContainer.style.gap = '2px';

    if (extensions.length === 0) {
        const emptyBox = document.createElement('div');
        emptyBox.style.padding = '18px 14px';
        emptyBox.style.textAlign = 'center';
        emptyBox.style.color = 'var(--chrome-secondary-fg, #5f6368)';
        emptyBox.style.fontSize = '12px';
        emptyBox.textContent = 'No extensions installed yet';
        listContainer.appendChild(emptyBox);
    } else {
        extensions.forEach(ext => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '6px 8px';
            row.style.borderRadius = '8px';
            row.style.transition = 'background-color 0.15s ease';
            row.style.position = 'relative';

            row.onmouseenter = () => row.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.05))';
            row.onmouseleave = () => row.style.backgroundColor = 'transparent';

            // Left: Icon + Name
            const infoLeft = document.createElement('div');
            infoLeft.style.display = 'flex';
            infoLeft.style.alignItems = 'center';
            infoLeft.style.gap = '10px';
            infoLeft.style.flex = '1';
            infoLeft.style.minWidth = '0';
            infoLeft.style.cursor = 'pointer';
            infoLeft.onclick = () => {
                hideAll({ hideLens: false });
                notifyHost({
                    type: 'extensionActivate',
                    extensionId: ext.id,
                });
            };

            const iconBox = document.createElement('div');
            iconBox.style.width = '24px';
            iconBox.style.height = '24px';
            iconBox.style.display = 'flex';
            iconBox.style.alignItems = 'center';
            iconBox.style.justifyContent = 'center';
            iconBox.style.flexShrink = '0';

            if (ext.iconDataUrl) {
                const img = document.createElement('img');
                img.src = ext.iconDataUrl;
                img.style.width = '18px';
                img.style.height = '18px';
                img.style.objectFit = 'contain';
                iconBox.appendChild(img);
            } else {
                const p = document.createElement('span');
                p.textContent = '🧩';
                p.style.fontSize = '14px';
                iconBox.appendChild(p);
            }

            const extName = document.createElement('div');
            extName.textContent = ext.name || 'Extension';
            extName.style.fontSize = '13px';
            extName.style.fontWeight = '400';
            extName.style.color = 'var(--chrome-fg, #202124)';
            extName.style.whiteSpace = 'nowrap';
            extName.style.overflow = 'hidden';
            extName.style.textOverflow = 'ellipsis';

            infoLeft.appendChild(iconBox);
            infoLeft.appendChild(extName);

            // Right: Pin Button + 3-Dots Button
            const actionsRight = document.createElement('div');
            actionsRight.style.display = 'flex';
            actionsRight.style.alignItems = 'center';
            actionsRight.style.gap = '2px';
            actionsRight.style.flexShrink = '0';

            // 1. Pin icon button
            const pinBtn = document.createElement('button');
            pinBtn.type = 'button';
            pinBtn.title = ext.pinned ? 'Unpin from toolbar' : 'Pin to toolbar';
            pinBtn.innerHTML = ext.pinned ? PIN_ACTIVE_SVG : PIN_INACTIVE_SVG;
            pinBtn.style.background = 'transparent';
            pinBtn.style.border = 'none';
            pinBtn.style.color = ext.pinned ? 'var(--chrome-accent, #1a73e8)' : 'var(--chrome-secondary-fg, #5f6368)';
            pinBtn.style.padding = '4px 6px';
            pinBtn.style.borderRadius = '6px';
            pinBtn.style.cursor = 'pointer';
            pinBtn.style.display = 'flex';
            pinBtn.style.alignItems = 'center';
            pinBtn.style.justifyContent = 'center';
            pinBtn.style.transition = 'background-color 0.15s ease';
            pinBtn.onmouseenter = () => pinBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0,0,0,0.08))';
            pinBtn.onmouseleave = () => pinBtn.style.backgroundColor = 'transparent';
            pinBtn.onclick = (e) => {
                e.stopPropagation();
                notifyHost({
                    type: 'extensionTogglePin',
                    extensionId: ext.id,
                });
            };

            // 2. 3-Dots More Options button
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.title = 'More options';
            moreBtn.innerHTML = DOTS_VERTICAL_SVG;
            moreBtn.style.background = 'transparent';
            moreBtn.style.border = 'none';
            moreBtn.style.color = 'var(--chrome-secondary-fg, #5f6368)';
            moreBtn.style.padding = '4px 6px';
            moreBtn.style.borderRadius = '6px';
            moreBtn.style.cursor = 'pointer';
            moreBtn.style.display = 'flex';
            moreBtn.style.alignItems = 'center';
            moreBtn.style.justifyContent = 'center';
            moreBtn.style.transition = 'background-color 0.15s ease';
            moreBtn.onmouseenter = () => moreBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0,0,0,0.08))';
            moreBtn.onmouseleave = () => moreBtn.style.backgroundColor = 'transparent';

            moreBtn.onclick = (e) => {
                e.stopPropagation();
                toggleMoreMenu(ext, row);
            };

            actionsRight.appendChild(pinBtn);
            actionsRight.appendChild(moreBtn);

            row.appendChild(infoLeft);
            row.appendChild(actionsRight);
            listContainer.appendChild(row);
        });
    }

    DOM.panel.appendChild(listContainer);

    // --- 4. Footer: Divider + Manage Extensions ---
    const footer = document.createElement('div');
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    footer.style.padding = '6px';

    const manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.style.display = 'flex';
    manageBtn.style.alignItems = 'center';
    manageBtn.style.gap = '10px';
    manageBtn.style.width = '100%';
    manageBtn.style.padding = '8px 10px';
    manageBtn.style.borderRadius = '8px';
    manageBtn.style.border = 'none';
    manageBtn.style.backgroundColor = 'transparent';
    manageBtn.style.color = 'var(--chrome-fg, #202124)';
    manageBtn.style.fontSize = '13px';
    manageBtn.style.fontWeight = '500';
    manageBtn.style.cursor = 'pointer';
    manageBtn.style.textAlign = 'left';
    manageBtn.style.transition = 'background-color 0.15s ease';
    manageBtn.onmouseenter = () => manageBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0,0,0,0.06))';
    manageBtn.onmouseleave = () => manageBtn.style.backgroundColor = 'transparent';

    const gearSpan = document.createElement('span');
    gearSpan.innerHTML = GEAR_SVG;
    gearSpan.style.display = 'flex';
    gearSpan.style.alignItems = 'center';
    gearSpan.style.color = 'var(--chrome-secondary-fg, #5f6368)';

    const manageText = document.createElement('span');
    manageText.textContent = 'Manage Extensions';

    manageBtn.appendChild(gearSpan);
    manageBtn.appendChild(manageText);
    manageBtn.onclick = () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: 'invisurf://extensions',
        });
    };

    footer.appendChild(manageBtn);
    DOM.panel.appendChild(footer);
}

/**
 * Displays the 3-dots submenu for an extension matching Screenshot 1
 */
function toggleMoreMenu(ext, parentRow) {
    if (!DOM.submenu) return;

    if (DOM.submenu.classList.contains('co-visible') && DOM.submenu.__activeExtId === ext.id) {
        DOM.submenu.classList.remove('co-visible');
        DOM.submenu.style.display = 'none';
        return;
    }

    DOM.submenu.__activeExtId = ext.id;
    DOM.submenu.innerHTML = '';
    DOM.submenu.style.position = 'fixed';
    DOM.submenu.style.zIndex = '30';
    DOM.submenu.style.width = '240px';
    DOM.submenu.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.submenu.style.color = 'var(--chrome-fg, #202124)';
    DOM.submenu.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    DOM.submenu.style.borderRadius = '12px';
    DOM.submenu.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--chrome-tab-separator, rgba(0,0,0,0.08))';
    DOM.submenu.style.padding = '6px 0';
    DOM.submenu.style.display = 'flex';
    DOM.submenu.style.flexDirection = 'column';

    // Position adjacent to the row
    const rect = parentRow.getBoundingClientRect();
    let subLeft = rect.left - 246;
    if (subLeft < 10) subLeft = rect.right + 6;
    let subTop = rect.top;
    if (subTop + 240 > window.innerHeight) {
        subTop = Math.max(10, window.innerHeight - 250);
    }
    DOM.submenu.style.left = subLeft + 'px';
    DOM.submenu.style.top = subTop + 'px';

    const createMenuItem = (label, isHeader = false, onClick = null, hasArrow = false) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.width = '100%';
        item.style.padding = '8px 16px';
        item.style.border = 'none';
        item.style.backgroundColor = 'transparent';
        item.style.fontSize = '13px';
        item.style.textAlign = 'left';
        item.style.cursor = isHeader ? 'default' : 'pointer';

        if (isHeader) {
            item.style.color = 'var(--chrome-secondary-fg, #80868b)';
            item.style.fontWeight = '500';
            item.style.padding = '8px 16px 4px';
        } else {
            item.style.color = 'var(--chrome-fg, #202124)';
            item.onmouseenter = () => item.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
            item.onmouseleave = () => item.style.backgroundColor = 'transparent';
        }

        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);

        if (hasArrow) {
            const arrow = document.createElement('span');
            arrow.textContent = '›';
            arrow.style.fontSize = '16px';
            arrow.style.color = 'var(--chrome-secondary-fg, #80868b)';
            item.appendChild(arrow);
        }

        if (onClick) {
            item.onclick = (e) => {
                e.stopPropagation();
                onClick();
            };
        }

        return item;
    };

    // 1. Header (Extension name)
    DOM.submenu.appendChild(createMenuItem(ext.name, true));

    // Divider
    const sep = document.createElement('div');
    sep.style.height = '1px';
    sep.style.margin = '4px 0';
    sep.style.backgroundColor = 'var(--chrome-tab-separator, rgba(0,0,0,0.08))';
    DOM.submenu.appendChild(sep);

    // 2. This Can Read and Change Site Data
    DOM.submenu.appendChild(createMenuItem('This Can Read and Change Site Data', false, () => {
        // Site data permissions view or switch
        notifyHost({
            type: 'extensionSiteAccess',
            extensionId: ext.id,
        });
    }, true));

    // 3. Remove from InviSurf
    DOM.submenu.appendChild(createMenuItem('Remove from InviSurf', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionUninstall',
            extensionId: ext.id,
        });
    }));

    // 4. Manage Extension
    DOM.submenu.appendChild(createMenuItem('Manage Extension', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: `invisurf://extensions?id=${ext.id}`,
        });
    }));

    // 5. View Web Permissions
    DOM.submenu.appendChild(createMenuItem('View Web Permissions', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: `invisurf://settings/content`,
        });
    }));

    DOM.submenu.classList.add('co-visible');
}
