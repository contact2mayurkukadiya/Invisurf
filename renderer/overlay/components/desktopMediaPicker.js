import { DOM, hideAll } from '../state.js';
import { applyChromeThemeTokens, notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

/**
 * Renders the Desktop & Tab Media Source Picker Modal Dialog
 * Used for chrome.desktopCapture and getDisplayMedia source selection.
 *
 * @param {Object} payload
 * @param {number} payload.requestId
 * @param {string} [payload.requesterName]
 * @param {string} [payload.requesterIcon]
 * @param {boolean} [payload.canRequestAudio]
 * @param {Object} payload.sources
 * @param {Array} payload.sources.screens
 * @param {Array} payload.sources.windows
 * @param {Array} payload.sources.tabs
 * @param {number} [payload.targetTabId]
 * @param {Object} [payload.theme]
 */
export function renderDesktopMediaPicker(payload) {
    hideAll({ hideLens: false });

    if (payload.theme) {
        applyChromeThemeTokens(payload.theme);
    }

    const requestId = payload.requestId;
    const requesterName = payload.requesterName || 'Application';
    const requesterIcon = payload.requesterIcon || null;
    const canRequestAudio = payload.canRequestAudio !== false;
    const targetTabId = payload.targetTabId || null;

    const sources = payload.sources || {};
    const screens = Array.isArray(sources.screens) ? sources.screens : [];
    const windows = Array.isArray(sources.windows) ? sources.windows : [];
    const tabs = Array.isArray(sources.tabs) ? sources.tabs : [];

    // Determine initial active category
    const availableCategories = [];
    if (screens.length > 0) availableCategories.push('screens');
    if (windows.length > 0) availableCategories.push('windows');
    if (tabs.length > 0) availableCategories.push('tabs');

    let activeCategory = availableCategories.includes('screens') ? 'screens' : (availableCategories[0] || 'screens');

    // Currently selected source item
    let selectedItem = null;

    const metrics = getCompactMenuMetrics(payload);
    const modalWidth = Math.min(680, metrics.viewportWidth - 32);
    const modalHeight = Math.min(560, metrics.viewportHeight - 40);

    const left0 = Math.max(16, Math.round((metrics.viewportWidth - modalWidth) / 2));
    const top0 = Math.max(20, Math.round((metrics.viewportHeight - modalHeight) / 2));
    const panelPoint = toCompactMenuPoint(payload, left0, top0);

    // Setup Panel
    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = modalWidth + 'px';
    DOM.panel.style.minWidth = modalWidth + 'px';
    DOM.panel.style.maxWidth = modalWidth + 'px';
    DOM.panel.style.height = modalHeight + 'px';
    DOM.panel.style.minHeight = modalHeight + 'px';
    DOM.panel.style.maxHeight = modalHeight + 'px';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.style.borderRadius = '16px';
    DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.panel.style.color = 'var(--chrome-fg, #202124)';
    DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    DOM.panel.style.boxShadow = '0 24px 48px rgba(0, 0, 0, 0.35), 0 4px 16px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    DOM.panel.classList.remove('co-panel--app-menu');
    DOM.panel.classList.add('co-visible');

    // Setup Backdrop with modal dimming
    DOM.backdrop.classList.add('co-visible');
    DOM.backdrop.classList.add('co-backdrop--modal');

    // 1. Header (Icon + Title & Subtitle + Close Button)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'flex-start';
    header.style.justifyContent = 'space-between';
    header.style.padding = '18px 24px 14px';
    header.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    header.style.flexShrink = '0';

    const headerLeft = document.createElement('div');
    headerLeft.style.display = 'flex';
    headerLeft.style.alignItems = 'center';
    headerLeft.style.gap = '14px';

    const requesterIconEl = document.createElement('div');
    requesterIconEl.style.width = '38px';
    requesterIconEl.style.height = '38px';
    requesterIconEl.style.borderRadius = '10px';
    requesterIconEl.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 85%, var(--chrome-fg, #000000) 15%)';
    requesterIconEl.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    requesterIconEl.style.display = 'flex';
    requesterIconEl.style.alignItems = 'center';
    requesterIconEl.style.justifyContent = 'center';
    requesterIconEl.style.flexShrink = '0';
    requesterIconEl.style.overflow = 'hidden';

    if (requesterIcon) {
        const iconImg = document.createElement('img');
        iconImg.src = requesterIcon;
        iconImg.style.width = '24px';
        iconImg.style.height = '24px';
        iconImg.style.objectFit = 'contain';
        requesterIconEl.appendChild(iconImg);
    } else {
        // Cast / Screen Share SVG icon
        requesterIconEl.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--chrome-accent, #1a73e8);">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
        `;
    }

    const titleBox = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'Choose what to share';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.letterSpacing = '-0.01em';

    const subtitle = document.createElement('div');
    subtitle.innerHTML = `${escapeHtml(requesterName)} wants to share the contents of your screen.`;
    subtitle.style.fontSize = '12px';
    subtitle.style.color = 'color-mix(in srgb, var(--chrome-fg, #202124) 70%, transparent)';
    subtitle.style.marginTop = '2px';

    titleBox.appendChild(title);
    titleBox.appendChild(subtitle);
    headerLeft.appendChild(requesterIconEl);
    headerLeft.appendChild(titleBox);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Cancel and Close';
    closeBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
    `;
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'inherit';
    closeBtn.style.opacity = '0.6';
    closeBtn.style.padding = '6px';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.transition = 'all 0.15s ease';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; closeBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(128,128,128,0.12))'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.6'; closeBtn.style.backgroundColor = 'transparent'; };
    closeBtn.onclick = () => doCancel();

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    DOM.panel.appendChild(header);

    // 2. Segmented Pill Tab Bar (Entire Screen | Window | InviSurf Tab)
    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.alignItems = 'center';
    tabBar.style.gap = '8px';
    tabBar.style.padding = '12px 24px 8px';
    tabBar.style.flexShrink = '0';

    const tabButtons = {};
    const categoriesMeta = [
        { id: 'screens', label: 'Entire Screen', count: screens.length, icon: '🖥️' },
        { id: 'windows', label: 'Window', count: windows.length, icon: '🪟' },
        { id: 'tabs', label: 'InviSurf Tab', count: tabs.length, icon: '📑' },
    ];

    categoriesMeta.forEach((cat) => {
        if (!availableCategories.includes(cat.id)) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '6px';
        btn.style.padding = '7px 14px';
        btn.style.borderRadius = '20px';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '500';
        btn.style.border = '1px solid transparent';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all 0.15s ease';

        const label = document.createElement('span');
        label.textContent = `${cat.label} (${cat.count})`;
        btn.appendChild(label);

        btn.onclick = () => {
            if (activeCategory === cat.id) return;
            activeCategory = cat.id;
            selectedItem = null;
            updateTabButtons();
            renderSourceGrid();
            updateFooterState();
        };

        tabButtons[cat.id] = btn;
        tabBar.appendChild(btn);
    });

    function updateTabButtons() {
        Object.entries(tabButtons).forEach(([id, btn]) => {
            const isActive = id === activeCategory;
            if (isActive) {
                btn.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
                btn.style.color = '#ffffff';
                btn.style.borderColor = 'transparent';
                btn.style.boxShadow = '0 2px 6px color-mix(in srgb, var(--chrome-accent, #1a73e8) 35%, transparent)';
            } else {
                btn.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 92%, var(--chrome-fg, #000) 8%)';
                btn.style.color = 'var(--chrome-fg, #202124)';
                btn.style.borderColor = 'var(--chrome-tab-separator, rgba(0, 0, 0, 0.1))';
                btn.style.boxShadow = 'none';
            }
        });
    }
    updateTabButtons();
    DOM.panel.appendChild(tabBar);

    // 3. Grid Container for Sources
    const gridContainer = document.createElement('div');
    gridContainer.style.flex = '1';
    gridContainer.style.overflowY = 'auto';
    gridContainer.style.padding = '12px 24px';
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(185px, 1fr))';
    gridContainer.style.gridAutoRows = 'max-content';
    gridContainer.style.gap = '14px';
    DOM.panel.appendChild(gridContainer);

    function renderSourceGrid() {
        gridContainer.innerHTML = '';

        let currentList = [];
        if (activeCategory === 'screens') currentList = screens;
        else if (activeCategory === 'windows') currentList = windows;
        else if (activeCategory === 'tabs') currentList = tabs;

        if (currentList.length === 0) {
            const empty = document.createElement('div');
            empty.style.gridColumn = '1 / -1';
            empty.style.display = 'flex';
            empty.style.flexDirection = 'column';
            empty.style.alignItems = 'center';
            empty.style.justifyContent = 'center';
            empty.style.padding = '48px 16px';
            empty.style.opacity = '0.6';
            empty.style.fontSize = '14px';
            empty.textContent = `No available ${activeCategory} to share.`;
            gridContainer.appendChild(empty);
            return;
        }

        currentList.forEach((item) => {
            const card = document.createElement('div');
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.borderRadius = '12px';
            card.style.border = '2px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
            card.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 96%, var(--chrome-fg, #000) 4%)';
            card.style.overflow = 'hidden';
            card.style.cursor = 'pointer';
            card.style.position = 'relative';
            card.style.transition = 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)';
            card.style.userSelect = 'none';

            // Preview Box (16:9)
            const previewBox = document.createElement('div');
            previewBox.style.width = '100%';
            previewBox.style.height = '112px';
            previewBox.style.backgroundColor = '#0b0f19';
            previewBox.style.display = 'flex';
            previewBox.style.alignItems = 'center';
            previewBox.style.justifyContent = 'center';
            previewBox.style.position = 'relative';
            previewBox.style.overflow = 'hidden';

            if (item.thumbnail) {
                const img = document.createElement('img');
                img.src = item.thumbnail;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                previewBox.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.innerHTML = `
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.35; color: #fff;">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                `;
                previewBox.appendChild(placeholder);
            }

            // Selection Checkmark Badge
            const checkBadge = document.createElement('div');
            checkBadge.style.position = 'absolute';
            checkBadge.style.top = '6px';
            checkBadge.style.right = '6px';
            checkBadge.style.width = '22px';
            checkBadge.style.height = '22px';
            checkBadge.style.borderRadius = '50%';
            checkBadge.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
            checkBadge.style.color = '#ffffff';
            checkBadge.style.display = 'none';
            checkBadge.style.alignItems = 'center';
            checkBadge.style.justifyContent = 'center';
            checkBadge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
            checkBadge.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            previewBox.appendChild(checkBadge);

            // Card Footer (App / Favicon + Title)
            const cardFooter = document.createElement('div');
            cardFooter.style.display = 'flex';
            cardFooter.style.alignItems = 'center';
            cardFooter.style.gap = '8px';
            cardFooter.style.padding = '8px 10px';
            cardFooter.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
            cardFooter.style.backgroundColor = 'transparent';

            const iconEl = document.createElement('img');
            iconEl.style.width = '16px';
            iconEl.style.height = '16px';
            iconEl.style.objectFit = 'contain';
            iconEl.style.flexShrink = '0';
            if (item.appIcon) {
                iconEl.src = item.appIcon;
            } else if (item.favicon) {
                iconEl.src = item.favicon;
            } else {
                iconEl.style.display = 'none';
            }
            cardFooter.appendChild(iconEl);

            const titleEl = document.createElement('span');
            titleEl.textContent = item.name || 'Untitled';
            titleEl.title = item.name || '';
            titleEl.style.fontSize = '12px';
            titleEl.style.fontWeight = '500';
            titleEl.style.whiteSpace = 'nowrap';
            titleEl.style.overflow = 'hidden';
            titleEl.style.textOverflow = 'ellipsis';
            titleEl.style.flex = '1';
            cardFooter.appendChild(titleEl);

            card.appendChild(previewBox);
            card.appendChild(cardFooter);

            // Selection update
            const updateCardVisual = () => {
                const isSelected = selectedItem && selectedItem.id === item.id;
                if (isSelected) {
                    card.style.borderColor = 'var(--chrome-accent, #1a73e8)';
                    card.style.backgroundColor = 'color-mix(in srgb, var(--chrome-accent, #1a73e8) 10%, var(--chrome-nav-bg, #ffffff))';
                    card.style.boxShadow = '0 0 0 1px var(--chrome-accent, #1a73e8), 0 4px 14px color-mix(in srgb, var(--chrome-accent, #1a73e8) 25%, transparent)';
                    checkBadge.style.display = 'flex';
                } else {
                    card.style.borderColor = 'var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
                    card.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 96%, var(--chrome-fg, #000) 4%)';
                    card.style.boxShadow = 'none';
                    checkBadge.style.display = 'none';
                }
            };

            card.onmouseenter = () => {
                if (!selectedItem || selectedItem.id !== item.id) {
                    card.style.borderColor = 'color-mix(in srgb, var(--chrome-accent, #1a73e8) 60%, transparent)';
                    card.style.transform = 'translateY(-2px)';
                }
            };
            card.onmouseleave = () => {
                if (!selectedItem || selectedItem.id !== item.id) {
                    card.style.borderColor = 'var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
                    card.style.transform = 'none';
                }
            };

            card.onclick = () => {
                selectedItem = item;
                // Refresh all card visuals in the container
                Array.from(gridContainer.children).forEach((c) => {
                    if (c._updateVisual) c._updateVisual();
                });
                updateFooterState();
            };

            // Double click directly confirms and shares
            card.ondblclick = () => {
                selectedItem = item;
                doConfirm();
            };

            card._updateVisual = updateCardVisual;
            card._item = item;
            updateCardVisual();

            gridContainer.appendChild(card);
        });
    }

    renderSourceGrid();

    // 4. Footer (Audio Toggle + Cancel & Share Buttons)
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'space-between';
    footer.style.padding = '14px 24px';
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    footer.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 97%, var(--chrome-fg, #000000) 3%)';
    footer.style.flexShrink = '0';

    // Audio Checkbox
    const audioBox = document.createElement('label');
    audioBox.style.display = canRequestAudio ? 'flex' : 'none';
    audioBox.style.alignItems = 'center';
    audioBox.style.gap = '8px';
    audioBox.style.fontSize = '13px';
    audioBox.style.cursor = 'pointer';
    audioBox.style.userSelect = 'none';

    const chkAudio = document.createElement('input');
    chkAudio.type = 'checkbox';
    chkAudio.checked = true;
    chkAudio.style.cursor = 'pointer';
    chkAudio.style.accentColor = 'var(--chrome-accent, #1a73e8)';

    const audioLabel = document.createElement('span');
    audioLabel.textContent = 'Also share system audio';
    audioBox.appendChild(chkAudio);
    audioBox.appendChild(audioLabel);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.alignItems = 'center';
    btnGroup.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '8px 18px';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.18))';
    cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.style.color = 'var(--chrome-fg, #202124)';
    cancelBtn.style.fontSize = '13px';
    cancelBtn.style.fontWeight = '500';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.transition = 'all 0.15s ease';
    cancelBtn.onmouseenter = () => cancelBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(128, 128, 128, 0.08))';
    cancelBtn.onmouseleave = () => cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.onclick = () => doCancel();

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.textContent = 'Share';
    shareBtn.disabled = true;
    shareBtn.style.padding = '8px 22px';
    shareBtn.style.borderRadius = '8px';
    shareBtn.style.border = 'none';
    shareBtn.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
    shareBtn.style.color = '#ffffff';
    shareBtn.style.fontSize = '13px';
    shareBtn.style.fontWeight = '600';
    shareBtn.style.cursor = 'not-allowed';
    shareBtn.style.opacity = '0.5';
    shareBtn.style.boxShadow = '0 2px 8px color-mix(in srgb, var(--chrome-accent, #1a73e8) 35%, transparent)';
    shareBtn.style.transition = 'all 0.15s ease';
    shareBtn.onmouseenter = () => { if (!shareBtn.disabled) shareBtn.style.filter = 'brightness(1.08)'; };
    shareBtn.onmouseleave = () => { shareBtn.style.filter = 'none'; };
    shareBtn.onclick = () => doConfirm();

    function updateFooterState() {
        if (selectedItem) {
            shareBtn.disabled = false;
            shareBtn.style.opacity = '1';
            shareBtn.style.cursor = 'pointer';
        } else {
            shareBtn.disabled = true;
            shareBtn.style.opacity = '0.5';
            shareBtn.style.cursor = 'not-allowed';
        }

        if (activeCategory === 'tabs') {
            audioLabel.textContent = 'Share tab audio';
        } else {
            audioLabel.textContent = 'Also share system audio';
        }
    }

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(shareBtn);
    footer.appendChild(audioBox);
    footer.appendChild(btnGroup);
    DOM.panel.appendChild(footer);

    function doCancel() {
        DOM.backdrop.classList.remove('co-backdrop--modal');
        hideAll({ hideLens: false });
        notifyHost({
            type: 'desktopMediaPickerResponse',
            requestId,
            cancelled: true,
        });
    }

    function doConfirm() {
        if (!selectedItem) return;
        DOM.backdrop.classList.remove('co-backdrop--modal');
        hideAll({ hideLens: false });
        notifyHost({
            type: 'desktopMediaPickerResponse',
            requestId,
            cancelled: false,
            sourceId: selectedItem.id,
            sourceKind: activeCategory === 'tabs' ? 'tab' : (activeCategory === 'windows' ? 'window' : 'screen'),
            tabId: selectedItem.tabId || null,
            shareAudio: canRequestAudio ? chkAudio.checked : false,
        });
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
