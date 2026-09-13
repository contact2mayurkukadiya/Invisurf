import { useState, useEffect, useCallback, useRef } from 'react';

export const TRANSPARENCY_BREAKPOINTS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];

export const TRANSPARENCY_PRESETS = [
  { step: 1, value: 0.10, label: '10%', name: 'Minimal' },
  { step: 2, value: 0.20, label: '20%', name: 'Very Low' },
  { step: 3, value: 0.30, label: '30%', name: 'Low' },
  { step: 4, value: 0.40, label: '40%', name: 'Sub-Medium' },
  { step: 5, value: 0.50, label: '50%', name: 'Medium' },
  { step: 6, value: 0.60, label: '60%', name: 'High-Medium' },
  { step: 7, value: 0.70, label: '70%', name: 'Semi-Solid' },
  { step: 8, value: 0.80, label: '80%', name: 'High' },
  { step: 9, value: 0.90, label: '90%', name: 'Very High' },
  { step: 10, value: 1.00, label: '100%', name: 'Solid' },
];

export const MIN_OPACITY = 0.02;
export const MAX_OPACITY = 1.00;

export function useWindowOpacity() {
  const [opacity, setOpacityState] = useState(1.0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (window.electronAPI?.windowGetOpacity) {
      window.electronAPI.windowGetOpacity().then((current) => {
        if (isMountedRef.current && typeof current === 'number') {
          setOpacityState(Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, current)));
        }
      }).catch(() => {});
    }

    const unsubscribe = window.electronAPI?.onWindowOpacityChanged?.((data) => {
      if (isMountedRef.current && data && typeof data.opacity === 'number') {
        const safe = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, data.opacity));
        setOpacityState(safe);
      }
    });

    return () => {
      isMountedRef.current = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const setOpacity = useCallback(async (val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    const safe = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, isNaN(num) ? 1.0 : num));
    const rounded = Math.round(safe * 100) / 100;
    setOpacityState(rounded);
    if (window.electronAPI?.windowSetOpacity) {
      try {
        await window.electronAPI.windowSetOpacity(rounded);
      } catch (e) {
        console.error('Failed to set opacity:', e);
      }
    }
  }, []);

  const setPreset = useCallback((step) => {
    const preset = TRANSPARENCY_PRESETS.find((p) => p.step === step);
    if (preset) {
      setOpacity(preset.value);
    }
  }, [setOpacity]);

  const jumpNextBreakpoint = useCallback(() => {
    setOpacity((prev) => {
      const cur = Math.round(prev * 100) / 100;
      const next = TRANSPARENCY_BREAKPOINTS.find((bp) => bp >= cur + 0.05);
      return next !== undefined ? next : 1.00;
    });
  }, [setOpacity]);

  const jumpPrevBreakpoint = useCallback(() => {
    setOpacity((prev) => {
      const cur = Math.round(prev * 100) / 100;
      const reversed = [...TRANSPARENCY_BREAKPOINTS].reverse();
      const next = reversed.find((bp) => bp <= cur - 0.05);
      return next !== undefined ? next : 0.10;
    });
  }, [setOpacity]);

  const adjustOpacity = useCallback((delta) => {
    setOpacity((prev) => Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, prev + delta)));
  }, [setOpacity]);

  return {
    opacity,
    opacityPercent: Math.round(opacity * 100),
    setOpacity,
    setPreset,
    jumpNextBreakpoint,
    jumpPrevBreakpoint,
    adjustOpacity,
    presets: TRANSPARENCY_PRESETS,
    breakpoints: TRANSPARENCY_BREAKPOINTS,
    minOpacity: MIN_OPACITY,
    maxOpacity: MAX_OPACITY,
  };
}
