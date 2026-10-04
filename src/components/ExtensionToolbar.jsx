import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import './ExtensionToolbar.css';

export default function ExtensionToolbar({ onNavigate }) {
  const [extensions, setExtensions] = useState([]);
  const [actionBadges, setActionBadges] = useState({});
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

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

  const postMenuPayload = useCallback(async (currentExtensions) => {
    if (!triggerRef.current) return;
    const br = triggerRef.current.getBoundingClientRect();
    const list = currentExtensions || extensionsRef.current;

    const payload = {
      kind: 'extensionMenu',
      extensions: list.map(e => ({
        id: e.id,
        name: e.name,
        version: e.version,
        enabled: e.enabled,
        pinned: !!e.pinned,
        pinnedAt: e.pinnedAt || 0,
        iconDataUrl: e.iconDataUrl || null,
        hasPopup: e.hasPopup,
        hasHostAccess: !(e.id === 'omnibox' || e.name?.toLowerCase() === 'omnibox' || (e.permissions?.hostPermissions && e.permissions.hostPermissions.length === 0)),
      })),
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
  }, [post]);
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

  // All pinned extensions visible on toolbar
  const pinnedExtensions = extensions
    .filter(e => e.enabled && e.pinned)
    .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));

  const handleActionClick = (e, ext) => {
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
    >
      {/* Pinned Extension Action Icons on Toolbar */}
      {pinnedExtensions.map((ext) => {
        const badge = actionBadges[ext.id];
        const badgeText = badge?.badgeText || '';
        const badgeBg = badge?.badgeBgColor || '#4688F1';
        const badgeColor = badge?.badgeTextColor || '#FFFFFF';

        return (
          <button
            key={ext.id}
            className="btn extension-action-btn"
            title={`${ext.name} (v${ext.version})`}
            onClick={(e) => handleActionClick(e, ext)}
          >
            {ext.iconDataUrl ? (
              <img
                src={ext.iconDataUrl}
                alt={ext.name}
                className="extension-action-img"
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
