import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

// SVG Assets
const PIN_PINNED_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="17" x2="12" y2="22"></line>
  <path d="M5 17h14v-2l-2-3V6a1 1 0 0 0-1-1h-1V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v2H9a1 1 0 0 0-1 1v6l-2 3v2z"></path>
</svg>
`;

const PIN_SLASH_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="3" y1="3" x2="21" y2="21"></line>
  <path d="M15.5 15.5v1.5h2v-2l-1.6-2.4"></path>
  <path d="M12 17v5"></path>
  <path d="M8 8L5 12.5v2.5h7.5"></path>
  <path d="M10 4V3a1 1 0 0 1 2 0v1h2a1 1 0 0 1 1 1v4.5l-1.5 2.25"></path>
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
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"></circle>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
</svg>
`;

const RADIO_CHECKED_SVG = `
<svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;">
  <circle cx="10" cy="10" r="7.5" stroke="#1a73e8" stroke-width="1.8" fill="none"/>
  <circle cx="10" cy="10" r="4" fill="#1a73e8"/>
</svg>
`;

const RADIO_UNCHECKED_SVG = `
<svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;">
  <circle cx="10" cy="10" r="7.5" stroke="var(--chrome-secondary-fg, #5f6368)" stroke-width="1.8" fill="none"/>
</svg>
`;

/**
 * Creates a single extension item row matching Chrome's Extensions dropdown
 */
function createExtensionRow(ext, payload) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.padding = '7px 8px';
    row.style.borderRadius = '8px';
    row.style.transition = 'background-color 0.15s ease';
    row.style.position = 'relative';
    row.style.userSelect = 'none';
    row.style.webkitUserSelect = 'none';

    row.onmouseenter = () => row.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.05))';
    row.onmouseleave = () => row.style.backgroundColor = 'transparent';

    // Right click anywhere on the row opens context menu for this extension
    row.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMoreMenu(ext, row, payload);
    };

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
        img.alt = '';
        img.style.width = '18px';
        img.style.height = '18px';
        img.style.objectFit = 'contain';
        img.draggable = false;
        if (ext.actionDisabled) {
            img.style.filter = 'grayscale(100%)';
            img.style.opacity = '0.5';
        }
        iconBox.appendChild(img);
    } else {
        const p = document.createElement('span');
        p.textContent = '🧩';
        p.style.fontSize = '14px';
        if (ext.actionDisabled) {
            p.style.filter = 'grayscale(100%)';
            p.style.opacity = '0.5';
        }
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
    pinBtn.innerHTML = ext.pinned ? PIN_PINNED_SVG : PIN_SLASH_SVG;
    pinBtn.style.background = 'transparent';
    pinBtn.style.border = 'none';
    pinBtn.style.color = ext.pinned ? 'var(--chrome-fg, #202124)' : '#1a73e8';
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
        toggleMoreMenu(ext, row, payload);
    };

    actionsRight.appendChild(pinBtn);
    actionsRight.appendChild(moreBtn);

    row.appendChild(infoLeft);
    row.appendChild(actionsRight);
    return row;
}

/**
 * Creates a section header with title and explanatory description
 */
function createSectionHeader(titleText, descText) {
    const sectionIntro = document.createElement('div');
    sectionIntro.style.padding = '8px 14px 6px';
    sectionIntro.style.userSelect = 'none';
    sectionIntro.style.webkitUserSelect = 'none';

    const titleEl = document.createElement('div');
    titleEl.textContent = titleText;
    titleEl.style.fontSize = '12px';
    titleEl.style.fontWeight = '600';
    titleEl.style.color = 'var(--chrome-fg, #202124)';

    const descEl = document.createElement('div');
    descEl.textContent = descText;
    descEl.style.fontSize = '11px';
    descEl.style.color = 'var(--chrome-secondary-fg, #5f6368)';
    descEl.style.marginTop = '2px';
    descEl.style.lineHeight = '1.35';

    sectionIntro.appendChild(titleEl);
    sectionIntro.appendChild(descEl);
    return sectionIntro;
}

/**
 * Renders the Chrome-like "This Can Read and Change Site Data" submenu flyout
 */
