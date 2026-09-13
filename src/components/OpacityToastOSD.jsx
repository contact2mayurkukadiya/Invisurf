import React, { useState, useEffect, useRef } from 'react';
import './OpacityToastOSD.css';

export default function OpacityToastOSD() {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(100);
  const hideTimerRef = useRef(null);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onWindowOpacityChanged?.((data) => {
      // Avoid flashing on initial mount
      if (isFirstMountRef.current) {
        isFirstMountRef.current = false;
        return;
      }
      if (data && typeof data.opacity === 'number') {
        const pct = Math.round(data.opacity * 100);
        setPercent(pct);
        setVisible(true);

        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setVisible(false);
        }, 1600);
      }
    });

    // Mark initial mount as settled after 500ms so subsequent changes show OSD
    const mountTimer = setTimeout(() => {
      isFirstMountRef.current = false;
    }, 500);

    return () => {
      clearTimeout(mountTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="opacity-toast-osd" role="status" aria-live="polite">
      <div className="opacity-toast-osd__content">
        <span className="opacity-toast-osd__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
        </span>
        <span className="opacity-toast-osd__label">Transparency Mode</span>
        <span className="opacity-toast-osd__value">{percent}%</span>
      </div>
      <div className="opacity-toast-osd__bar-track">
        <div
          className="opacity-toast-osd__bar-fill"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}
