/**
 * Chrome Web Store InviSurf Integration Script (Built from scratch)
 * 
 * 1. Fully compliant with Chrome Web Store's strict Trusted Types CSP (Zero innerHTML / outerHTML).
 * 2. Safely hides promo banners without ever hiding the header, title, or button section.
 * 3. Transforms "Add to Chrome" / "Available on Chrome" into "Add to InviSurf".
 * 4. Displays a real-time animated SVG spinner during download and confirmation.
 * 5. Handles Single Page Application (SPA) navigation across extension detail pages.
 */

const WEBSTORE_INJECTION_CODE = `
(function() {
  if (window.__invisurf_webstore_initialized) {
    if (typeof window.__invisurf_refresh_webstore === 'function') {
      window.__invisurf_refresh_webstore();
    }
    return;
  }
  window.__invisurf_webstore_initialized = true;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // --- SVG Icons (Created via DOM to comply with Trusted Types) ---
  function createSvgElement(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [key, val] of Object.entries(attrs)) {
        el.setAttribute(key, val);
      }
    }
    return el;
  }

  function createPlusIcon() {
    const svg = createSvgElement('svg', {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
    svg.appendChild(createSvgElement('line', { x1: '12', y1: '5', x2: '12', y2: '19' }));
    svg.appendChild(createSvgElement('line', { x1: '5', y1: '12', x2: '19', y2: '12' }));
    return svg;
  }

  function createSpinnerIcon() {
    const svg = createSvgElement('svg', {
      class: 'invisurf-btn-spinner',
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none'
    });
    const bgCircle = createSvgElement('circle', {
      cx: '12',
      cy: '12',
      r: '9',
      stroke: 'rgba(255, 255, 255, 0.28)',
      'stroke-width': '3'
    });
    const arc = createSvgElement('path', {
      d: 'M12 3a9 9 0 0 1 9 9',
      stroke: '#ffffff',
      'stroke-width': '3',
      'stroke-linecap': 'round'
    });
    svg.appendChild(bgCircle);
    svg.appendChild(arc);
    return svg;
  }

  function createCheckIcon() {
    const svg = createSvgElement('svg', {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
    svg.appendChild(createSvgElement('polyline', { points: '20 6 9 17 4 12' }));
    return svg;
  }

  function createModalIcon() {
    const svg = createSvgElement('svg', {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
    svg.appendChild(createSvgElement('rect', { x: '3', y: '3', width: '18', height: '18', rx: '4', ry: '4' }));
    svg.appendChild(createSvgElement('line', { x1: '9', y1: '9', x2: '15', y2: '9' }));
    svg.appendChild(createSvgElement('line', { x1: '12', y1: '12', x2: '12', y2: '16' }));
    return svg;
  }

  function createAlertIcon() {
    const svg = createSvgElement('svg', {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
    svg.appendChild(createSvgElement('circle', { cx: '12', cy: '12', r: '10' }));
    svg.appendChild(createSvgElement('line', { x1: '12', y1: '8', x2: '12', y2: '12' }));
    svg.appendChild(createSvgElement('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }));
    return svg;
  }

  // --- Style Injection (Using textContent to respect Trusted Types) ---
  function injectStyles() {
    const styleId = 'invisurf-webstore-style-rules';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '@keyframes invisurf-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      '@keyframes invisurf-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.88; transform: scale(0.985); } }',
      '.invisurf-btn-spinner { animation: invisurf-spin 0.75s linear infinite !important; display: block !important; }',
      '.invisurf-pulse-anim { animation: invisurf-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite !important; }'
    ].join('\\n');
    (document.head || document.documentElement).appendChild(style);
  }

  // --- Extract Extension ID from Detail Page URL ---
  function extractExtensionId() {
    const path = window.location.pathname || '';
    const match = path.match(/\\/detail\\/(?:[^\\/]+\\/)?([a-p0-9]{32})/i);
    return match ? match[1].toLowerCase() : null;
  }

  // --- Safe Banner & Popup Removal: Never hide any section containing the button or title ---
  function dismissSwitchToChromeDialog() {
    if (window.__invisurf_dialog_dismissed) return;

    // 1. Target "No thanks" dismiss button inside the "Switch to Chrome?" popup card
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'no thanks' || text === 'no, thanks') {
        let curr = btn.parentElement;
        let cardContainer = null;
        for (let i = 0; i < 6 && curr && curr !== document.body; i++) {
          const cText = curr.textContent || '';
          if (cText.includes('Switch to Chrome') || cText.includes('Google recommends')) {
            cardContainer = curr;
            break;
          }
          curr = curr.parentElement;
        }

        if (cardContainer) {
          cardContainer.style.setProperty('display', 'none', 'important');
          cardContainer.style.setProperty('visibility', 'hidden', 'important');
          cardContainer.style.setProperty('pointer-events', 'none', 'important');
        }

        try {
          btn.click();
        } catch (_) {}
        window.__invisurf_dialog_dismissed = true;
        return;
      }
    }

    // 2. Target specific floating dialog/modal elements (never broad tag scans)
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]');
    for (const d of dialogs) {
      if (d.querySelector('h1, h2, .invisurf-action-btn, .invisurf-btn-label')) {
        continue;
      }
      const text = d.textContent || '';
      if (
        (text.includes('Switch to Chrome?') || text.includes('Google recommends using Chrome')) &&
        text.length < 350
      ) {
        d.style.setProperty('display', 'none', 'important');
        d.style.setProperty('visibility', 'hidden', 'important');
        d.style.setProperty('pointer-events', 'none', 'important');
        window.__invisurf_dialog_dismissed = true;
        return;
      }
    }
  }

  function hidePromotionalBanners() {
    dismissSwitchToChromeDialog();

    // Only target leaf links pointing to Google Chrome download
    const chromeLinks = document.querySelectorAll('a[href*="google.com/chrome"], a[href*="chrome.google.com"]');
    for (const link of chromeLinks) {
      const text = (link.textContent || '').trim().toLowerCase();
      if (text.includes('install chrome') || text.includes('switch to chrome') || text.includes('get chrome')) {
        link.style.setProperty('display', 'none', 'important');
      }
    }

    // Target specific promo banners
    const bannerCandidates = document.querySelectorAll('[role="banner"], [role="status"], [role="alert"], aside');
    for (const el of bannerCandidates) {
      if (el.querySelector('button, [role="button"], h1, h2, img[src*="googleusercontent"]')) {
        continue;
      }
      const text = (el.textContent || '').trim();
      if (text.includes('Switch to Chrome') && text.length < 160) {
        el.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // --- Locate Action Button on Page ---
  function findActionButton() {
    if (window.__invisurf_active_button && document.body.contains(window.__invisurf_active_button)) {
      return window.__invisurf_active_button;
    }

    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const el of buttons) {
      // Ignore hidden or zero-size buttons
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.getClientRects().length) {
        continue;
      }

      const text = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();

      if (
        text === 'add to chrome' ||
        text === 'add to invisurf' ||
        text.startsWith('add to chrome') ||
        text.startsWith('add to invisurf') ||
        text === 'available on chrome' ||
        text.includes('add to chrome') ||
        text.includes('available on chrome') ||
        text.includes('remove from chrome') ||
        aria.includes('add to chrome') ||
        aria.includes('available on chrome') ||
        aria.includes('add to invisurf') ||
        aria.includes('remove from chrome')
      ) {
        window.__invisurf_active_button = el;
        return el;
      }
    }
    return null;
  }

  // --- Safe DOM Content Setter (Zero innerHTML to satisfy Trusted Types) ---
  function updateButtonDom(btn, iconElement, labelText) {
    while (btn.firstChild) {
      btn.removeChild(btn.firstChild);
    }

    const iconSpan = document.createElement('span');
    iconSpan.style.display = 'inline-flex';
    iconSpan.style.alignItems = 'center';
    iconSpan.style.justifyContent = 'center';
    iconSpan.style.marginRight = '8px';
    iconSpan.style.flexShrink = '0';
    iconSpan.appendChild(iconElement);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = labelText;
    labelSpan.style.whiteSpace = 'nowrap';
    labelSpan.style.letterSpacing = '0.2px';

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
  }

  // --- Button State Renderers ---
  function applyBaseButtonStyles(btn) {
    btn.style.setProperty('display', 'inline-flex', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('height', '40px', 'important');
    btn.style.setProperty('min-height', '40px', 'important');
    btn.style.setProperty('padding', '0 24px', 'important');
    btn.style.setProperty('border-radius', '20px', 'important');
    btn.style.setProperty('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'important');
    btn.style.setProperty('font-size', '14px', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('line-height', '1', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('outline', 'none', 'important');
    btn.style.setProperty('text-decoration', 'none', 'important');
    btn.style.setProperty('user-select', 'none', 'important');
    btn.style.setProperty('box-sizing', 'border-box', 'important');
    btn.style.setProperty('transition', 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', 'important');
  }

  function renderInstallable(btn) {
    applyBaseButtonStyles(btn);
    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('invisurf-pulse-anim');

    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('cursor', 'pointer', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 4px 14px rgba(99, 102, 241, 0.45)', 'important');

    updateButtonDom(btn, createPlusIcon(), 'Add to InviSurf');

    btn.onmouseenter = () => {
      if (!btn.disabled && !btn.__invisurfInstalling) {
        btn.style.setProperty('background', 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)', 'important');
        btn.style.setProperty('box-shadow', '0 6px 18px rgba(99, 102, 241, 0.55)', 'important');
        btn.style.setProperty('transform', 'translateY(-1px)', 'important');
      }
    };
    btn.onmouseleave = () => {
      if (!btn.disabled && !btn.__invisurfInstalling) {
        btn.style.setProperty('background', 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 'important');
        btn.style.setProperty('box-shadow', '0 4px 14px rgba(99, 102, 241, 0.45)', 'important');
        btn.style.setProperty('transform', 'translateY(0)', 'important');
      }
    };
  }

  function renderLoading(btn, text) {
    applyBaseButtonStyles(btn);
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.remove('invisurf-pulse-anim');

    btn.style.setProperty('pointer-events', 'none', 'important');
    btn.style.setProperty('cursor', 'wait', 'important');
    btn.style.setProperty('opacity', '0.92', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 4px 14px rgba(99, 102, 241, 0.35)', 'important');
    btn.style.setProperty('transform', 'translateY(0)', 'important');

    updateButtonDom(btn, createSpinnerIcon(), text || 'Downloading');
  }

  function renderConfirming(btn) {
    applyBaseButtonStyles(btn);
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('invisurf-pulse-anim');

    btn.style.setProperty('pointer-events', 'none', 'important');
    btn.style.setProperty('cursor', 'default', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 4px 16px rgba(139, 92, 246, 0.45)', 'important');

    updateButtonDom(btn, createModalIcon(), 'Confirming');
  }

  function renderInstalled(btn) {
    applyBaseButtonStyles(btn);
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.remove('invisurf-pulse-anim');

    btn.style.setProperty('pointer-events', 'none', 'important');
    btn.style.setProperty('cursor', 'default', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 2px 10px rgba(16, 185, 129, 0.35)', 'important');
    btn.style.setProperty('transform', 'translateY(0)', 'important');

    updateButtonDom(btn, createCheckIcon(), 'Added to InviSurf ✓');
  }

  function renderError(btn, extensionId, errorMessage) {
    applyBaseButtonStyles(btn);
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.remove('invisurf-pulse-anim');

    btn.style.setProperty('pointer-events', 'none', 'important');
    btn.style.setProperty('cursor', 'default', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 4px 14px rgba(239, 68, 68, 0.45)', 'important');

    updateButtonDom(btn, createAlertIcon(), errorMessage || 'Failed to Download');

    setTimeout(() => {
      btn.__invisurfInstalling = false;
      renderInstallable(btn);
    }, 3500);
  }

  // --- Main Button Transformer ---
  async function updateButton() {
    injectStyles();
    hidePromotionalBanners();

    const extensionId = extractExtensionId();
    if (!extensionId) return;

    const btn = findActionButton();
    if (!btn) return;

    // Check if parent container blocks pointer events
    if (btn.parentElement) {
      btn.parentElement.style.setProperty('pointer-events', 'auto', 'important');
    }

    // Attach click handler once
    if (!btn.__invisurfClickBound) {
      btn.__invisurfClickBound = true;

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const targetExtId = extractExtensionId();
        if (!targetExtId || btn.__invisurfInstalling) return;

        btn.__invisurfInstalling = true;
        renderLoading(btn, 'Downloading');

        try {
          if (window.__invisurf_webstore?.prepareInstall) {
            await window.__invisurf_webstore.prepareInstall(targetExtId);
            renderConfirming(btn);
          } else {
            throw new Error('InviSurf bridge not available');
          }
        } catch (err) {
          console.error('[InviSurf] Install error:', err);
          renderError(btn, targetExtId, 'Failed to Download');
        }
      }, true); // Capture phase
    }

    // If extension ID changed or initial setup
    if (btn.__invisurfExtId !== extensionId) {
      btn.__invisurfExtId = extensionId;
      btn.__invisurfInstalling = false;

      let isInstalled = false;
      try {
        if (window.__invisurf_webstore?.isInstalled) {
          isInstalled = await window.__invisurf_webstore.isInstalled(extensionId);
        }
      } catch (_) { }

      if (isInstalled) {
        renderInstalled(btn);
      } else {
        renderInstallable(btn);
      }
    }
  }

  window.__invisurf_refresh_webstore = updateButton;

  // --- Listeners for InviSurf Main Process Events ---
  window.addEventListener('invisurf:install-completed', (e) => {
    const extId = e.detail?.extensionId;
    const currentId = extractExtensionId();
    if (!extId || extId === currentId) {
      const btn = findActionButton();
      if (btn) {
        btn.__invisurfInstalling = false;
        renderInstalled(btn);
      }
    }
  });

  window.addEventListener('invisurf:install-cancelled', (e) => {
    const extId = e.detail?.extensionId;
    const currentId = extractExtensionId();
    if (!extId || extId === currentId) {
      const btn = findActionButton();
      if (btn) {
        btn.__invisurfInstalling = false;
        renderInstallable(btn);
      }
    }
  });

  // --- SPA Navigation (popstate / pushState / replaceState) ---
  const onUrlChange = () => {
    window.__invisurf_dialog_dismissed = false;
    window.__invisurf_active_button = null;
    setTimeout(updateButton, 100);
    setTimeout(updateButton, 500);
  };
  window.addEventListener('popstate', onUrlChange);

  const origPush = history.pushState;
  history.pushState = function(...args) {
    origPush.apply(this, args);
    onUrlChange();
  };

  const origReplace = history.replaceState;
  history.replaceState = function(...args) {
    origReplace.apply(this, args);
    onUrlChange();
  };

  // --- Debounced DOM Observer for dynamic loading & hydration ---
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) return;
    debounceTimeout = setTimeout(() => {
      debounceTimeout = null;
      dismissSwitchToChromeDialog();
      updateButton();
    }, 200);
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial trigger & short bounded poll for hydration
  dismissSwitchToChromeDialog();
  updateButton();
  let pollCount = 0;
  const pollTimer = setInterval(() => {
    dismissSwitchToChromeDialog();
    updateButton();
    pollCount++;
    if (pollCount > 6) clearInterval(pollTimer);
  }, 250);
})();
`;

module.exports = {
  WEBSTORE_INJECTION_CODE,
};