function renderSiteAccessFlyout(flyoutContainer, ext, payload, anchorItem) {
    if (!flyoutContainer) return;

    flyoutContainer.innerHTML = '';
    flyoutContainer.style.position = 'fixed';
    flyoutContainer.style.zIndex = '35';
    flyoutContainer.style.width = '260px';
    flyoutContainer.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    flyoutContainer.style.color = 'var(--chrome-fg, #202124)';
    flyoutContainer.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    flyoutContainer.style.borderRadius = '12px';
    flyoutContainer.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--chrome-tab-separator, rgba(0,0,0,0.08))';
    flyoutContainer.style.padding = '6px 0';
    flyoutContainer.style.display = 'flex';
    flyoutContainer.style.flexDirection = 'column';
    flyoutContainer.style.userSelect = 'none';
    flyoutContainer.style.webkitUserSelect = 'none';

    // Position adjacent to the anchor item
    const itemRect = anchorItem.getBoundingClientRect();
    const parentMenu = anchorItem.closest('#panel, #submenu') || anchorItem.parentElement;
    const parentRect = parentMenu ? parentMenu.getBoundingClientRect() : itemRect;

    const flyoutWidth = 260;
    // Prefer opening to the left if space allows (matching Chrome extension context menu)
    let flyoutLeft = parentRect.left - flyoutWidth - 6;
    if (flyoutLeft < 10) {
        flyoutLeft = parentRect.right + 6;
    }
    let flyoutTop = itemRect.top - 6;
    if (flyoutTop + 220 > window.innerHeight) {
        flyoutTop = Math.max(10, window.innerHeight - 230);
    }

    flyoutContainer.style.left = flyoutLeft + 'px';
    flyoutContainer.style.top = flyoutTop + 'px';

    const currentTabHost = payload?.currentTabHost || '';
    const currentMode = ext.siteAccess || (
        (currentTabHost && Array.isArray(ext.allowedHosts) && ext.allowedHosts.includes(currentTabHost))
            ? 'onHost'
            : 'all'
    );

    const radioItems = [
        {
            mode: 'onClick',
            label: 'When You Click the Extension',
            disabled: false,
        },
        {
            mode: 'onHost',
            label: currentTabHost ? `On ${currentTabHost}` : 'On this site',
            disabled: !currentTabHost,
        },
        {
            mode: 'all',
            label: 'On All Sites',
            disabled: false,
        },
    ];

    const radioElements = new Map();

    const selectMode = (targetMode) => {
        radioElements.forEach((iconEl, m) => {
            iconEl.innerHTML = m === targetMode ? RADIO_CHECKED_SVG : RADIO_UNCHECKED_SVG;
        });
        ext.siteAccess = targetMode;
        notifyHost({
            type: 'extensionSetSiteAccess',
            extensionId: ext.id,
            mode: targetMode,
            host: currentTabHost,
        });
        setTimeout(() => {
            hideAll({ hideLens: false });
        }, 160);
    };

    radioItems.forEach(item => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '12px';
        row.style.width = '100%';
        row.style.padding = '8px 16px';
        row.style.border = 'none';
        row.style.backgroundColor = 'transparent';
        row.style.fontSize = '13px';
        row.style.textAlign = 'left';
        row.style.color = item.disabled ? 'var(--chrome-secondary-fg, #80868b)' : 'var(--chrome-fg, #202124)';
        row.style.cursor = item.disabled ? 'default' : 'pointer';
        row.style.transition = 'background-color 0.12s ease';

        if (!item.disabled) {
            row.onmouseenter = () => row.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
            row.onmouseleave = () => row.style.backgroundColor = 'transparent';
        }

        const iconSpan = document.createElement('span');
        iconSpan.style.display = 'flex';
        iconSpan.style.alignItems = 'center';
        iconSpan.style.justifyContent = 'center';
        iconSpan.innerHTML = (currentMode === item.mode) ? RADIO_CHECKED_SVG : RADIO_UNCHECKED_SVG;
        radioElements.set(item.mode, iconSpan);

        const textSpan = document.createElement('span');
        textSpan.textContent = item.label;
        textSpan.style.whiteSpace = 'nowrap';
        textSpan.style.overflow = 'hidden';
        textSpan.style.textOverflow = 'ellipsis';
        textSpan.style.lineHeight = '1.3';

        row.appendChild(iconSpan);
        row.appendChild(textSpan);

        if (!item.disabled) {
            row.onclick = (e) => {
                e.stopPropagation();
                selectMode(item.mode);
            };
        }

        flyoutContainer.appendChild(row);
    });

    // Separator line
    const sep = document.createElement('div');
    sep.style.height = '1px';
    sep.style.margin = '4px 0';
    sep.style.backgroundColor = 'var(--chrome-tab-separator, rgba(0,0,0,0.08))';
    flyoutContainer.appendChild(sep);

    // Learn More About Site Access (aligned with the text of radio options)
    const learnRow = document.createElement('button');
    learnRow.type = 'button';
    learnRow.style.display = 'flex';
    learnRow.style.alignItems = 'center';
    learnRow.style.width = '100%';
    learnRow.style.padding = '8px 16px 8px 46px';
    learnRow.style.border = 'none';
    learnRow.style.backgroundColor = 'transparent';
    learnRow.style.fontSize = '13px';
    learnRow.style.textAlign = 'left';
    learnRow.style.color = 'var(--chrome-fg, #202124)';
    learnRow.style.cursor = 'pointer';
    learnRow.style.transition = 'background-color 0.12s ease';
    learnRow.onmouseenter = () => learnRow.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
    learnRow.onmouseleave = () => learnRow.style.backgroundColor = 'transparent';
    learnRow.onclick = (e) => {
        e.stopPropagation();
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: 'https://support.google.com/chrome_webstore/answer/2664769',
        });
    };

    const learnSpan = document.createElement('span');
    learnSpan.textContent = 'Learn More About Site Access';
    learnRow.appendChild(learnSpan);

    flyoutContainer.appendChild(learnRow);
    flyoutContainer.classList.add('co-visible');
}

