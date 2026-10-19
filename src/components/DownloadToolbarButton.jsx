import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import AssetMaskIcon from './AssetMaskIcon.jsx';
import { menuDownloadsSvg } from '../constants/appAssetUrls.js';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext.jsx';

export default function DownloadToolbarButton({ onOpenDownloads }) {
  const [activeDownloads, setActiveDownloads] = useState([]);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const buttonRef = useRef(null);

  /** True while our own reset() is in-flight — ignore superseded during that window. */
  const pendingResetRef = useRef(false);
  /** Main process evicted our lease via reset; cleanup must NOT call release(). */
  const leaseRevokedRef = useRef(false);
  /** Timestamp (ms) of the last overlay-initiated dismiss — guards against backdrop+button double-fire. */
  const justClosedAtRef = useRef(0);

  openRef.current = open;

  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  // Load initial downloads and subscribe to live download IPC events
  useEffect(() => {
    let mounted = true;
    window.electronAPI?.downloadsGetAll?.().then((data) => {
      if (!mounted) return;
      if (Array.isArray(data?.active)) {
        setActiveDownloads(data.active);
      }
    }).catch(() => {});

    const unsubStarted = window.electronAPI?.onDownloadStarted?.((record) => {
      setActiveDownloads((prev) => [record, ...prev.filter((d) => d.id !== record.id)]);

      // Trigger native overlay attention animation directly on top of all web content
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        window.electronAPI?.downloadsShowAttention?.({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }
    });

    const unsubProgress = window.electronAPI?.onDownloadProgress?.((record) => {
      setActiveDownloads((prev) =>
        prev.map((d) => (d.id === record.id ? { ...d, ...record } : d))
      );
    });

    const unsubDone = window.electronAPI?.onDownloadDone?.((record) => {
      setActiveDownloads((prev) => prev.filter((d) => d.id !== record.id));
    });

    const unsubUpdated = window.electronAPI?.onDownloadUpdated?.(() => {
      window.electronAPI?.downloadsGetAll?.().then((data) => {
        if (!mounted) return;
        if (Array.isArray(data?.active)) {
          setActiveDownloads(data.active);
        }
      }).catch(() => {});
    });

    return () => {
      mounted = false;
      if (typeof unsubStarted === 'function') unsubStarted();
      if (typeof unsubProgress === 'function') unsubProgress();
      if (typeof unsubDone === 'function') unsubDone();
      if (typeof unsubUpdated === 'function') unsubUpdated();
    };
  }, []);

  const postPatch = useCallback(async () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    try {
      const data = await window.electronAPI?.downloadsGetAll?.();
      await post({
        kind: 'downloadPanel',
        anchorRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : {},
        active: Array.isArray(data?.active) ? data.active : [],
        history: Array.isArray(data?.history) ? data.history : [],
      });
    } catch (_) {}
  }, [post]);

  // ── Open lifecycle: reset → acquire → post ──────────────────────────────
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
        console.error('[DownloadToolbarButton] overlay open:', err);
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

  // Keep the overlay popup synchronized with live download progress
  useEffect(() => {
    if (!openRef.current) return;
    void postPatch();
  }, [activeDownloads, postPatch]);

  // ── Handle events routed back from the overlay renderer ─────────────────
  useEffect(() => {
    const unsubHost = window.electronAPI?.onChromeOverlayV1HostEvent?.(async (data) => {
      if (!openRef.current) return;
      const t = data?.type;

      if (t === 'dismiss') {
        justClosedAtRef.current = Date.now();
        setOpen(false);
        return;
      }

      if (t === 'openDownloadsPage') {
        justClosedAtRef.current = Date.now();
        setOpen(false);
        if (typeof onOpenDownloads === 'function') {
          onOpenDownloads();
        }
        return;
      }

      if (t === 'downloadAction') {
        if (data.action === 'pause') {
          await window.electronAPI?.downloadsPause?.(data.id);
        } else if (data.action === 'resume') {
          await window.electronAPI?.downloadsResume?.(data.id);
        } else if (data.action === 'cancel') {
          await window.electronAPI?.downloadsCancel?.(data.id);
        } else if (data.action === 'retry') {
          await window.electronAPI?.downloadsRetry?.(data.id);
        } else if (data.action === 'showInFolder') {
          await window.electronAPI?.downloadsShowInFolder?.(data.savePath);
        } else if (data.action === 'openFile') {
          justClosedAtRef.current = Date.now();
          setOpen(false);
          await window.electronAPI?.downloadsOpenFile?.(data.savePath);
        }
      }
    });

    return () => {
      if (typeof unsubHost === 'function') unsubHost();
    };
  }, [onOpenDownloads]);

  // ── Close when another overlay takes the surface ────────────────────────
  useEffect(() => {
    const unsubSuperseded = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (openRef.current && !pendingResetRef.current) {
        leaseRevokedRef.current = true;
        setOpen(false);
      }
    });

    return () => {
      if (typeof unsubSuperseded === 'function') unsubSuperseded();
    };
  }, []);

  // ── Dismiss popup when clicking anywhere outside the button in browser chrome ──
  useEffect(() => {
    if (!open) return undefined;

    const handleOutsidePointer = (e) => {
      if (buttonRef.current && buttonRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer, true);
    };
  }, [open]);

  const isDownloading = activeDownloads.length > 0;
  const isPaused = isDownloading && activeDownloads.some((d) => d.state === 'paused');

  // Calculate aggregated progress percentage
  let totalReceived = 0;
  let totalExpected = 0;
  if (isDownloading) {
    for (const item of activeDownloads) {
      totalReceived += Number(item.receivedBytes) || 0;
      totalExpected += Number(item.totalBytes) || 0;
    }
  }

  // The 3 spinning sections are ONLY for the loading state (URL connecting / 0 bytes received yet)
  const isStarted = totalReceived > 0;
  const isLoading = isDownloading && !isStarted;
  const hasKnownTotal = totalExpected > 0;

  // Circular progress metrics: viewBox 32x32, center (16,16), radius 14.25
  const RADIUS = 14.25;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~89.535

  let progressPercent = 0;
  let strokeDashoffset = CIRCUMFERENCE;

  if (isStarted) {
    if (hasKnownTotal) {
      const rawRatio = Math.min(1, Math.max(0, totalReceived / totalExpected));
      progressPercent = Math.min(100, Math.round(rawRatio * 100));
      // Give a tiny minimum visual arc (3%) as soon as bytes arrive so progress is immediately visible
      const visualPercent = Math.min(100, Math.max(3, rawRatio * 100));
      strokeDashoffset = CIRCUMFERENCE - (visualPercent / 100) * CIRCUMFERENCE;
    } else {
      progressPercent = 0;
      strokeDashoffset = 0;
    }
  }

  const tooltipText = isDownloading
    ? (isPaused
        ? `Downloads paused (${progressPercent}%) - Click to view`
        : (isLoading
            ? 'Starting download...'
            : (hasKnownTotal
                ? `Downloading (${progressPercent}%) - Click to view`
                : 'Downloading - Click to view')))
    : 'Downloads';

  const handleClick = useCallback(() => {
    // Guard: if the overlay backdrop just sent a dismiss (within 200ms),
    // this click is the tail of the same gesture — don't reopen.
    if (Date.now() - justClosedAtRef.current < 200) return;
    setOpen((prev) => !prev);
  }, []);

  return (
    <div className="download-btn-container">
      <button
        id="downloads-btn"
        ref={buttonRef}
        type="button"
        className={`btn download-btn ${isDownloading ? 'is-downloading' : ''} ${isPaused ? 'is-paused' : ''}`}
        title={tooltipText}
        aria-label={tooltipText}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={handleClick}
      >
        {isDownloading ? (
          <div className="download-progress-ring-wrapper">
            <svg
              className={`download-progress-ring ${isLoading ? 'is-loading' : ''} ${isStarted && !hasKnownTotal ? 'is-streaming' : ''} ${isPaused ? 'is-paused' : ''}`}
              viewBox="0 0 32 32"
              width="30"
              height="30"
            >
              <circle
                className="ring-bg"
                cx="16"
                cy="16"
                r={RADIUS}
                fill="none"
                strokeWidth="2"
              />
              <circle
                className="ring-bar"
                cx="16"
                cy="16"
                r={RADIUS}
                fill="none"
                strokeWidth="2.5"
                strokeDasharray={
                  isLoading
                    ? '14.9 14.9'
                    : (isStarted && !hasKnownTotal ? '24 65.5' : CIRCUMFERENCE)
                }
                strokeDashoffset={isLoading ? 0 : strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 16 16)"
              />
            </svg>
            <div className={`download-icon-centered ${isPaused ? 'is-paused' : ''}`}>
              <AssetMaskIcon icon={menuDownloadsSvg} size={14} />
            </div>
          </div>
        ) : (
          <AssetMaskIcon icon={menuDownloadsSvg} size={15} />
        )}
      </button>
    </div>
  );
}
