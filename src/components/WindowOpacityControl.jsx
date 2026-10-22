import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useWindowOpacity, MIN_OPACITY, MAX_OPACITY } from '../hooks/useWindowOpacity';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import { transparencySvg } from '../constants/appAssetUrls';
import AssetMaskIcon from './AssetMaskIcon.jsx';
import './WindowOpacityControl.css';

const TRANSPARENCY_ICON = <AssetMaskIcon icon={transparencySvg} size={16} />;

/**
 * WindowOpacityControl
 *
 * Eye-icon button in the toolbar that opens the Transparency Mode popup
 * inside chromeShellMenuOverlayView — the WebContentsView layer that sits
 * above all tab content, so the popup is never hidden behind a web page.
 *
 * Lifecycle mirrors ProfileMenuButton:
 *   reset() → acquire() → post(patch) → release() (on close / unmount)
 */
export default function WindowOpacityControl() {
  const { opacityPercent, setOpacity } = useWindowOpacity();
  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  const [open, setOpen] = useState(false);
  const openRef    = useRef(false);
  const btnRef     = useRef(null);
  /** True while our own reset() is in-flight — ignore superseded during that window. */
  const pendingResetRef  = useRef(false);
  /** Main process evicted our lease via reset; cleanup must NOT call release(). */
  const leaseRevokedRef  = useRef(false);
  /** True when setOpacity was called as a result of the overlay slider — skip re-posting. */
  const fromOverlayRef   = useRef(false);
  /** Timestamp (ms) of the last overlay-initiated dismiss — guards against backdrop+button double-fire. */
  const justClosedAtRef  = useRef(0);

  openRef.current = open;

  // ── Build the overlay patch ─────────────────────────────────────────────
  const buildPatch = useCallback(() => {
    const r = btnRef.current
      ? btnRef.current.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    return {
      kind: 'transparencyMenu',
      anchorRect: { left: r.left, top: r.top, width: r.width, height: r.height },
      opacityPercent,
    };
  }, [opacityPercent]);

  const postPatch = useCallback(async () => {
    try { await post(buildPatch()); } catch (_) {}
  }, [post, buildPatch]);

  // ── Open lifecycle: reset → acquire → post ──────────────────────────────
  useLayoutEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      pendingResetRef.current = true;
      try {
        await reset();
        await acquire();
        if (cancelled) { await release(); return; }
        await postPatch();
      } catch (err) {
        console.error('[WindowOpacityControl] overlay open:', err);
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

  // ── Re-post when opacity changes while open — but NOT if the change
  // came from the overlay slider itself (would rebuild the DOM mid-drag).
  useEffect(() => {
    if (!openRef.current) return;
    if (fromOverlayRef.current) {
      fromOverlayRef.current = false;
      return;
    }
    void postPatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacityPercent]);

  // Reposition on window resize if open so transparency popup follows trigger button
  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      void postPatch();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, postPatch]);

  // ── Handle events routed back from the overlay renderer ─────────────────
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (!openRef.current) return;
      const t = data?.type;

      if (t === 'dismiss') {
        justClosedAtRef.current = Date.now();
        setOpen(false);
        return;
      }
      if (t === 'transparencySetOpacity' && typeof data.opacity === 'number') {
        const safe = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, data.opacity));
        // Mark as overlay-originated so the re-post effect skips rebuilding the panel
        fromOverlayRef.current = true;
        setOpacity(safe);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Close when another overlay takes the surface ────────────────────────
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (openRef.current && !pendingResetRef.current) {
        leaseRevokedRef.current = true;
        setOpen(false);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  return (
    <div className="window-opacity-control">
      <button
        ref={btnRef}
        id="transparency-btn"
        className={`btn window-opacity-trigger${open ? ' window-opacity-trigger--active' : ''}`}
        title={`Transparency Mode — ${opacityPercent}%`}
        aria-label="Transparency Mode"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          // Guard: if the overlay backdrop just sent a dismiss (within 200ms),
          // this click is the tail of the same gesture — don't reopen.
          if (Date.now() - justClosedAtRef.current < 200) return;
          setOpen((prev) => !prev);
        }}
      >
        {TRANSPARENCY_ICON}
      </button>
    </div>
  );
}
