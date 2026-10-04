/**
 * Chrome Web Store InviSurf Integration Script
 * Safely targets the Chrome Web Store detail page:
 * 1. Hides ONLY the "Switch to Chrome" banner box without affecting any page containers.
 * 2. Finds the "Add to Chrome" button, enables it, and restyles it as "Add to InviSurf".
 * 3. Binds click to trigger InviSurf's atomic CRX download and permission consent modal.
 */

const WEBSTORE_INJECTION_CODE = `
(function() {
  if (window.__invisurf_webstore_active) return;
  window.__invisurf_webstore_active = true;

  console.log('[InviSurf] Chrome Web Store integration initialized');

  function extractExtensionId() {
    const path = window.location.pathname || '';
    const match = path.match(/\\/detail\\/(?:[^\\/]+\\/)?([a-p0-9]{32})/i);
    return match ? match[1].toLowerCase() : null;
  }

  // 1. Safely hide ONLY the banner box
  function hideSwitchToChromeBanner() {
    const links = document.querySelectorAll('a, button');
    for (const link of links) {
      const txt = (link.textContent || '').trim().toLowerCase();
      if (txt === 'install chrome' || txt.includes('install chrome')) {
        let parent = link.parentElement;
        for (let i = 0; i < 4 && parent && parent !== document.body; i++) {
          if ((parent.textContent || '').includes('Switch to Chrome')) {
            parent.style.setProperty('display', 'none', 'important');
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
  }

  // 2. Locate the "Add to Chrome" action button
  function findActionButton() {
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (
        text === 'Add to Chrome' ||
        text === 'Add to InviSurf' ||
        text.startsWith('Add to Chrome') ||
        text === 'Available on Chrome'
      ) {
        return el;
      }
    }
    return null;
  }

  // 3. Transform the button to "Add to InviSurf"
  async function updateButton() {
    hideSwitchToChromeBanner();

    const extensionId = extractExtensionId();
    if (!extensionId) return;

    const btn = findActionButton();
    if (!btn) return;

    // Check if already transformed for this extension ID
    if (btn.__invisurfBound && btn.__invisurfExtId === extensionId) return;
    btn.__invisurfBound = true;
    btn.__invisurfExtId = extensionId;

    // Check if already installed in InviSurf
    let isInstalled = false;
    try {
      if (window.__invisurf_webstore?.isInstalled) {
        isInstalled = await window.__invisurf_webstore.isInstalled(extensionId);
      }
    } catch (_) { }

    if (isInstalled) {
      renderInstalled(btn);
    } else {
      renderInstallable(btn, extensionId);
    }
  }

  function renderInstallable(btn, extensionId) {
    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('disabled');

    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('cursor', 'pointer', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('background-color', '#6366f1', 'important');
    btn.style.setProperty('background', 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('border-radius', '24px', 'important');
    btn.style.setProperty('padding', '8px 24px', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('font-size', '14px', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('box-shadow', '0 4px 14px rgba(99, 102, 241, 0.45)', 'important');
    btn.style.setProperty('transition', 'all 0.2s ease', 'important');

    // Update text
    const textNode = btn.querySelector('span') || btn;
    textNode.textContent = 'Add to InviSurf';

    // Click handler with capture to override Google's default disabled behavior
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (btn.__invisurfInstalling) return;
      btn.__invisurfInstalling = true;

      textNode.textContent = 'Checking & Downloading...';
      btn.style.setProperty('opacity', '0.85', 'important');

      try {
        if (window.__invisurf_webstore?.prepareInstall) {
          await window.__invisurf_webstore.prepareInstall(extensionId);
          textNode.textContent = 'Confirm in InviSurf...';
        } else {
          throw new Error('Webstore bridge not available');
        }
      } catch (err) {
        console.error('[InviSurf] Install error:', err);
        textNode.textContent = 'Failed to Download';
        btn.style.setProperty('background', '#ef4444', 'important');
        setTimeout(() => {
          btn.__invisurfInstalling = false;
          renderInstallable(btn, extensionId);
        }, 3000);
      }
    }, true);
  }

  function renderInstalled(btn) {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.style.setProperty('pointer-events', 'none', 'important');
    btn.style.setProperty('cursor', 'default', 'important');
    btn.style.setProperty('background', '#10b981', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('border-radius', '24px', 'important');
    btn.style.setProperty('padding', '8px 24px', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('box-shadow', 'none', 'important');
    const textNode = btn.querySelector('span') || btn;
    textNode.textContent = 'Added to InviSurf ✓';
  }

  // Listen for installation events from InviSurf main process
  window.addEventListener('invisurf:install-completed', (e) => {
    const extId = e.detail?.extensionId;
    if (extId === extractExtensionId()) {
      const btn = findActionButton();
      if (btn) renderInstalled(btn);
    }
  });

  window.addEventListener('invisurf:install-cancelled', (e) => {
    const extId = e.detail?.extensionId;
    if (extId === extractExtensionId()) {
      const btn = findActionButton();
      if (btn) {
        btn.__invisurfInstalling = false;
        renderInstallable(btn, extId);
      }
    }
  });

  // Execute immediately
  updateButton();

  // Watch for dynamic DOM loads
  const observer = new MutationObserver(() => {
    updateButton();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Short poll to catch initial hydration
  let count = 0;
  const timer = setInterval(() => {
    updateButton();
    count++;
    if (count > 12) clearInterval(timer);
  }, 400);
})();
`;

function initWebstoreBridge(ipcRenderer) {
    if (!ipcRenderer || typeof window === 'undefined') return;

    ipcRenderer.on('extensions:install-completed', (_event, data) => {
        window.dispatchEvent(new CustomEvent('invisurf:install-completed', { detail: data }));
    });

    ipcRenderer.on('extensions:install-cancelled', (_event, data) => {
        window.dispatchEvent(new CustomEvent('invisurf:install-cancelled', { detail: data }));
    });

    try {
        const script = document.createElement('script');
        script.textContent = WEBSTORE_INJECTION_CODE;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    } catch (_) {
        try {
            eval(WEBSTORE_INJECTION_CODE);
        } catch (e) {
            console.warn('[InviSurf] Webstore injection error:', e);
        }
    }
}

module.exports = {
    WEBSTORE_INJECTION_CODE,
    initWebstoreBridge,
};
