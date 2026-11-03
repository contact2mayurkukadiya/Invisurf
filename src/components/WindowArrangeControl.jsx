import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import { SHORTCUT_DEFINITIONS } from '../constants/settings';
import { formatShortcutForDisplay } from '../utils/shortcutUtils';
import './WindowArrangeControl.css';

const ARRANGE_CATEGORY = SHORTCUT_DEFINITIONS.find((cat) => cat.category === 'Window Arrangement');
const ARRANGE_ITEMS = ARRANGE_CATEGORY ? ARRANGE_CATEGORY.items : [];

export default function WindowArrangeControl() {
  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  const [open, setOpen] = useState(false);
  const [currentShortcuts, setCurrentShortcuts] = useState({});
  const openRef = useRef(false);
  const btnRef = useRef(null);
  const pendingResetRef = useRef(false);
  const leaseRevokedRef = useRef(false);
  const justClosedAtRef = useRef(0);

  openRef.current = open;

  // Load configured shortcuts from settings
  const loadShortcuts = useCallback(async () => {
    try {
      if (window.electronAPI?.settingsGet) {
        const s = await window.electronAPI.settingsGet();
        if (s?.shortcuts) {
          setCurrentShortcuts(s.shortcuts);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadShortcuts();
    const unsub = window.electronAPI?.onSettingsUpdated?.((updated) => {
      if (updated?.shortcuts) {
        setCurrentShortcuts(updated.shortcuts);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [loadShortcuts]);

  // Build the overlay patch
  const buildPatch = useCallback(() => {
    const r = btnRef.current
      ? btnRef.current.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };

    const formattedShortcuts = {};
    for (const item of ARRANGE_ITEMS) {
      const raw = currentShortcuts[item.id] || item.defaultShortcut;
      formattedShortcuts[item.id] = formatShortcutForDisplay(raw, { compact: true, triangles: true });
    }

    return {
      kind: 'windowArrangeMenu',
      anchorRect: { left: r.left, top: r.top, width: r.width, height: r.height },
      shortcuts: formattedShortcuts,
      width: 260,
    };
  }, [currentShortcuts]);

  const postPatch = useCallback(async () => {
    try {
      await post(buildPatch());
    } catch (_) {}
  }, [post, buildPatch]);

  // Open lifecycle: reset -> acquire -> post
  useLayoutEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      pendingResetRef.current = true;
      try {
        await reset();
        await acquire();
        if (cancelled) {
          await release();
          return;
        }
        await postPatch();
      } catch (err) {
        console.error('[WindowArrangeControl] overlay open:', err);
      } finally {
        pendingResetRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
      pendingResetRef.current = false;
      if (leaseRevokedRef.current) {
        leaseRevokedRef.current = false;
        return;
      }
      void release();
    };
  }, [open, reset, acquire, release, postPatch]);

  // Reposition on window resize if open
  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      void postPatch();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, postPatch]);

  // Handle events from overlay
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (!openRef.current) return;
      const t = data?.type;
      if (t === 'dismiss' || t === 'windowArrange') {
        justClosedAtRef.current = Date.now();
        setOpen(false);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Handle overlay superseded
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (openRef.current && !pendingResetRef.current) {
        leaseRevokedRef.current = true;
        setOpen(false);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  return (
    <div className="window-arrange-control">
      <button
        ref={btnRef}
        id="window-arrange-btn"
        className={`btn window-arrange-trigger${open ? ' window-arrange-trigger--active' : ''}`}
        title="Arrange Window"
        aria-label="Arrange Window"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (Date.now() - justClosedAtRef.current < 200) return;
          setOpen((prev) => !prev);
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
          <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v7A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 3h-11zm0 1.2h4.9v7.6H2.5a.3.3 0 0 1-.3-.3v-7c0-.17.13-.3.3-.3zm6.1 0h4.9c.17 0 .3.13.3.3v7a.3.3 0 0 1-.3.3H8.6V4.2z" />
        </svg>
      </button>
    </div>
  );
}

