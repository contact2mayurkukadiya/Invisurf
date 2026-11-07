import { useEffect } from 'react';

/**
 * useGhostTitleBarInteractivity — allows the entire title bar / header of a Ghost
 * Window to remain clickable and draggable even when click-through mode is active.
 * When the cursor is over the header, mouse events are captured so the user can
 * click the Ghost badge to toggle click-through off or drag the window. When the
 * cursor leaves the header, clicks pass through to whatever is underneath.
 */
export function useGhostTitleBarInteractivity(isGhostWindow) {
  useEffect(() => {
    if (!isGhostWindow) return;

    let isHoveringHeader = false;
    let isClickThroughActive = false;
    let suppressNextHoverUntilLeave = false;

    window.electronAPI?.ghostGetClickThrough?.().then((val) => {
      isClickThroughActive = !!val;
    }).catch(() => {});

    const unsubClickThrough = window.electronAPI?.onGhostClickThroughChanged?.((data) => {
      const nextActive = !!data?.isClickThrough;
      const wasActive = isClickThroughActive;
      isClickThroughActive = nextActive;

      if (nextActive && !wasActive) {
        // When click-through is enabled (e.g. via titlebar chip click),
        // the cursor is directly on the chip. Suppress capturing mouse events
        // so the window immediately allows click-through until the cursor leaves header.
        suppressNextHoverUntilLeave = true;
        isHoveringHeader = false;
        window.electronAPI?.ghostSetIgnoreMouseEvents?.(true, { forward: true });
      } else if (!nextActive) {
        suppressNextHoverUntilLeave = false;
        isHoveringHeader = false;
        window.electronAPI?.ghostSetIgnoreMouseEvents?.(false);
      }
    });

    const header = document.querySelector('.header');

    const handleHeaderEnter = () => {
      if (!isClickThroughActive) return;
      if (suppressNextHoverUntilLeave) return;
      if (!isHoveringHeader) {
        isHoveringHeader = true;
        window.electronAPI?.ghostSetIgnoreMouseEvents?.(false);
      }
    };

    const handleHeaderLeave = () => {
      suppressNextHoverUntilLeave = false;
      if (!isClickThroughActive) return;
      if (isHoveringHeader) {
        isHoveringHeader = false;
        window.electronAPI?.ghostSetIgnoreMouseEvents?.(true, { forward: true });
      }
    };

    const handleMouseMove = (e) => {
      if (!isClickThroughActive) return;
      if (!header) return;

      const rect = header.getBoundingClientRect();
      const inHeader = e.clientY >= rect.top && e.clientY <= rect.bottom && e.clientX >= rect.left && e.clientX <= rect.right;

      if (inHeader) {
        if (!suppressNextHoverUntilLeave && !isHoveringHeader) {
          isHoveringHeader = true;
          window.electronAPI?.ghostSetIgnoreMouseEvents?.(false);
        }
      } else {
        suppressNextHoverUntilLeave = false;
        if (isHoveringHeader) {
          isHoveringHeader = false;
          window.electronAPI?.ghostSetIgnoreMouseEvents?.(true, { forward: true });
        }
      }
    };

    if (header) {
      header.addEventListener('mouseenter', handleHeaderEnter);
      header.addEventListener('mouseleave', handleHeaderLeave);
    }
    window.addEventListener('mouseleave', handleHeaderLeave);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      if (typeof unsubClickThrough === 'function') unsubClickThrough();
      if (header) {
        header.removeEventListener('mouseenter', handleHeaderEnter);
        header.removeEventListener('mouseleave', handleHeaderLeave);
      }
      window.removeEventListener('mouseleave', handleHeaderLeave);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isGhostWindow]);
}
