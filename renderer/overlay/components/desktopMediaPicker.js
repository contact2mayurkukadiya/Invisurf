import { DOM, hideAll } from '../state.js';
import { applyChromeThemeTokens, notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

let activePickerInstance = null;

export function updateDesktopMediaPickerSnapshot(patch) {
    if (!patch || !patch.tabId || !patch.thumbnail) return;
    if (activePickerInstance && (!patch.requestId || patch.requestId === activePickerInstance.requestId)) {
        activePickerInstance.updateSnapshot(patch.tabId, patch.thumbnail);
    }
}

/**
 * Renders the Desktop & Tab Media Source Picker Modal Dialog
 * Used for chrome.desktopCapture and getDisplayMedia source selection.
 * Styled to match Chrome's native source picker and user's chosen theme.
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
    const requesterName = payload.requesterName || 'This site';
    const canRequestAudio = payload.canRequestAudio !== false;
    const supportsSystemAudio = payload.supportsSystemAudio !== false;
    const targetTabId = payload.targetTabId || null;

    const sources = payload.sources || {};
    const screens = Array.isArray(sources.screens) ? sources.screens : [];
    const windows = Array.isArray(sources.windows) ? sources.windows : [];
    const tabs = Array.isArray(sources.tabs) ? sources.tabs : [];

    // Category availability - default to 'tabs' if available, otherwise 'windows' or 'screens'
    const availableCategories = [];
    if (tabs.length > 0) availableCategories.push('tabs');
    if (windows.length > 0) availableCategories.push('windows');
    if (screens.length > 0) availableCategories.push('screens');

    // Default to 'tabs' first if present, otherwise first available
    let activeCategory = availableCategories.includes('tabs') ? 'tabs' : (availableCategories[0] || 'screens');

    // Initially selected item: preferred tab or first item
    let selectedItem = null;
    if (activeCategory === 'tabs' && tabs.length > 0) {
        selectedItem = (targetTabId ? tabs.find(t => t.tabId === targetTabId) : null) || tabs[0];
    } else if (activeCategory === 'windows' && windows.length > 0) {
        selectedItem = windows[0];
    } else if (screens.length > 0) {
        selectedItem = screens[0];
    }

    let shareAudio = true;

    const metrics = getCompactMenuMetrics(payload);
    const modalWidth = Math.min(680, metrics.viewportWidth - 32);
    const modalHeight = Math.min(560, metrics.viewportHeight - 40);

    const left0 = Math.max(16, Math.round((metrics.viewportWidth - modalWidth) / 2));
    const top0 = Math.max(20, Math.round((metrics.viewportHeight - modalHeight) / 2));
    const panelPoint = toCompactMenuPoint(payload, left0, top0);

    // Setup Panel Container
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
    DOM.panel.style.borderRadius = '20px';
    DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.panel.style.color = 'var(--chrome-fg, #202124)';
    DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    DOM.panel.style.boxShadow = '0 24px 60px rgba(0, 0, 0, 0.32), 0 4px 16px rgba(0, 0, 0, 0.14)';
    DOM.panel.classList.remove('co-panel--app-menu');
    DOM.panel.classList.add('co-visible');

    // Setup Backdrop with modal dimming
    DOM.backdrop.classList.add('co-visible');
    DOM.backdrop.classList.add('co-backdrop--modal');

    // 1. Header (Title & Subtitle without heavy icons)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.padding = '24px 28px 12px';
    header.style.flexShrink = '0';

    const title = document.createElement('div');
    title.textContent = `Choose what to share with ${requesterName}`;
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';
    title.style.letterSpacing = '-0.015em';
    title.style.color = 'var(--chrome-fg, #202124)';

    const subtitle = document.createElement('div');
    subtitle.textContent = 'The site will be able to see the contents of your screen';
    subtitle.style.fontSize = '13px';
    subtitle.style.color = 'var(--chrome-secondary-fg, rgba(0, 0, 0, 0.65))';
    subtitle.style.marginTop = '4px';

    header.appendChild(title);
    header.appendChild(subtitle);
    DOM.panel.appendChild(header);

    // 2. Horizontal Underline Tab Bar (Chrome Tab | Window | Entire Screen)
    const tabBarContainer = document.createElement('div');
    tabBarContainer.style.padding = '0 28px';
    tabBarContainer.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    tabBarContainer.style.flexShrink = '0';

    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.alignItems = 'center';
    tabBar.style.gap = '32px';

    const categoriesMeta = [
        { id: 'tabs', label: 'Chrome Tab' },
        { id: 'windows', label: 'Window' },
        { id: 'screens', label: 'Entire Screen' },
    ];

    const tabElements = {};

    categoriesMeta.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.display = 'flex';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'center';
        btn.style.padding = '8px 0 0';
        btn.style.background = 'transparent';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.position = 'relative';

        const labelText = document.createElement('span');
        labelText.textContent = cat.label;
        labelText.style.fontSize = '14px';
        labelText.style.fontWeight = '500';
        labelText.style.paddingBottom = '10px';
        labelText.style.transition = 'color 0.15s ease';

        const indicator = document.createElement('div');
        indicator.style.width = '100%';
        indicator.style.height = '3px';
        indicator.style.borderTopLeftRadius = '3px';
        indicator.style.borderTopRightRadius = '3px';
        indicator.style.backgroundColor = 'transparent';
        indicator.style.transition = 'background-color 0.15s ease';

        btn.appendChild(labelText);
        btn.appendChild(indicator);

        btn.onclick = () => {
            if (activeCategory === cat.id) return;
            activeCategory = cat.id;

            // Pick default item for newly active category
            if (activeCategory === 'tabs') selectedItem = tabs[0] || null;
            else if (activeCategory === 'windows') selectedItem = windows[0] || null;
            else selectedItem = screens[0] || null;

            updateTabStyles();
            renderContentArea();
            updateFooterState();
        };

        tabElements[cat.id] = { btn, labelText, indicator };
        tabBar.appendChild(btn);
    });

    function updateTabStyles() {
        categoriesMeta.forEach((cat) => {
            const el = tabElements[cat.id];
            if (!el) return;
            const isActive = cat.id === activeCategory;
            if (isActive) {
                el.labelText.style.color = 'var(--chrome-fg, #202124)';
                el.labelText.style.fontWeight = '600';
                el.indicator.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
            } else {
                el.labelText.style.color = 'var(--chrome-secondary-fg, rgba(0, 0, 0, 0.65))';
                el.labelText.style.fontWeight = '500';
                el.indicator.style.backgroundColor = 'transparent';
            }
        });
    }
    updateTabStyles();
    tabBarContainer.appendChild(tabBar);
    DOM.panel.appendChild(tabBarContainer);

    // 3. Main Content Container
    const contentArea = document.createElement('div');
    contentArea.style.flex = '1';
    contentArea.style.overflow = 'hidden';
    contentArea.style.padding = '14px 28px 8px';
    contentArea.style.display = 'flex';
    DOM.panel.appendChild(contentArea);

    function renderContentArea() {
        contentArea.innerHTML = '';

        if (activeCategory === 'tabs') {
            renderTabsSplitView();
        } else if (activeCategory === 'windows') {
            renderGrid(windows, 'window');
        } else {
            renderGrid(screens, 'screen');
        }
    }

    // 3A. Split View for Tabs (Left List + Right Large Preview)
    function renderTabsSplitView() {
        const splitContainer = document.createElement('div');
        splitContainer.style.display = 'flex';
        splitContainer.style.width = '100%';
        splitContainer.style.height = '100%';
        splitContainer.style.gap = '20px';

        function requestHighQualitySnapshot(item) {
            if (!item) return;
            const tabId = item.tabId || item.stringTabId || item.id;
            if (!tabId) return;
            notifyHost({
                type: 'desktopMediaPickerRequestTabSnapshot',
                requestId,
                tabId,
            });
        }

        activePickerInstance = {
            requestId,
            updateSnapshot: (tabId, thumbnail) => {
                const cleanId = String(tabId).replace(/^tab:/, '');
                const matchedTab = tabs.find(t => String(t.id).replace(/^tab:/, '') === cleanId || String(t.tabId) === cleanId || String(t.stringTabId) === cleanId);
                if (matchedTab) {
                    matchedTab.thumbnail = thumbnail;
                }
                if (selectedItem && (String(selectedItem.id).replace(/^tab:/, '') === cleanId || String(selectedItem.tabId) === cleanId || String(selectedItem.stringTabId) === cleanId)) {
                    selectedItem.thumbnail = thumbnail;
                    if (activeCategory === 'tabs') {
                        updatePreview();
                    }
                }
            }
        };

        // Left: Scrollable List of Tabs
        const listCol = document.createElement('div');
        listCol.className = 'desktop-media-picker-list';
        listCol.style.flex = '1';
        listCol.style.maxWidth = '48%';
        listCol.style.overflowY = 'auto';
        listCol.style.display = 'flex';
        listCol.style.flexDirection = 'column';
        listCol.style.gap = '4px';
        listCol.style.paddingRight = '6px';
        listCol.style.scrollbarWidth = 'thin';
        listCol.style.scrollbarColor = 'var(--chrome-tab-separator, rgba(0, 0, 0, 0.15)) transparent';

        // Right: Large Preview Box
        const previewCol = document.createElement('div');
        previewCol.className = 'desktop-media-picker-preview-col';
        previewCol.style.flex = '1';
        previewCol.style.maxWidth = '52%';
        previewCol.style.display = 'flex';
        previewCol.style.flexDirection = 'column';
        previewCol.style.alignItems = 'center';
        previewCol.style.justifyContent = 'flex-start';
        previewCol.style.padding = '4px 8px 12px';

        const previewFrame = document.createElement('div');
        previewFrame.className = 'desktop-media-picker-preview-frame';
        previewFrame.style.width = '100%';
        previewFrame.style.maxHeight = '230px';
        previewFrame.style.aspectRatio = '16 / 9';
        previewFrame.style.borderRadius = '12px';
        previewFrame.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
        previewFrame.style.backgroundColor = '#0b0f19';
        previewFrame.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.08)';
        previewFrame.style.overflow = 'hidden';
        previewFrame.style.display = 'flex';
        previewFrame.style.alignItems = 'center';
        previewFrame.style.justifyContent = 'center';
        previewFrame.style.position = 'relative';

        const previewImg = document.createElement('img');
        previewImg.className = 'desktop-media-picker-preview-img';
        previewImg.style.width = '100%';
        previewImg.style.height = '100%';
        previewImg.style.objectFit = 'contain';
        previewImg.style.borderRadius = '11px';
        previewImg.style.display = 'block';
        previewFrame.appendChild(previewImg);

        previewImg.onload = () => {
            if (previewImg.naturalWidth && previewImg.naturalHeight) {
                const ratio = previewImg.naturalWidth / previewImg.naturalHeight;
                if (ratio >= 0.5 && ratio <= 2.8) {
                    previewFrame.style.aspectRatio = `${previewImg.naturalWidth} / ${previewImg.naturalHeight}`;
                }
            }
        };

        // Fallback webpage mock placeholder if thumbnail is unavailable or still rendering
        const fallbackPlaceholder = document.createElement('div');
        fallbackPlaceholder.style.width = '100%';
        fallbackPlaceholder.style.height = '100%';
        fallbackPlaceholder.style.display = 'none';
        fallbackPlaceholder.style.flexDirection = 'column';
        fallbackPlaceholder.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 96%, var(--chrome-fg, #000) 4%)';
        fallbackPlaceholder.style.position = 'relative';
        fallbackPlaceholder.style.overflow = 'hidden';

        const mockBrowserBar = document.createElement('div');
        mockBrowserBar.style.display = 'flex';
        mockBrowserBar.style.alignItems = 'center';
        mockBrowserBar.style.gap = '8px';
        mockBrowserBar.style.padding = '8px 12px';
        mockBrowserBar.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
        mockBrowserBar.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 90%, var(--chrome-fg, #000) 10%)';

        const mockAddressPill = document.createElement('div');
        mockAddressPill.style.display = 'flex';
        mockAddressPill.style.alignItems = 'center';
        mockAddressPill.style.gap = '6px';
        mockAddressPill.style.padding = '3px 10px';
        mockAddressPill.style.borderRadius = '12px';
        mockAddressPill.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
        mockAddressPill.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.1))';
        mockAddressPill.style.maxWidth = '85%';
        mockAddressPill.style.overflow = 'hidden';

        const mockLockIcon = document.createElement('span');
        mockLockIcon.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
        mockLockIcon.style.display = 'inline-flex';
        mockLockIcon.style.opacity = '0.6';

        const mockHostSpan = document.createElement('span');
        mockHostSpan.style.fontSize = '11px';
        mockHostSpan.style.color = 'var(--chrome-fg, #202124)';
        mockHostSpan.style.opacity = '0.75';
        mockHostSpan.style.whiteSpace = 'nowrap';
        mockHostSpan.style.overflow = 'hidden';
        mockHostSpan.style.textOverflow = 'ellipsis';

        mockAddressPill.appendChild(mockLockIcon);
        mockAddressPill.appendChild(mockHostSpan);
        mockBrowserBar.appendChild(mockAddressPill);
        fallbackPlaceholder.appendChild(mockBrowserBar);

        const mockBody = document.createElement('div');
        mockBody.style.flex = '1';
        mockBody.style.display = 'flex';
        mockBody.style.flexDirection = 'column';
        mockBody.style.alignItems = 'center';
        mockBody.style.justifyContent = 'center';
        mockBody.style.padding = '16px';
        mockBody.style.gap = '10px';

        const mockIcon = document.createElement('img');
        mockIcon.style.width = '36px';
        mockIcon.style.height = '36px';
        mockIcon.style.borderRadius = '8px';
        mockIcon.style.objectFit = 'contain';

        const mockGlobeIcon = document.createElement('div');
        mockGlobeIcon.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:0.45"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        mockGlobeIcon.style.display = 'none';

        mockIcon.onerror = () => {
            mockIcon.style.display = 'none';
            mockGlobeIcon.style.display = 'block';
        };

        const mockTitle = document.createElement('div');
        mockTitle.style.fontSize = '12px';
        mockTitle.style.fontWeight = '600';
        mockTitle.style.color = 'var(--chrome-fg, #202124)';
        mockTitle.style.textAlign = 'center';
        mockTitle.style.maxWidth = '90%';
        mockTitle.style.whiteSpace = 'nowrap';
        mockTitle.style.overflow = 'hidden';
        mockTitle.style.textOverflow = 'ellipsis';

        const mockSkeleton = document.createElement('div');
        mockSkeleton.style.width = '70%';
        mockSkeleton.style.display = 'flex';
        mockSkeleton.style.flexDirection = 'column';
        mockSkeleton.style.gap = '6px';
        mockSkeleton.style.marginTop = '4px';
        mockSkeleton.style.opacity = '0.25';

        const skLine1 = document.createElement('div');
        skLine1.style.height = '6px';
        skLine1.style.borderRadius = '3px';
        skLine1.style.backgroundColor = 'var(--chrome-fg, #202124)';
        skLine1.style.width = '100%';

        const skLine2 = document.createElement('div');
        skLine2.style.height = '6px';
        skLine2.style.borderRadius = '3px';
        skLine2.style.backgroundColor = 'var(--chrome-fg, #202124)';
        skLine2.style.width = '75%';

        mockSkeleton.appendChild(skLine1);
        mockSkeleton.appendChild(skLine2);

        mockBody.appendChild(mockIcon);
        mockBody.appendChild(mockGlobeIcon);
        mockBody.appendChild(mockTitle);
        mockBody.appendChild(mockSkeleton);
        fallbackPlaceholder.appendChild(mockBody);

        previewFrame.appendChild(fallbackPlaceholder);

        previewImg.onerror = () => {
            previewImg.style.display = 'none';
            fallbackPlaceholder.style.display = 'flex';
        };

        const previewTitle = document.createElement('div');
        previewTitle.style.marginTop = '10px';
        previewTitle.style.fontSize = '13px';
        previewTitle.style.fontWeight = '500';
        previewTitle.style.color = 'var(--chrome-fg, #202124)';
        previewTitle.style.textAlign = 'center';
        previewTitle.style.maxWidth = '100%';
        previewTitle.style.whiteSpace = 'nowrap';
        previewTitle.style.overflow = 'hidden';
        previewTitle.style.textOverflow = 'ellipsis';
        previewTitle.style.padding = '0 4px';

        previewCol.appendChild(previewFrame);
        previewCol.appendChild(previewTitle);

        function updatePreview() {
            if (!selectedItem) {
                previewImg.style.display = 'none';
                fallbackPlaceholder.style.display = 'none';
                previewTitle.textContent = '';
                previewFrame.style.aspectRatio = '16 / 9';
                return;
            }
            previewTitle.textContent = selectedItem.name || 'Untitled Tab';
            if (selectedItem.thumbnail) {
                previewImg.src = selectedItem.thumbnail;
                previewImg.style.display = 'block';
                fallbackPlaceholder.style.display = 'none';
                if (previewImg.complete && previewImg.naturalWidth && previewImg.naturalHeight) {
                    const ratio = previewImg.naturalWidth / previewImg.naturalHeight;
                    if (ratio >= 0.5 && ratio <= 2.8) {
                        previewFrame.style.aspectRatio = `${previewImg.naturalWidth} / ${previewImg.naturalHeight}`;
                    }
                }
            } else {
                previewImg.style.display = 'none';
                fallbackPlaceholder.style.display = 'flex';
                previewFrame.style.aspectRatio = '16 / 9';

                let host = '';
                try {
                    const u = selectedItem.url || '';
                    if (u) host = new URL(u).host || u;
                } catch (_) {
                    host = (selectedItem.url || '').replace(/^https?:\/\//, '').split('/')[0];
                }
                mockHostSpan.textContent = host || selectedItem.name || 'Web Tab';
                mockTitle.textContent = selectedItem.name || host || 'Tab Preview';

                if (selectedItem.favicon) {
                    mockIcon.src = selectedItem.favicon;
                    mockIcon.style.display = 'block';
                    mockGlobeIcon.style.display = 'none';
                } else {
                    mockIcon.style.display = 'none';
                    mockGlobeIcon.style.display = 'block';
                }
            }
        }

        if (tabs.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.textContent = 'No open tabs available to share.';
            emptyEl.style.padding = '32px 12px';
            emptyEl.style.opacity = '0.6';
            emptyEl.style.fontSize = '13px';
            listCol.appendChild(emptyEl);
        } else {
            tabs.forEach((tab) => {
                const itemRow = document.createElement('div');
                itemRow.className = 'desktop-media-picker-tab-row';
                itemRow.style.display = 'flex';
                itemRow.style.alignItems = 'center';
                itemRow.style.gap = '12px';
                itemRow.style.padding = '10px 14px';
                itemRow.style.borderRadius = '10px';
                itemRow.style.cursor = 'pointer';
                itemRow.style.transition = 'background-color 0.15s ease';
                itemRow.style.userSelect = 'none';
                itemRow.style.minHeight = '40px';
                itemRow.style.boxSizing = 'border-box';

                const favEl = document.createElement('img');
                favEl.style.width = '18px';
                favEl.style.height = '18px';
                favEl.style.objectFit = 'contain';
                favEl.style.flexShrink = '0';
                favEl.style.borderRadius = '3px';
                if (tab.favicon) {
                    favEl.src = tab.favicon;
                } else {
                    favEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="%23777" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
                }
                itemRow.appendChild(favEl);

                const nameEl = document.createElement('span');
                nameEl.textContent = tab.name || 'Untitled Tab';
                nameEl.title = tab.name || '';
                nameEl.style.fontSize = '13px';
                nameEl.style.fontWeight = '400';
                nameEl.style.lineHeight = '1.35';
                nameEl.style.whiteSpace = 'nowrap';
                nameEl.style.overflow = 'hidden';
                nameEl.style.textOverflow = 'ellipsis';
                nameEl.style.flex = '1';
                nameEl.style.color = 'var(--chrome-fg, #202124)';
                itemRow.appendChild(nameEl);

                const updateRowStyle = () => {
                    const isSelected = selectedItem && selectedItem.id === tab.id;
                    if (isSelected) {
                        itemRow.style.backgroundColor = 'color-mix(in srgb, var(--chrome-accent, #1a73e8) 18%, var(--chrome-nav-bg, #ffffff))';
                        nameEl.style.fontWeight = '500';
                    } else {
                        itemRow.style.backgroundColor = 'transparent';
                        nameEl.style.fontWeight = '400';
                    }
                };

                itemRow.onmouseenter = () => {
                    if (!selectedItem || selectedItem.id !== tab.id) {
                        itemRow.style.backgroundColor = 'color-mix(in srgb, var(--chrome-fg, #000) 5%, transparent)';
                    }
                };
                itemRow.onmouseleave = () => {
                    updateRowStyle();
                };

                itemRow.onclick = () => {
                    selectedItem = tab;
                    Array.from(listCol.children).forEach((c) => {
                        if (c._updateStyle) c._updateStyle();
                    });
                    updatePreview();
                    updateFooterState();
                    requestHighQualitySnapshot(tab);
                };

                itemRow.ondblclick = () => {
                    selectedItem = tab;
                    doConfirm();
                };

                itemRow._updateStyle = updateRowStyle;
                updateRowStyle();
                listCol.appendChild(itemRow);
            });
        }

        updatePreview();
        if (selectedItem) {
            requestHighQualitySnapshot(selectedItem);
        }
        splitContainer.appendChild(listCol);
        splitContainer.appendChild(previewCol);
        contentArea.appendChild(splitContainer);
    }

    // 3B. Grid View for Windows and Screens
    function createGridCardFallback(item, kind) {
        const fallback = document.createElement('div');
        fallback.className = 'desktop-media-picker-grid-fallback';
        fallback.style.width = '100%';
        fallback.style.height = '100%';
        fallback.style.display = 'flex';
        fallback.style.flexDirection = 'column';
        fallback.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 94%, var(--chrome-fg, #000) 6%)';
        fallback.style.position = 'relative';
        fallback.style.overflow = 'hidden';

        // Mock top header (window or screen titlebar)
        const mockBar = document.createElement('div');
        mockBar.style.display = 'flex';
        mockBar.style.alignItems = 'center';
        mockBar.style.gap = '6px';
        mockBar.style.padding = '3px 8px';
        mockBar.style.height = '20px';
        mockBar.style.boxSizing = 'border-box';
        mockBar.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
        mockBar.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 88%, var(--chrome-fg, #000) 12%)';
        mockBar.style.flexShrink = '0';

        if (kind === 'screen') {
            const monitorIcon = document.createElement('span');
            monitorIcon.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="opacity:0.65;display:inline-flex"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
            mockBar.appendChild(monitorIcon);
        } else {
            const dotsWrap = document.createElement('div');
            dotsWrap.style.display = 'flex';
            dotsWrap.style.alignItems = 'center';
            dotsWrap.style.gap = '3px';
            dotsWrap.style.flexShrink = '0';
            ['#ff5f56', '#ffbd2e', '#27c93f'].forEach((color) => {
                const dot = document.createElement('span');
                dot.style.width = '5px';
                dot.style.height = '5px';
                dot.style.borderRadius = '50%';
                dot.style.backgroundColor = color;
                dot.style.display = 'inline-block';
                dot.style.opacity = '0.75';
                dotsWrap.appendChild(dot);
            });
            mockBar.appendChild(dotsWrap);
        }

        const mockAddressPill = document.createElement('div');
        mockAddressPill.style.display = 'flex';
        mockAddressPill.style.alignItems = 'center';
        mockAddressPill.style.gap = '4px';
        mockAddressPill.style.padding = '1px 6px';
        mockAddressPill.style.borderRadius = '8px';
        mockAddressPill.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
        mockAddressPill.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.1))';
        mockAddressPill.style.maxWidth = '75%';
        mockAddressPill.style.height = '13px';
        mockAddressPill.style.boxSizing = 'border-box';
        mockAddressPill.style.overflow = 'hidden';

        const mockPillText = document.createElement('span');
        mockPillText.textContent = item.name || (kind === 'screen' ? 'Entire Screen' : 'Window');
        mockPillText.style.fontSize = '9px';
        mockPillText.style.fontWeight = '500';
        mockPillText.style.color = 'var(--chrome-fg, #202124)';
        mockPillText.style.opacity = '0.75';
        mockPillText.style.whiteSpace = 'nowrap';
        mockPillText.style.overflow = 'hidden';
        mockPillText.style.textOverflow = 'ellipsis';
        mockAddressPill.appendChild(mockPillText);
        mockBar.appendChild(mockAddressPill);

        fallback.appendChild(mockBar);

        // Mock Body with centered icon and skeleton bars
        const mockBody = document.createElement('div');
        mockBody.style.flex = '1';
        mockBody.style.display = 'flex';
        mockBody.style.flexDirection = 'column';
        mockBody.style.alignItems = 'center';
        mockBody.style.justifyContent = 'center';
        mockBody.style.padding = '8px';
        mockBody.style.gap = '6px';
        mockBody.style.boxSizing = 'border-box';

        const iconContainer = document.createElement('div');
        iconContainer.style.display = 'flex';
        iconContainer.style.alignItems = 'center';
        iconContainer.style.justifyContent = 'center';
        iconContainer.style.width = '28px';
        iconContainer.style.height = '28px';
        iconContainer.style.flexShrink = '0';

        const fallbackSvg = kind === 'screen'
            ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:0.55;color:var(--chrome-fg, #202124)"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
            : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:0.55;color:var(--chrome-fg, #202124)"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="2" y1="9" x2="22" y2="9"></line><line x1="6" y1="6.5" x2="6.01" y2="6.5" stroke-width="2.5"></line><line x1="9" y1="6.5" x2="9.01" y2="6.5" stroke-width="2.5"></line></svg>`;

        if (item.appIcon) {
            const appImg = document.createElement('img');
            appImg.src = item.appIcon;
            appImg.style.width = '26px';
            appImg.style.height = '26px';
            appImg.style.borderRadius = '4px';
            appImg.style.objectFit = 'contain';
            appImg.onerror = () => {
                appImg.style.display = 'none';
                iconContainer.innerHTML = fallbackSvg;
            };
            iconContainer.appendChild(appImg);
        } else {
            iconContainer.innerHTML = fallbackSvg;
        }
        mockBody.appendChild(iconContainer);

        const mockSkeleton = document.createElement('div');
        mockSkeleton.style.width = '60%';
        mockSkeleton.style.display = 'flex';
        mockSkeleton.style.flexDirection = 'column';
        mockSkeleton.style.gap = '4px';
        mockSkeleton.style.alignItems = 'center';
        mockSkeleton.style.opacity = '0.25';

        const skLine1 = document.createElement('div');
        skLine1.style.height = '4px';
        skLine1.style.borderRadius = '2px';
        skLine1.style.backgroundColor = 'var(--chrome-fg, #202124)';
        skLine1.style.width = '100%';

        const skLine2 = document.createElement('div');
        skLine2.style.height = '4px';
        skLine2.style.borderRadius = '2px';
        skLine2.style.backgroundColor = 'var(--chrome-fg, #202124)';
        skLine2.style.width = '65%';

        mockSkeleton.appendChild(skLine1);
        mockSkeleton.appendChild(skLine2);
        mockBody.appendChild(mockSkeleton);

        fallback.appendChild(mockBody);
        return fallback;
    }

    function renderGrid(items, kind) {
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(185px, 1fr))';
        grid.style.gridAutoRows = 'max-content';
        grid.style.gap = '16px';
        grid.style.width = '100%';
        grid.style.height = '100%';
        grid.style.overflowY = 'auto';
        grid.style.padding = '4px';

        if (items.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.textContent = `No available ${kind}s found to share.`;
            emptyEl.style.padding = '40px 12px';
            emptyEl.style.opacity = '0.6';
            emptyEl.style.fontSize = '13px';
            emptyEl.style.gridColumn = '1 / -1';
            emptyEl.style.textAlign = 'center';
            grid.appendChild(emptyEl);
            contentArea.appendChild(grid);
            return;
        }

        items.forEach((item) => {
            const card = document.createElement('div');
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.borderRadius = '10px';
            card.style.overflow = 'hidden';
            card.style.cursor = 'pointer';
            card.style.userSelect = 'none';
            card.style.transition = 'all 0.15s ease';

            // Preview
            const imgBox = document.createElement('div');
            imgBox.style.width = '100%';
            imgBox.style.height = '112px';
            imgBox.style.borderRadius = '8px';
            imgBox.style.border = '2px solid transparent';
            imgBox.style.backgroundColor = '#0b0f19';
            imgBox.style.overflow = 'hidden';
            imgBox.style.display = 'flex';
            imgBox.style.alignItems = 'center';
            imgBox.style.justifyContent = 'center';
            imgBox.style.position = 'relative';

            const fallback = createGridCardFallback(item, kind);
            imgBox.appendChild(fallback);

            if (item.thumbnail) {
                const img = document.createElement('img');
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                img.style.position = 'absolute';
                img.style.inset = '0';
                img.style.display = 'none';

                img.onload = () => {
                    img.style.display = 'block';
                    fallback.style.display = 'none';
                    imgBox.style.backgroundColor = '#0b0f19';
                };
                img.onerror = () => {
                    img.style.display = 'none';
                    fallback.style.display = 'flex';
                    imgBox.style.backgroundColor = 'transparent';
                };

                img.src = item.thumbnail;
                imgBox.appendChild(img);

                if (img.complete && img.naturalWidth > 0) {
                    img.style.display = 'block';
                    fallback.style.display = 'none';
                    imgBox.style.backgroundColor = '#0b0f19';
                }
            } else {
                fallback.style.display = 'flex';
                imgBox.style.backgroundColor = 'transparent';
            }

            // Info below thumbnail
            const infoRow = document.createElement('div');
            infoRow.style.display = 'flex';
            infoRow.style.alignItems = 'center';
            infoRow.style.gap = '8px';
            infoRow.style.padding = '6px 2px';

            if (item.appIcon) {
                const icon = document.createElement('img');
                icon.src = item.appIcon;
                icon.style.width = '16px';
                icon.style.height = '16px';
                icon.style.objectFit = 'contain';
                icon.onerror = () => {
                    icon.style.display = 'none';
                };
                infoRow.appendChild(icon);
            }

            const titleSpan = document.createElement('span');
            titleSpan.textContent = item.name || (kind === 'screen' ? 'Entire screen' : 'Window');
            titleSpan.style.fontSize = '12px';
            titleSpan.style.fontWeight = '500';
            titleSpan.style.color = 'var(--chrome-fg, #202124)';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            infoRow.appendChild(titleSpan);

            card.appendChild(imgBox);
            card.appendChild(infoRow);

            const updateCardVisual = () => {
                const isSelected = selectedItem && selectedItem.id === item.id;
                if (isSelected) {
                    imgBox.style.borderColor = 'var(--chrome-accent, #1a73e8)';
                    card.style.backgroundColor = 'color-mix(in srgb, var(--chrome-accent, #1a73e8) 12%, transparent)';
                } else {
                    imgBox.style.borderColor = 'var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
                    card.style.backgroundColor = 'transparent';
                }
            };

            card.onclick = () => {
                selectedItem = item;
                Array.from(grid.children).forEach((c) => {
                    if (c._updateVisual) c._updateVisual();
                });
                updateFooterState();
            };

            card.ondblclick = () => {
                selectedItem = item;
                doConfirm();
            };

            card._updateVisual = updateCardVisual;
            updateCardVisual();
            grid.appendChild(card);
        });

        contentArea.appendChild(grid);
    }

    renderContentArea();

    // 4. Footer Section (Audio Pill Container + Action Pill Buttons)
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.flexDirection = 'column';
    footer.style.gap = '14px';
    footer.style.padding = '10px 28px 24px';
    footer.style.flexShrink = '0';

    // 4A. Rounded Audio Pill Container with Toggle Switch
    const audioCard = document.createElement('div');
    audioCard.style.display = canRequestAudio ? 'flex' : 'none';
    audioCard.style.alignItems = 'center';
    audioCard.style.justifyContent = 'space-between';
    audioCard.style.padding = '10px 18px';
    audioCard.style.borderRadius = '12px';
    audioCard.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    audioCard.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 96%, var(--chrome-fg, #000) 4%)';
    audioCard.style.userSelect = 'none';

    const audioLeft = document.createElement('div');
    audioLeft.style.display = 'flex';
    audioLeft.style.alignItems = 'center';
    audioLeft.style.gap = '12px';

    // Speaker SVG Icon
    audioLeft.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--chrome-fg, #202124);">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
    `;

    const audioLabel = document.createElement('span');
    audioLabel.textContent = activeCategory === 'tabs' ? 'Share with tab audio' : 'Share with system audio';
    audioLabel.style.fontSize = '13px';
    audioLabel.style.fontWeight = '500';
    audioLabel.style.color = 'var(--chrome-fg, #202124)';
    audioLeft.appendChild(audioLabel);

    // Switch Track & Thumb
    const switchTrack = document.createElement('div');
    switchTrack.style.width = '42px';
    switchTrack.style.height = '24px';
    switchTrack.style.borderRadius = '12px';
    switchTrack.style.backgroundColor = shareAudio ? 'var(--chrome-accent, #1a73e8)' : '#747775';
    switchTrack.style.position = 'relative';
    switchTrack.style.cursor = 'pointer';
    switchTrack.style.transition = 'background-color 0.2s ease';

    const switchThumb = document.createElement('div');
    switchThumb.style.width = '18px';
    switchThumb.style.height = '18px';
    switchThumb.style.borderRadius = '50%';
    switchThumb.style.backgroundColor = '#ffffff';
    switchThumb.style.position = 'absolute';
    switchThumb.style.top = '3px';
    switchThumb.style.left = shareAudio ? '21px' : '3px';
    switchThumb.style.transition = 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    switchThumb.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';

    switchTrack.appendChild(switchThumb);

    const toggleAudio = () => {
        if (activeCategory !== 'tabs' && !supportsSystemAudio) return;
        shareAudio = !shareAudio;
        switchTrack.style.backgroundColor = shareAudio ? 'var(--chrome-accent, #1a73e8)' : '#747775';
        switchThumb.style.left = shareAudio ? '21px' : '3px';
        updateFooterState();
    };

    switchTrack.onclick = toggleAudio;
    audioCard.appendChild(audioLeft);
    audioCard.appendChild(switchTrack);
    footer.appendChild(audioCard);

    // 4B. Action Buttons Row (Right Aligned Pill Buttons)
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.alignItems = 'center';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '9px 24px';
    cancelBtn.style.borderRadius = '20px';
    cancelBtn.style.border = 'none';
    cancelBtn.style.backgroundColor = 'color-mix(in srgb, var(--chrome-accent, #1a73e8) 14%, var(--chrome-nav-bg, #ffffff))';
    cancelBtn.style.color = 'var(--chrome-fg, #202124)';
    cancelBtn.style.fontSize = '13px';
    cancelBtn.style.fontWeight = '600';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.transition = 'all 0.15s ease';
    cancelBtn.onmouseenter = () => { cancelBtn.style.filter = 'brightness(0.96)'; };
    cancelBtn.onmouseleave = () => { cancelBtn.style.filter = 'none'; };
    cancelBtn.onclick = () => doCancel();

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.textContent = shareAudio ? 'Share with Audio' : 'Share';
    shareBtn.style.padding = '9px 26px';
    shareBtn.style.borderRadius = '20px';
    shareBtn.style.border = 'none';
    shareBtn.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
    shareBtn.style.color = '#ffffff';
    shareBtn.style.fontSize = '13px';
    shareBtn.style.fontWeight = '600';
    shareBtn.style.cursor = selectedItem ? 'pointer' : 'not-allowed';
    shareBtn.style.opacity = selectedItem ? '1' : '0.5';
    shareBtn.style.transition = 'all 0.15s ease';
    shareBtn.onmouseenter = () => { if (selectedItem) shareBtn.style.filter = 'brightness(1.08)'; };
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
            audioLabel.textContent = 'Share with tab audio';
            switchTrack.style.cursor = 'pointer';
            switchTrack.style.opacity = '1';
            switchTrack.style.pointerEvents = 'auto';
            switchTrack.style.backgroundColor = shareAudio ? 'var(--chrome-accent, #1a73e8)' : '#747775';
            switchThumb.style.left = shareAudio ? '21px' : '3px';
        } else if (!supportsSystemAudio) {
            audioLabel.textContent = 'Share with system audio (requires macOS 13+)';
            switchTrack.style.cursor = 'not-allowed';
            switchTrack.style.opacity = '0.5';
            switchTrack.style.pointerEvents = 'none';
            switchTrack.style.backgroundColor = '#747775';
            switchThumb.style.left = '3px';
        } else {
            audioLabel.textContent = 'Share with system audio';
            switchTrack.style.cursor = 'pointer';
            switchTrack.style.opacity = '1';
            switchTrack.style.pointerEvents = 'auto';
            switchTrack.style.backgroundColor = shareAudio ? 'var(--chrome-accent, #1a73e8)' : '#747775';
            switchThumb.style.left = shareAudio ? '21px' : '3px';
        }

        const effectiveAudio = canRequestAudio && shareAudio && (activeCategory === 'tabs' || supportsSystemAudio);
        if (effectiveAudio) {
            shareBtn.textContent = 'Share with Audio';
        } else {
            shareBtn.textContent = 'Share';
        }
    }

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(shareBtn);
    footer.appendChild(btnRow);
    DOM.panel.appendChild(footer);

    function doCancel() {
        activePickerInstance = null;
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
        activePickerInstance = null;
        DOM.backdrop.classList.remove('co-backdrop--modal');
        hideAll({ hideLens: false });
        const effectiveAudio = canRequestAudio && shareAudio && (activeCategory === 'tabs' || supportsSystemAudio);
        notifyHost({
            type: 'desktopMediaPickerResponse',
            requestId,
            cancelled: false,
            sourceId: selectedItem.id,
            sourceKind: activeCategory === 'tabs' ? 'tab' : (activeCategory === 'windows' ? 'window' : 'screen'),
            tabId: selectedItem.tabId || null,
            shareAudio: !!effectiveAudio,
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

