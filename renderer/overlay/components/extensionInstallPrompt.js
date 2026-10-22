import { DOM, hideAll } from '../state.js';
import { applyChromeThemeTokens, notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

/**
 * Renders the Extension Installation Prompt Dialog directly in the top-level
 * overlay WebContentsView so it floats completely above all web content.
 * Styled with semantic theme variables to match the user's chosen light/dark appearance.
 * 
 * @param {Object} payload
 * @param {string} payload.installToken
 * @param {string} payload.extensionId
 * @param {string} payload.name
 * @param {string} payload.version
 * @param {string} [payload.iconDataUrl]
 * @param {Array} [payload.warnings]
 * @param {Object} [payload.theme]
 */
export function renderExtensionInstallPrompt(payload) {
    hideAll({ hideLens: false });

    if (payload.theme) {
        applyChromeThemeTokens(payload.theme);
    }

    const installToken = payload.installToken;
    const name = payload.name || 'Extension';
    const version = payload.version || '1.0.0';
    const iconDataUrl = payload.iconDataUrl || null;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

    const width = 400;
    const metrics = getCompactMenuMetrics(payload);
    const left0 = Math.max(16, Math.round((metrics.viewportWidth - width) / 2));
    const top0 = 50;

    const panelPoint = toCompactMenuPoint(payload, left0, top0);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.min(520, metrics.viewportHeight - top0 - 24) + 'px';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.style.borderRadius = '16px';
    DOM.panel.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
    DOM.panel.style.color = 'var(--chrome-fg, #202124)';
    DOM.panel.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    DOM.panel.style.boxShadow = '0 16px 36px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    DOM.panel.classList.remove('co-panel--app-menu');
    DOM.panel.classList.add('co-visible');
    DOM.backdrop.classList.add('co-visible', 'co-backdrop--modal');

    // 1. Header (Icon + Name + Title)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '14px';
    header.style.padding = '20px 20px 14px';
    header.style.flexShrink = '0';

    const iconBox = document.createElement('div');
    iconBox.style.width = '48px';
    iconBox.style.height = '48px';
    iconBox.style.borderRadius = '12px';
    iconBox.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 85%, var(--chrome-fg, #000000) 15%)';
    iconBox.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    iconBox.style.display = 'flex';
    iconBox.style.alignItems = 'center';
    iconBox.style.justifyContent = 'center';
    iconBox.style.flexShrink = '0';
    iconBox.style.overflow = 'hidden';

    if (iconDataUrl) {
        const img = document.createElement('img');
        img.src = iconDataUrl;
        img.style.width = '36px';
        img.style.height = '36px';
        img.style.objectFit = 'contain';
        iconBox.appendChild(img);
    } else {
        const puzzle = document.createElement('span');
        puzzle.style.fontSize = '24px';
        puzzle.textContent = '🧩';
        iconBox.appendChild(puzzle);
    }

    const titleGroup = document.createElement('div');
    titleGroup.style.flex = '1';
    titleGroup.style.minWidth = '0';

    const titleText = document.createElement('div');
    titleText.style.fontSize = '16px';
    titleText.style.fontWeight = '600';
    titleText.style.lineHeight = '1.3';
    titleText.style.color = 'var(--chrome-fg, #202124)';
    titleText.textContent = `Add "${name}"?`;

    const versionText = document.createElement('div');
    versionText.style.fontSize = '12px';
    versionText.style.color = 'var(--chrome-secondary-fg, #5f6368)';
    versionText.style.marginTop = '2px';
    versionText.textContent = `Version ${version}`;

    titleGroup.appendChild(titleText);
    titleGroup.appendChild(versionText);
    header.appendChild(iconBox);
    header.appendChild(titleGroup);
    DOM.panel.appendChild(header);

    // 2. Permissions / Capabilities Section
    const content = document.createElement('div');
    content.style.flex = '1 1 auto';
    content.style.minHeight = '0';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.padding = '0 20px 16px';
    content.style.overflow = 'hidden';

    const promptText = document.createElement('div');
    promptText.style.fontSize = '13px';
    promptText.style.fontWeight = '500';
    promptText.style.color = 'var(--chrome-fg, #202124)';
    promptText.style.marginBottom = '10px';
    promptText.style.flexShrink = '0';
    promptText.textContent = 'It can:';
    content.appendChild(promptText);

    const warnBox = document.createElement('div');
    warnBox.className = 'co-extension-install-warnbox';
    warnBox.style.maxHeight = '180px';
    warnBox.style.overflowY = 'auto';
    warnBox.style.overscrollBehavior = 'contain';
    warnBox.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 92%, var(--chrome-fg, #000000) 8%)';
    warnBox.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.12))';
    warnBox.style.borderRadius = '10px';
    warnBox.style.padding = '10px 14px';
    warnBox.style.display = 'flex';
    warnBox.style.flexDirection = 'column';
    warnBox.style.gap = '8px';

    if (warnings.length === 0) {
        const noPerm = document.createElement('div');
        noPerm.style.fontSize = '13px';
        noPerm.style.color = 'var(--chrome-secondary-fg, #5f6368)';
        noPerm.style.display = 'flex';
        noPerm.style.alignItems = 'center';
        noPerm.style.gap = '8px';
        noPerm.innerHTML = '<span style="color: #10b981;">✓</span> No special system permissions requested.';
        warnBox.appendChild(noPerm);
    } else {
        warnings.forEach((warn) => {
            const row = document.createElement('div');
            row.style.fontSize = '13px';
            row.style.lineHeight = '1.4';
            row.style.color = 'var(--chrome-fg, #202124)';
            row.style.display = 'flex';
            row.style.alignItems = 'flex-start';
            row.style.gap = '8px';

            const bullet = document.createElement('span');
            bullet.textContent = '•';
            bullet.style.color = 'var(--chrome-accent, #1a73e8)';
            bullet.style.fontWeight = 'bold';
            bullet.style.marginTop = '-1px';
            bullet.style.flexShrink = '0';

            const text = document.createElement('span');
            let message = '';
            if (typeof warn === 'string') {
                message = warn;
            } else if (warn && typeof warn === 'object') {
                message = warn.description || warn.title || warn.permission || '';
            }
            text.textContent = message || 'Access additional browser capabilities';

            row.appendChild(bullet);
            row.appendChild(text);
            warnBox.appendChild(row);
        });
    }

    content.appendChild(warnBox);
    DOM.panel.appendChild(content);

    // 3. Footer (Action Buttons)
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.style.padding = '14px 20px';
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.08))';
    footer.style.backgroundColor = 'color-mix(in srgb, var(--chrome-nav-bg, #ffffff) 96%, var(--chrome-fg, #000000) 4%)';
    footer.style.flexShrink = '0';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.border = '1px solid var(--chrome-tab-separator, rgba(0, 0, 0, 0.15))';
    cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.style.color = 'var(--chrome-fg, #202124)';
    cancelBtn.style.fontSize = '13px';
    cancelBtn.style.fontWeight = '500';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.transition = 'background-color 0.15s ease';
    cancelBtn.onmouseenter = () => cancelBtn.style.backgroundColor = 'var(--chrome-tab-hover-bg, rgba(128, 128, 128, 0.08))';
    cancelBtn.onmouseleave = () => cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.onclick = () => {
        DOM.backdrop.classList.remove('co-backdrop--modal');
        hideAll({ hideLens: false });
        notifyHost({
            type: 'extensionInstallResponse',
            installToken,
            decision: 'deny',
        });
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Add extension';
    confirmBtn.style.padding = '8px 18px';
    confirmBtn.style.borderRadius = '8px';
    confirmBtn.style.border = 'none';
    confirmBtn.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
    confirmBtn.style.color = 'var(--chrome-omnibox-selection-fg, #ffffff)';
    confirmBtn.style.fontSize = '13px';
    confirmBtn.style.fontWeight = '600';
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.style.boxShadow = '0 2px 8px color-mix(in srgb, var(--chrome-accent, #1a73e8) 35%, transparent)';
    confirmBtn.style.transition = 'all 0.15s ease';
    confirmBtn.onmouseenter = () => confirmBtn.style.filter = 'brightness(1.08)';
    confirmBtn.onmouseleave = () => confirmBtn.style.filter = 'none';
    confirmBtn.onclick = () => {
        DOM.backdrop.classList.remove('co-backdrop--modal');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Adding...';
        confirmBtn.style.opacity = '0.7';
        notifyHost({
            type: 'extensionInstallResponse',
            installToken,
            decision: 'allow',
        });
        setTimeout(() => {
            hideAll({ hideLens: false });
        }, 600);
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    DOM.panel.appendChild(footer);
}
