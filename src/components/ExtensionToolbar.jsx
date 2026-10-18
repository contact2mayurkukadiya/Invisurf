import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import './ExtensionToolbar.css';

function matchesPattern(pattern, rawUrl) {
  if (!pattern || !rawUrl) return false;
  const p = String(pattern).trim();
  if (p === '<all_urls>') {
    return rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
  }
  try {
    const regexStr = '^' + p
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr).test(rawUrl);
  } catch {
    return false;
  }
}

function isActionEnabled(ext, currentTabUrl, actionBadge) {
  if (!ext || ext.enabled === false) return false;
  if (actionBadge?.enabled === false) return false;

  const url = String(currentTabUrl || '').trim();
  const isWebUrl = url.startsWith('http://') || url.startsWith('https://');

  // Internal browser pages (invisurf://, about:blank, etc.) do not allow extension action execution
  if (!isWebUrl) {
    return false;
  }

  // Check user preference site access restriction
  if (ext.siteAccess === 'onHost') {
    let host = '';
    try { host = new URL(url).host; } catch (_) {}
    if (!host || !(Array.isArray(ext.allowedHosts) && ext.allowedHosts.includes(host))) {
      return false;
    }
  }

  // If extension is a page action or action.default_state === 'disabled'
  if (ext.isPageAction && actionBadge?.enabled !== true) {
    if (Array.isArray(ext.urlPatterns) && ext.urlPatterns.length > 0) {
      return ext.urlPatterns.some(p => matchesPattern(p, url));
    }
    return false;
  }

  // If extension specifies specific URLs in manifest (and not all URLs)
  if (ext.hasAllUrls === false && Array.isArray(ext.urlPatterns) && ext.urlPatterns.length > 0) {
    return ext.urlPatterns.some(p => matchesPattern(p, url));
  }

  // Extension configured for all URLs or general web action
  return true;
}

