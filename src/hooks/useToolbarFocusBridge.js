import { useEffect } from 'react';

/**
 * useToolbarFocusBridge — provides bidirectional Tab / Shift+Tab keyboard focus
 * traversal across:
 *   Zone 1: Toolbar / Omnibox Row (.nav-bar)
 *   Zone 2: Bookmark Bar (.bookmark-bar)
 *   Zone 3: Active Web Content View (WebContentsView)
 *
 * Excludes Tab Strip (.tab-bar) from sequential Tab cycling, matching Google Chrome.
 */
export function useToolbarFocusBridge() {
  useEffect(() => {
    const FOCUSABLE_SELECTOR = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

    const getToolbarAndBookmarkFocusables = () => {
      const navBar = document.querySelector('.nav-bar');
      const bookmarkBar = document.querySelector('.bookmark-bar');

      const filterVisible = (el) => {
        if (!el || !el.isConnected || el.disabled || el.getAttribute('tabindex') === '-1') return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const navElements = navBar
        ? Array.from(navBar.querySelectorAll(FOCUSABLE_SELECTOR)).filter(filterVisible)
        : [];

      const bookmarkElements = bookmarkBar
        ? Array.from(bookmarkBar.querySelectorAll(FOCUSABLE_SELECTOR)).filter(filterVisible)
        : [];

      return {
        navElements,
        bookmarkElements,
        allElements: [...navElements, ...bookmarkElements],
      };
    };

    // 1. Listen for focus cycle event from guest WebContentsView
    const unsub = window.electronAPI?.onToolbarFocusCycle?.(({ direction }) => {
      const { allElements, navElements } = getToolbarAndBookmarkFocusables();
      if (allElements.length === 0) return;

      if (direction === 'forward') {
        // Came from bottom of web content view -> focus first item in toolbar row (#back-btn or #url-input)
        const target = navElements[0] || allElements[0];
        try { target?.focus(); } catch (_) {}
      } else {
        // Came from top of web content view (Shift+Tab) -> focus last item in bookmark bar (or toolbar)
        const target = allElements[allElements.length - 1];
        try { target?.focus(); } catch (_) {}
      }
    });

    // 2. Listen for Tab / Shift+Tab when focus is currently inside the shell toolbar/bookmarks
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

      const { allElements, navElements } = getToolbarAndBookmarkFocusables();
      if (allElements.length === 0) return;

      const active = document.activeElement;
      if (!active) return;

      const firstEl = allElements[0];
      const lastEl = allElements[allElements.length - 1];

      if (!e.shiftKey) {
        // Forward Tab on the very last element of bookmarks/toolbar -> move focus INTO active web content view
        if (active === lastEl) {
          e.preventDefault();
          window.electronAPI?.focusActiveTabView?.({ direction: 'forward' });
        }
      } else {
        // Backward Shift+Tab on the very first element of toolbar (#back-btn) -> move focus BACKWARD into active web content view
        if (active === firstEl || active === navElements[0]) {
          e.preventDefault();
          window.electronAPI?.focusActiveTabView?.({ direction: 'backward' });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      if (typeof unsub === 'function') unsub();
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
}