/**
 * Builds standard 3-dots extension context menu items
 */
function buildContextMenu(container, ext, payload, flyoutTarget) {
    container.innerHTML = '';
    container.style.userSelect = 'none';
    container.style.webkitUserSelect = 'none';

    let flyoutHideTimer = null;

    const closeFlyout = () => {
        if (flyoutTarget) {
            flyoutTarget.classList.remove('co-visible');
            flyoutTarget.style.display = 'none';
            flyoutTarget.innerHTML = '';
        }
    };

    const scheduleFlyoutClose = () => {
        if (flyoutHideTimer) clearTimeout(flyoutHideTimer);
        flyoutHideTimer = setTimeout(() => {
            closeFlyout();
        }, 220);
    };

    const cancelFlyoutClose = () => {
        if (flyoutHideTimer) {
            clearTimeout(flyoutHideTimer);
            flyoutHideTimer = null;
        }
    };

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
        labelSpan.style.whiteSpace = 'nowrap';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.textOverflow = 'ellipsis';
        item.appendChild(labelSpan);

        if (hasArrow) {
            const arrow = document.createElement('span');
            arrow.textContent = '›';
            arrow.style.fontSize = '17px';
            arrow.style.lineHeight = '1';
            arrow.style.color = 'var(--chrome-secondary-fg, #80868b)';
            arrow.style.marginLeft = '8px';
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
    container.appendChild(createMenuItem(ext.name || 'Extension', true));

    // Divider
    const sep = document.createElement('div');
    sep.style.height = '1px';
    sep.style.margin = '4px 0';
    sep.style.backgroundColor = 'var(--chrome-tab-separator, rgba(0,0,0,0.08))';
    container.appendChild(sep);

    // Options item (if extension has an options page)
    if (ext.hasOptionsPage || ext.optionsPage) {
        const optionsItem = createMenuItem('Options', false, () => {
            hideAll({ hideLens: false });
            notifyHost({
                type: 'extensionOpenOptions',
                extensionId: ext.id,
            });
        });
        optionsItem.onmouseenter = () => {
            closeFlyout();
            optionsItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
        };
        container.appendChild(optionsItem);
    }

    // 2. This Can Read and Change Site Data (with dynamic submenu)
    const siteDataItem = createMenuItem('This Can Read and Change Site Data', false, () => {
        renderSiteAccessFlyout(flyoutTarget, ext, payload, siteDataItem);
    }, true);

    siteDataItem.onmouseenter = () => {
        cancelFlyoutClose();
        siteDataItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
        renderSiteAccessFlyout(flyoutTarget, ext, payload, siteDataItem);
    };

    siteDataItem.onmouseleave = () => {
        siteDataItem.style.backgroundColor = 'transparent';
        scheduleFlyoutClose();
    };

    if (flyoutTarget) {
        flyoutTarget.onmouseenter = () => {
            cancelFlyoutClose();
            siteDataItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
        };
        flyoutTarget.onmouseleave = () => {
            siteDataItem.style.backgroundColor = 'transparent';
            scheduleFlyoutClose();
        };
    }

    container.appendChild(siteDataItem);

    // 3. Remove from InviSurf
    const removeItem = createMenuItem('Remove from InviSurf', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionUninstall',
            extensionId: ext.id,
        });
    });
    removeItem.onmouseenter = () => {
        closeFlyout();
        removeItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
    };
    container.appendChild(removeItem);

    // Pin / Unpin (for toolbar action context menu)
    if (payload && payload.contextMenuOnly) {
        const pinLabel = ext.pinned ? 'Unpin' : 'Pin to Toolbar';
        const pinItem = createMenuItem(pinLabel, false, () => {
            hideAll({ hideLens: false });
            notifyHost({
                type: 'extensionTogglePin',
                extensionId: ext.id,
            });
        });
        pinItem.onmouseenter = () => {
            closeFlyout();
            pinItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
        };
        container.appendChild(pinItem);
    }

    // 4. Manage Extension
    const manageItem = createMenuItem('Manage Extension', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: `invisurf://extensions?id=${ext.id}`,
        });
    });
    manageItem.onmouseenter = () => {
        closeFlyout();
        manageItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
    };
    container.appendChild(manageItem);

    // 5. View Web Permissions
    const permissionsItem = createMenuItem('View Web Permissions', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionNavigate',
            url: `invisurf://settings/content`,
        });
    });
    permissionsItem.onmouseenter = () => {
        closeFlyout();
        permissionsItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
    };
    container.appendChild(permissionsItem);

    // 6. Inspect Popup (if extension has popup)
    if (ext.hasPopup) {
        const inspectItem = createMenuItem('Inspect Popup', false, () => {
            hideAll({ hideLens: false });
            notifyHost({
                type: 'extensionInspectPopup',
                extensionId: ext.id,
            });
        });
        inspectItem.onmouseenter = () => {
            closeFlyout();
            inspectItem.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(0, 0, 0, 0.06))';
        };
        container.appendChild(inspectItem);
    }
}

