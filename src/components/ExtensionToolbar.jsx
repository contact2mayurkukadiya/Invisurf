import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';

export default function ExtensionToolbar({ onNavigate }) {
  const [extensions, setExtensions] = useState([]);
  const [actionBadges, setActionBadges] = useState({});
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

  const { reset, acquire, release, post } = useChromeShellMenuOverlay();
  const pendingOwnResetRef = useRef(false);
  const leaseRevokedByResetRef = useRef(false);

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
      }
    } catch (err) {
      console.warn('Failed to load extensions for toolbar:', err);
    }
  }, []);

  useEffect(() => {
    loadExtensions();

    const unsubUpdated = window.extensionAPI?.onExtensionsUpdated?.(() => {
      loadExtensions();
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

  const syncMenuToOverlay = useCallback(async (currentExtensions) => {
    if (!triggerRef.current) return;
    const br = triggerRef.current.getBoundingClientRect();
    const list = currentExtensions || extensions;

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
      })),
      anchorRect: {
        left: br.left,
        top: br.top,
        right: br.right,
        bottom: br.bottom,
        width: br.width,
        height: br.height,
      },
    };

    try {
      await post(payload);
    } catch (err) {
      console.error('ExtensionToolbar chromeShellMenuOverlayV1Post', err);
    }
  }, [extensions, post]);

  // Sync open state with the Chrome Shell Menu Overlay
  useLayoutEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    (async () => {
      pendingOwnResetRef.current = true;
      try {
        await reset();
        await acquire();
        if (cancelled) {
          await release();
          return;
        }
        await syncMenuToOverlay();
      } catch (err) {
        console.error('ExtensionToolbar overlay open', err);
      } finally {
        pendingOwnResetRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      pendingOwnResetRef.current = false;
      if (leaseRevokedByResetRef.current) {
        leaseRevokedByResetRef.current = false;
        return;
      }
      void release();
    };
  }, [open, reset, acquire, release, syncMenuToOverlay]);

  // Update overlay content when extensions state updates while menu is open
  useEffect(() => {
    if (open) {
      void syncMenuToOverlay(extensions);
    }
  }, [extensions, open, syncMenuToOverlay]);

  // Listen for overlay dismiss or actions
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.(async (data) => {
      if (!openRef.current) return;
      const t = data?.type;
      if (t === 'dismiss') {
        setOpen(false);
      } else if (t === 'extensionToggle') {
        try {
          if (window.extensionAPI?.toggle) {
            await window.extensionAPI.toggle(data.extensionId);
            loadExtensions();
          }
        } catch (e) {
          console.error('Failed to toggle extension:', e);
        }
      } else if (t === 'extensionTogglePin') {
        try {
          if (window.extensionAPI?.togglePin) {
            await window.extensionAPI.togglePin(data.extensionId);
            loadExtensions();
          }
        } catch (e) {
          console.error('Failed to toggle extension pin:', e);
        }
      } else if (t === 'extensionActivate') {
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
            loadExtensions();
          }
        } catch (e) {
          console.error('Failed to uninstall extension:', e);
        }
      } else if (t === 'extensionNavigate') {
        setOpen(false);
        if (typeof onNavigate === 'function') {
          onNavigate(data.url);
        } else if (window.electronAPI?.createTab) {
          window.electronAPI.createTab({ url: data.url });
        }
      }
    });

    return typeof unsub === 'function' ? unsub : undefined;
  }, [loadExtensions, onNavigate]);

  // Handle overlay superseded
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (pendingOwnResetRef.current) return;
      if (!openRef.current) return;
      leaseRevokedByResetRef.current = true;
      setOpen(false);
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

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

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* Pinned Extension Action Icons on Toolbar (Max 5) */}
      {pinnedExtensions.map((ext) => {
        const badge = actionBadges[ext.id];
        const badgeText = badge?.badgeText || '';
        const badgeBg = badge?.badgeBgColor || '#4688F1';
        const badgeColor = badge?.badgeTextColor || '#FFFFFF';

        return (
          <button
            key={ext.id}
            className="btn"
            title={`${ext.name} (v${ext.version})`}
            style={{
              padding: '3px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              cursor: 'pointer',
              marginRight: '2px',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              position: 'relative',
            }}
            onClick={(e) => handleActionClick(e, ext)}
          >
            {ext.iconDataUrl ? (
              <img
                src={ext.iconDataUrl}
                alt={ext.name}
                style={{
                  width: '18px',
                  height: '18px',
                  objectFit: 'contain',
                  borderRadius: '3px',
                }}
              />
            ) : (
              <span style={{ fontSize: '15px', lineHeight: 1 }}>🧩</span>
            )}
            {badgeText ? (
              <span
                style={{
                  position: 'absolute',
                  bottom: '1px',
                  right: '1px',
                  backgroundColor: badgeBg,
                  color: badgeColor,
                  fontSize: '9px',
                  fontWeight: '700',
                  padding: '0 2.5px',
                  borderRadius: '3px',
                  lineHeight: '11px',
                  pointerEvents: 'none',
                  maxWidth: '18px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
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
        className={`btn ${open ? 'active' : ''}`}
        title="Extensions"
        aria-label="Extensions"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: '6px',
          cursor: 'pointer',
          border: 'none',
          background: open ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
          color: 'inherit',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.5 2.5 0 0 1 0 5H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.5 2.5 0 0 1 5 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" />
        </svg>
      </button>
    </div>
  );
}