export default function ExtensionToolbar({ onNavigate, currentTabUrl }) {
  const [extensions, setExtensions] = useState([]);
  const [actionBadges, setActionBadges] = useState({});
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;
  const currentTabUrlRef = useRef(currentTabUrl);
  currentTabUrlRef.current = currentTabUrl;

  const { reset, acquire, release, post } = useChromeShellMenuOverlay();
  const pendingOwnResetRef = useRef(false);
  const justClosedAtRef = useRef(0);

  const loadExtensions = useCallback(async () => {
    try {
      if (window.extensionAPI?.list) {
        const list = await window.extensionAPI.list();
        const validList = Array.isArray(list) ? list : [];
        setExtensions(validList);
        const initialBadges = {};
        for (const ext of validList) {
          if (ext.actionState) {
            initialBadges[ext.id] = ext.actionState;
          }
        }
        setActionBadges(prev => ({ ...initialBadges, ...prev }));
        return validList;
      }
    } catch (err) {
      console.warn('Failed to load extensions for toolbar:', err);
    }
    return [];
  }, []);

  const extensionsRef = useRef([]);
  extensionsRef.current = extensions;
  const postMenuPayloadRef = useRef(null);

  const getTabHost = useCallback((url) => {
    try {
      const u = url || currentTabUrlRef.current;
      if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
        return new URL(u).host;
      }
    } catch (_) {}
    return '';
  }, []);

  const postMenuPayload = useCallback(async (currentExtensions) => {
    if (!triggerRef.current) return;
    const br = triggerRef.current.getBoundingClientRect();
    const list = currentExtensions || extensionsRef.current;
    const currentTabHost = getTabHost();

    const payload = {
      kind: 'extensionMenu',
      contextMenuOnly: false,
      currentTabHost,
      currentTabUrl: currentTabUrlRef.current || '',
      extensions: list.map(e => {
        const badge = actionBadges[e.id];
        const isEnabled = isActionEnabled(e, currentTabUrlRef.current, badge);
        return {
          id: e.id,
          name: e.name,
          version: e.version,
          enabled: e.enabled,
          actionDisabled: !isEnabled,
          pinned: !!e.pinned,
          pinnedAt: e.pinnedAt || 0,
          iconDataUrl: badge?.icon || e.iconDataUrl || null,
          hasPopup: e.hasPopup,
          hasOptionsPage: !!(e.hasOptionsPage || e.optionsPage),
          optionsPage: e.optionsPage || null,
          hasHostAccess: isEnabled && !(e.id === 'omnibox' || e.name?.toLowerCase() === 'omnibox' || (e.permissions?.hostPermissions && e.permissions.hostPermissions.length === 0)),
          siteAccess: e.siteAccess || 'all',
          allowedHosts: e.allowedHosts || [],
        };
      }),
      anchorRect: {
        left: Math.round(br.left),
        top: Math.round(br.top),
        right: Math.round(br.right),
        bottom: Math.round(br.bottom),
        width: Math.round(br.width),
        height: Math.round(br.height),
      },
    };

    try {
      await post(payload);
    } catch (err) {
      console.error('ExtensionToolbar chromeShellMenuOverlayV1Post', err);
    }
  }, [actionBadges, getTabHost, post]);
  postMenuPayloadRef.current = postMenuPayload;

  const closeMenu = useCallback(async () => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    try {
      await release();
    } catch (err) {
      console.error('ExtensionToolbar release error:', err);
    }
  }, [release]);

  const openMenu = useCallback(async () => {
    if (openRef.current) {
      await closeMenu();
      return;
    }
    const freshList = await loadExtensions();
    pendingOwnResetRef.current = true;
    try {
      await reset();
      await acquire();
      openRef.current = true;
      setOpen(true);
      await postMenuPayload(freshList);
    } catch (err) {
      console.error('ExtensionToolbar openMenu error:', err);
      openRef.current = false;
      setOpen(false);
      try { await release(); } catch (_) {}
    } finally {
      setTimeout(() => {
        pendingOwnResetRef.current = false;
      }, 300);
    }
  }, [acquire, closeMenu, loadExtensions, postMenuPayload, release, reset]);

  const handleActionContextMenu = useCallback(async (e, ext) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const anchorRect = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const currentTabHost = getTabHost();

    const payload = {
      kind: 'extensionMenu',
      contextMenuOnly: true,
      currentTabHost,
      currentTabUrl: currentTabUrlRef.current || '',
      selectedExtension: {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        pinned: !!ext.pinned,
        pinnedAt: ext.pinnedAt || 0,
        iconDataUrl: actionBadges[ext.id]?.icon || ext.iconDataUrl || null,
        hasPopup: ext.hasPopup,
        hasOptionsPage: !!(ext.hasOptionsPage || ext.optionsPage),
        optionsPage: ext.optionsPage || null,
        hasHostAccess: !(ext.id === 'omnibox' || ext.name?.toLowerCase() === 'omnibox' || (ext.permissions?.hostPermissions && ext.permissions.hostPermissions.length === 0)),
        siteAccess: ext.siteAccess || 'all',
        allowedHosts: ext.allowedHosts || [],
      },
      anchorRect,
    };

    pendingOwnResetRef.current = true;
    try {
      await reset();
      await acquire();
      openRef.current = true;
      setOpen(true);
      await post(payload);
    } catch (err) {
      console.error('ExtensionToolbar handleActionContextMenu error:', err);
      openRef.current = false;
      setOpen(false);
      try { await release(); } catch (_) {}
    } finally {
      setTimeout(() => {
        pendingOwnResetRef.current = false;
      }, 300);
    }
  }, [acquire, getTabHost, post, release, reset]);

  const handleToggleMenu = useCallback(() => {
    // Guard against backdrop dismiss click-through double-fire
    if (Date.now() - justClosedAtRef.current < 200) return;
    if (openRef.current) {
      void closeMenu();
    } else {
      void openMenu();
    }
  }, [closeMenu, openMenu]);

  useEffect(() => {
    loadExtensions();

    const unsubUpdated = window.extensionAPI?.onExtensionsUpdated?.(() => {
      loadExtensions().then((list) => {
        if (openRef.current && postMenuPayloadRef.current) {
          void postMenuPayloadRef.current(list);
        }
      });
    });

    const unsubAction = window.extensionAPI?.onActionStateUpdated?.(({ extensionId, state }) => {
      setActionBadges(prev => ({
        ...prev,
        [extensionId]: state,
      }));
    });

    return () => {
      if (typeof unsubUpdated === 'function') unsubUpdated();
      if (typeof unsubAction === 'function') unsubAction();
    };
  }, [loadExtensions]);

  // Listen for overlay dismiss or actions
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.(async (data) => {
      if (!openRef.current) return;
      const t = data?.type;
      if (t === 'dismiss') {
        justClosedAtRef.current = Date.now();
        void closeMenu();
      } else if (t === 'extensionToggle') {
        try {
          if (window.extensionAPI?.toggle) {
            await window.extensionAPI.toggle(data.extensionId);
            const list = await loadExtensions();
            if (openRef.current) void postMenuPayload(list);
          }
        } catch (e) {
          console.error('Failed to toggle extension:', e);
        }
      } else if (t === 'extensionTogglePin') {
        try {
          if (window.extensionAPI?.togglePin) {
            await window.extensionAPI.togglePin(data.extensionId);
            const list = await loadExtensions();
            if (openRef.current) void postMenuPayload(list);
          }
        } catch (e) {
          console.error('Failed to toggle extension pin:', e);
        }
      } else if (t === 'extensionActivate') {
        void closeMenu();
        try {
          if (window.extensionAPI?.activateAction) {
            const tr = triggerRef.current?.getBoundingClientRect();
            const anchorRect = tr ? {
              left: Math.round(tr.left),
              top: Math.round(tr.top),
              right: Math.round(tr.right),
              bottom: Math.round(tr.bottom),
              width: Math.round(tr.width),
              height: Math.round(tr.height),
            } : null;
            await window.extensionAPI.activateAction(data.extensionId, anchorRect);
          }
        } catch (e) {
          console.error('Failed to activate extension action:', e);
        }
      } else if (t === 'extensionUninstall') {
        try {
          if (window.extensionAPI?.uninstall) {
            await window.extensionAPI.uninstall(data.extensionId);
            const list = await loadExtensions();
            if (openRef.current) void postMenuPayload(list);
          }
        } catch (e) {
          console.error('Failed to uninstall extension:', e);
        }
      } else if (t === 'extensionSetSiteAccess') {
        try {
          if (window.extensionAPI?.setSiteAccess) {
            await window.extensionAPI.setSiteAccess(data.extensionId, data.mode, data.host);
            const list = await loadExtensions();
            if (openRef.current) {
              void postMenuPayload(list);
            }
          }
        } catch (e) {
          console.error('Failed to set extension site access:', e);
        }
      } else if (t === 'extensionInspectPopup') {
        try {
          if (window.extensionAPI?.inspectPopup) {
            await window.extensionAPI.inspectPopup(data.extensionId);
          }
        } catch (e) {
          console.error('Failed to inspect popup:', e);
        }
      } else if (t === 'extensionOpenOptions') {
        void closeMenu();
        try {
          if (window.extensionAPI?.openOptionsPage) {
            await window.extensionAPI.openOptionsPage(data.extensionId);
          }
        } catch (e) {
          console.error('Failed to open extension options page:', e);
        }
      } else if (t === 'extensionNavigate') {
        void closeMenu();
        if (typeof onNavigate === 'function') {
          onNavigate(data.url);
        } else if (window.electronAPI?.createTab) {
          window.electronAPI.createTab({ url: data.url });
        }
      }
    });

    return typeof unsub === 'function' ? unsub : undefined;
  }, [closeMenu, loadExtensions, onNavigate, postMenuPayload]);

  // Handle overlay superseded
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (pendingOwnResetRef.current) return;
      if (!openRef.current) return;
      void closeMenu();
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [closeMenu]);

  // Reposition on window resize if open
  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      void postMenuPayload();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, postMenuPayload]);

  // Listen to global app navigate requests from overlay
  useEffect(() => {
    const unsub = window.electronAPI?.onAppNavigateUrl?.((data) => {
      if (data?.url) {
        if (typeof onNavigate === 'function') {
          onNavigate(data.url);
        } else if (window.electronAPI?.createTab) {
          window.electronAPI.createTab({ url: data.url });
        }
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [onNavigate]);

  useEffect(() => {
    currentTabUrlRef.current = currentTabUrl;
    if (openRef.current && postMenuPayloadRef.current) {
      void postMenuPayloadRef.current();
    }
  }, [currentTabUrl]);

  // All pinned extensions visible on toolbar (FIFO queue limited to maximum 6 items)
  const pinnedExtensions = extensions
    .filter(e => e.pinned)
    .sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0))
    .slice(0, 6);

  const handleActionClick = (e, ext) => {
    const badge = actionBadges[ext.id];
    const isEnabled = isActionEnabled(ext, currentTabUrlRef.current, badge);
    if (!isEnabled) {
      // In Chrome, clicking a disabled action does not activate
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (window.extensionAPI?.activateAction) {
      window.extensionAPI.activateAction(ext.id, {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
  };

  const hasPinned = pinnedExtensions.length > 0;

  return (
    <div
      className={`extensions-toolbar-container${hasPinned ? ' extensions-toolbar-container--has-pinned' : ''}${open ? ' is-open' : ''}`}
      onMouseDown={(e) => {
        if (e.detail > 1) e.preventDefault();
      }}
      onSelectStart={(e) => e.preventDefault()}
    >
      {/* Pinned Extension Action Icons on Toolbar */}
      {pinnedExtensions.map((ext) => {
        const badge = actionBadges[ext.id];
        const badgeText = badge?.badgeText || '';
        const badgeBg = badge?.badgeBgColor || '#4688F1';
        const badgeColor = badge?.badgeTextColor || '#FFFFFF';
        const isEnabled = isActionEnabled(ext, currentTabUrl, badge);
        const iconSrc = badge?.icon || ext.iconDataUrl;

        return (
          <button
            key={ext.id}
            className={`btn extension-action-btn${!isEnabled ? ' extension-action-btn--disabled' : ''}`}
            title={isEnabled ? `${ext.name} (v${ext.version})` : ext.enabled === false ? `${ext.name} (disabled)` : `${ext.name} (disabled on this site)`}
            aria-disabled={!isEnabled}
            onClick={(e) => handleActionClick(e, ext)}
            onContextMenu={(e) => handleActionContextMenu(e, ext)}
            onMouseDown={(e) => {
              if (e.detail > 1) e.preventDefault();
            }}
          >
            {iconSrc ? (
              <img
                src={iconSrc}
                alt={ext.name}
                className="extension-action-img"
                draggable={false}
              />
            ) : (
              <span className="extension-action-fallback">🧩</span>
            )}
            {badgeText ? (
              <span
                className="extension-badge"
                style={{
                  backgroundColor: badgeBg,
                  color: badgeColor,
                }}
              >
                {badgeText}
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Extensions Puzzle Icon */}
      <button
        ref={triggerRef}
        id="extensions-menu-btn"
        className={`btn extensions-menu-btn${open ? ' active' : ''}`}
        title="Extensions"
        aria-label="Extensions"
        aria-expanded={open}
        onClick={handleToggleMenu}
        onMouseDown={(e) => {
          if (e.detail > 1) e.preventDefault();
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 3.5 6 C 3.5 5.17 4.17 4.5 5 4.5 H 7.75 V 3.25 C 7.75 2.28 8.53 1.5 9.5 1.5 C 10.47 1.5 11.25 2.28 11.25 3.25 V 4.5 H 14 C 14.83 4.5 15.5 5.17 15.5 6 V 8.75 H 16.75 C 17.72 8.75 18.5 9.53 18.5 10.5 C 18.5 11.47 17.72 12.25 16.75 12.25 H 15.5 V 15 C 15.5 15.83 14.83 16.5 14 16.5 H 5 C 4.17 16.5 3.5 15.83 3.5 15 V 12.25 H 4.75 C 5.72 12.25 6.5 11.47 6.5 10.5 C 6.5 9.53 5.72 8.75 4.75 8.75 H 3.5 Z" />
        </svg>
      </button>
    </div>
  );
}