/**
 * Displays the 3-dots submenu for an extension inside the puzzle menu
 */
function toggleMoreMenu(ext, parentRow, payload) {
    if (!DOM.submenu) return;

    if (DOM.submenu.classList.contains('co-visible') && DOM.submenu.__activeExtId === ext.id) {
        DOM.submenu.classList.remove('co-visible');
        DOM.submenu.style.display = 'none';
        if (DOM.flyout) {
            DOM.flyout.classList.remove('co-visible');
            DOM.flyout.style.display = 'none';
        }
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

    buildContextMenu(DOM.submenu, ext, payload, DOM.flyout);
    DOM.submenu.classList.add('co-visible');
}

/**
 * Renders Chrome-styled Extensions dropdown or direct right-click Context Menu
 * 
 * @param {Object} payload
 * @param {Array} [payload.extensions]
 * @param {Object} [payload.selectedExtension]
 * @param {boolean} [payload.contextMenuOnly]
 * @param {string} [payload.currentTabHost]
 * @param {string} [payload.currentTabUrl]
 * @param {Object} [payload.anchorRect]
 */
export function renderExtensionMenu(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.anchorRect || {};
    const metrics = getCompactMenuMetrics(payload);
    const pad = 8;

    // --- Mode A: Direct Right-Click Context Menu on Toolbar Pinned Extension ---
    if (payload.contextMenuOnly && payload.selectedExtension) {
        const ext = payload.selectedExtension;
        const width = 240;

        const left0 = Math.round(r.right != null ? r.right - width : (r.left || 0));
        const top0 = Math.round(r.bottom != null ? r.bottom + 6 : ((r.top || 0) + (r.height || 32) + 6));

        const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
        const top = Math.max(pad, Math.min(top0, metrics.viewportHeight - 220 - pad));
        const panelPoint = toCompactMenuPoint(payload, left, top);

        DOM.panel.innerHTML = '';
        DOM.panel.style.left = panelPoint.left + 'px';
        DOM.panel.style.top = panelPoint.top + 'px';
        DOM.panel.style.width = width + 'px';
        DOM.panel.style.minWidth = width + 'px';
        DOM.panel.style.maxWidth = width + 'px';
        DOM.panel.style.display = 'flex';
        DOM.panel.style.flexDirection = 'column';
        DOM.panel.style.overflow = 'visible';
        DOM.panel.style.borderRadius = '12px';
        DOM.panel.style.padding = '6px 0';
        DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
        DOM.panel.style.color = 'var(--chrome-fg, #202124)';
        DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
        DOM.panel.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
        DOM.panel.classList.remove('co-panel--app-menu');
        DOM.panel.classList.add('co-visible');
        DOM.backdrop.classList.add('co-visible');

        // Here DOM.submenu acts as the secondary flyout for Site Access
        buildContextMenu(DOM.panel, ext, payload, DOM.submenu);
        return;
    }

    // --- Mode B: Full Puzzle Icon Extensions Menu ---
    const width = 320;
    const left0 = Math.round(r.right != null ? r.right - width : (r.left || 0));
    const top0 = Math.round(r.bottom != null ? r.bottom + 6 : ((r.top || 0) + (r.height || 32) + 6));

    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0, metrics.viewportHeight - 200 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);

    // Calculate maximum allowed height for DOM.panel so it never overflows the overlay view or window
    const availableHeight = metrics.overlayBounds && Number.isFinite(Number(metrics.overlayBounds.height))
        ? Math.max(200, Math.round(Number(metrics.overlayBounds.height)) - panelPoint.top - 24)
        : Math.max(200, metrics.viewportHeight - top - pad - 24);
    const maxPanelHeight = Math.min(460, availableHeight);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = maxPanelHeight + 'px';
    DOM.panel.style.padding = '0';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.style.boxSizing = 'border-box';
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
    header.style.padding = '12px 14px 8px';
    header.style.flexShrink = '0';
    header.style.userSelect = 'none';
    header.style.webkitUserSelect = 'none';

    const title = document.createElement('span');
    title.textContent = 'Extensions';
    title.style.fontWeight = '600';
    title.style.fontSize = '15px';
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

    // --- 2. Scrollable Body ---
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'co-extension-menu-body';
    bodyContainer.style.flex = '1 1 auto';
    bodyContainer.style.minHeight = '0';
    bodyContainer.style.overflowY = 'auto';
    bodyContainer.style.overflowX = 'hidden';
    bodyContainer.style.padding = '0 6px 6px';
    bodyContainer.style.overscrollBehavior = 'contain';

    bodyContainer.onscroll = () => {
        if (DOM.submenu && DOM.submenu.classList.contains('co-visible')) {
            DOM.submenu.classList.remove('co-visible');
            DOM.submenu.style.display = 'none';
        }
        if (DOM.flyout && DOM.flyout.classList.contains('co-visible')) {
            DOM.flyout.classList.remove('co-visible');
            DOM.flyout.style.display = 'none';
        }
    };

    if (extensions.length === 0) {
        const emptyBox = document.createElement('div');
        emptyBox.style.padding = '24px 14px';
        emptyBox.style.textAlign = 'center';
        emptyBox.style.color = 'var(--chrome-secondary-fg, #5f6368)';
        emptyBox.style.fontSize = '13px';
        emptyBox.textContent = 'No extensions installed yet';
        bodyContainer.appendChild(emptyBox);
    } else {
        const fullAccessExts = extensions.filter(e => e.hasHostAccess !== false);
        const noAccessExts = extensions.filter(e => e.hasHostAccess === false);

        // Section: Full access
        if (fullAccessExts.length > 0) {
            bodyContainer.appendChild(createSectionHeader(
                'Full access',
                'These extensions can see and change information on this site.'
            ));
            fullAccessExts.forEach(ext => {
                bodyContainer.appendChild(createExtensionRow(ext, payload));
            });
        }

        // Section: No access needed
        if (noAccessExts.length > 0) {
            bodyContainer.appendChild(createSectionHeader(
                'No access needed',
                "These extensions don't need to see and change information on this site."
            ));
            noAccessExts.forEach(ext => {
                bodyContainer.appendChild(createExtensionRow(ext, payload));
            });
        }
    }

    DOM.panel.appendChild(bodyContainer);

    // --- 3. Footer: Divider + Manage Extensions ---
    const footer = document.createElement('div');
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    footer.style.padding = '4px 6px';
    footer.style.flexShrink = '0';
    footer.style.userSelect = 'none';
    footer.style.webkitUserSelect = 'none';
    footer.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';

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
