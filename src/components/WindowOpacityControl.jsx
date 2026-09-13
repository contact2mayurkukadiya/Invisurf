import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWindowOpacity, TRANSPARENCY_PRESETS, MIN_OPACITY, MAX_OPACITY } from '../hooks/useWindowOpacity';
import { useTabOverlay } from '../context/TabOverlayContext';
import { transparencySvg } from '../constants/appAssetUrls';
import AssetMaskIcon from './AssetMaskIcon.jsx';
import './WindowOpacityControl.css';

const TRANSPARENCY_ICON = <AssetMaskIcon icon={transparencySvg} size={16} />;

export default function WindowOpacityControl() {
  const { opacity, opacityPercent, setOpacity, setPreset, presets, jumpNextBreakpoint, jumpPrevBreakpoint } = useWindowOpacity();
  const { beginOverlay, endOverlay } = useTabOverlay();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const sliderRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  // Use TabOverlay so the popover can float down over WebContentsView
  useEffect(() => {
    if (open) {
      void beginOverlay();
    } else {
      endOverlay();
    }
    return () => {
      if (open) endOverlay();
    };
  }, [open, beginOverlay, endOverlay]);

  // Click outside and Escape key listeners
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        close();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  const handleSliderChange = (e) => {
    const val = Number(e.target.value) / 100;
    setOpacity(val);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const modifierKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className="window-opacity-control" ref={containerRef}>
      <button
        id="transparency-btn"
        className={`btn window-opacity-trigger${open ? ' window-opacity-trigger--active' : ''}`}
        title={`Transparency Mode (${opacityPercent}%)`}
        aria-label="Transparency Mode"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {TRANSPARENCY_ICON}
      </button>

      {open && (
        <div
          className="window-opacity-popover"
          role="dialog"
          aria-label="Window Transparency Controls"
        >
          <div className="window-opacity-popover__header">
            <div className="window-opacity-popover__title-wrap">
              <span className="window-opacity-popover__title">Transparency Mode</span>
            </div>
            <span className="window-opacity-popover__percent">{opacityPercent}%</span>
          </div>

          <div className="window-opacity-popover__slider-row">
            <button
              type="button"
              className="window-opacity-step-btn"
              onClick={jumpPrevBreakpoint}
              title="Previous Breakpoint (-10%)"
              aria-label="Previous Breakpoint"
            >
              −
            </button>
            <input
              ref={sliderRef}
              type="range"
              min="2"
              max="100"
              step="1"
              value={opacityPercent}
              onChange={handleSliderChange}
              className="window-opacity-slider"
              aria-label="Adjust window opacity"
              style={{
                '--slider-fill': `${Math.max(2, Math.min(100, opacityPercent))}%`,
              }}
            />
            <button
              type="button"
              className="window-opacity-step-btn"
              onClick={jumpNextBreakpoint}
              title="Next Breakpoint (+10%)"
              aria-label="Next Breakpoint"
            >
              +
            </button>
          </div>

          <div className="window-opacity-presets" role="radiogroup" aria-label="Quick Presets">
            {presets.map((p) => {
              const active = Math.abs(opacity - p.value) < 0.04;
              return (
                <button
                  key={p.step}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`window-opacity-preset-btn${active ? ' window-opacity-preset-btn--active' : ''}`}
                  onClick={() => setPreset(p.step)}
                  title={`Preset ${p.step}: ${p.label} (${p.name})`}
                >
                  <span className="window-opacity-preset-num">{p.step}</span>
                  <span className="window-opacity-preset-label">{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="window-opacity-popover__footer">
            <div className="window-opacity-shortcut-item">
              <kbd>{modifierKey}+Shift++ / -</kbd>
              <span>Next / Prev Breakpoint</span>
            </div>
            <div className="window-opacity-shortcut-item">
              <kbd>{modifierKey}+Alt+H</kbd>
              <span>Boss Key</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
