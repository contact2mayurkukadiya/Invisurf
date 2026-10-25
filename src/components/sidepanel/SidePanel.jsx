import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  setSidePanelOpen,
  setSidePanelWidth,
  setSidePanelActiveView,
  togglePinSidePanel,
  addTab,
} from '../../store/browserSlice';
import ReadingListPanel from './ReadingListPanel';
import BookmarksPanel from './BookmarksPanel';
import HistoryPanel from './HistoryPanel';
import LensPanel from './LensPanel';
import './SidePanel.css';

const PANELS = [
  {
    id: 'reading-list',
    title: 'Reading list',
    pageUrl: null,
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
      </svg>
    ),
  },
  {
    id: 'bookmarks',
    title: 'Bookmarks',
    pageUrl: 'invisurf://bookmarks',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    ),
  },
  {
    id: 'history',
    title: 'History',
    pageUrl: 'invisurf://history',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    ),
  },
  {
    id: 'lens',
    title: 'Google Lens',
    pageUrl: 'https://lens.google.com',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
      </svg>
    ),
  },
];

export default function SidePanel() {
  const dispatch = useDispatch();
  const sidePanelState = useSelector((s) => s.browser.sidePanel || {});
  const {
    isOpen = false,
    width = 360,
    activePanelId = 'reading-list',
    customUrl = null,
    pinnedPanelIds = [],
  } = sidePanelState;

  const [isDragging, setIsDragging] = useState(false);
  const [isMounted, setIsMounted] = useState(isOpen);
  const [animState, setAnimState] = useState(isOpen ? 'open' : 'closed');
  const isDraggingRef = useRef(false);
  const closeTimerRef = useRef(null);

  // Animated mounting lifecycle for smooth expand/shrink animations
  useEffect(() => {
    if (isOpen) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setIsMounted(true);
      setAnimState('entering');
      const frame = requestAnimationFrame(() => {
        setAnimState('open');
      });
      return () => cancelAnimationFrame(frame);
    } else {
      if (isMounted) {
        setAnimState('closing');
        closeTimerRef.current = setTimeout(() => {
          setIsMounted(false);
          setAnimState('closed');
        }, 180);
        return () => {
          if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
        };
      }
    }
  }, [isOpen]);

  // Sync state with Electron Main Process (skip during active drag resizing to avoid double IPC and relayout)
  useEffect(() => {
    if (isDraggingRef.current) return;
    if (window.electronAPI?.sidePanelSyncState) {
      window.electronAPI.sidePanelSyncState({
        isOpen,
        width,
        activePanelId,
        customUrl,
      });
    }
  }, [isOpen, width, activePanelId, customUrl]);

  // Window resize guard to keep left web view >= 360px
  useEffect(() => {
    const handleWindowResize = () => {
      const minW = 260;
      const maxW = Math.max(minW, window.innerWidth - 360);
      if (width > maxW) {
        dispatch(setSidePanelWidth(maxW));
        if (window.electronAPI?.sidePanelResize) {
          window.electronAPI.sidePanelResize(maxW);
        }
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [width, dispatch]);

  // Handle Drag Resizing: maximum sidebar width exactly matches left web content view's 360px minimum edge
  const handlePointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      setIsDragging(true);
      e.preventDefault();

      let rafId = null;
      let lastWidth = width;

      const onPointerMove = (moveEvent) => {
        if (!isDraggingRef.current) return;
        const mouseX = moveEvent.clientX;
        const rawWidth = window.innerWidth - mouseX;
        const minW = 260;
        const maxW = Math.max(minW, window.innerWidth - 360);
        const clamped = Math.max(minW, Math.min(rawWidth, maxW));

        if (clamped === lastWidth) return;
        lastWidth = clamped;

        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            dispatch(setSidePanelWidth(lastWidth));
            if (window.electronAPI?.sidePanelResize) {
              window.electronAPI.sidePanelResize(lastWidth);
            }
          });
        }
      };

      const onPointerUp = () => {
        isDraggingRef.current = false;
        setIsDragging(false);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (window.electronAPI?.sidePanelResize) {
          window.electronAPI.sidePanelResize(lastWidth);
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [dispatch, width]
  );

  if (!isMounted) return null;

  const currentPanel = PANELS.find((p) => p.id === activePanelId) || PANELS[0];
  const isPinned = Array.isArray(pinnedPanelIds) && pinnedPanelIds.includes(activePanelId);
  const targetUrl = customUrl || currentPanel.pageUrl;

  return (
    <>
      {/* Web content card frame backing (matching shadow & border around left web contents card) */}
      <div
        className={`web-content-card-frame${animState === 'closing' ? ' web-content-card-frame--closing' : ''}`}
        style={{ width: `calc(100vw - ${width}px - 14px)` }}
        aria-hidden="true"
      />

      <div
        className={`side-panel-container side-panel-container--${animState}${isDragging ? ' side-panel-resizer--active' : ''}`}
        style={{ width: `${width}px` }}
        aria-label="Side panel"
      >
        {/* Resizer Splitter on the left edge with hover indicator pill */}
        <div
          className={`side-panel-resizer${isDragging ? ' side-panel-resizer--active' : ''}`}
          onPointerDown={handlePointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={width}
          title="Drag to resize side panel"
        >
          <div className="side-panel-resizer-pill" />
        </div>

        {/* Side panel header - sits directly on shell surface background */}
        <div className="side-panel-header">
          <div className="side-panel-header-left">
            <span className="side-panel-header-title">{currentPanel.title}</span>
          </div>

          <div className="side-panel-header-actions">
            {/* Pinnable toggle button */}
            <button
              type="button"
              className={`side-panel-header-btn side-panel-pin-btn${isPinned ? ' pinned' : ''}`}
              onClick={() => dispatch(togglePinSidePanel(activePanelId))}
              title={isPinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
              aria-label={isPinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
              aria-pressed={isPinned}
            >
              {isPinned ? (
                /* Chrome Material Symbol: keep_off (pin with slash) */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 5.27 3.28 4 20 20.72 18.73 22l-5.73-5.73V22h-2v-5.73H5v-2c1.66 0 3-1.34 3-3v-.73L2 5.27zM16 9V4l1 0V2H7.27l7 7H16z" />
                </svg>
              ) : (
                /* Chrome Material Symbol: push_pin */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 9V4l1 0V2H7v2l1 0v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
                </svg>
              )}
            </button>

            {/* Open in new tab icon button (shown when dedicated pageUrl exists) */}
            {targetUrl && (
              <button
                type="button"
                className="side-panel-header-btn side-panel-open-tab-btn"
                onClick={() => {
                  const newTabId = 'tab-' + Date.now();
                  dispatch(addTab({ id: newTabId, isStealth: false, initialUrl: targetUrl }));
                  if (window.electronAPI?.newTab) {
                    window.electronAPI.newTab(newTabId, false, targetUrl);
                  } else if (window.electronAPI?.createTab) {
                    window.electronAPI.createTab({ id: newTabId, url: targetUrl });
                  }
                }}
                title={`Open ${currentPanel.title} in new tab`}
                aria-label={`Open ${currentPanel.title} in new tab`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                </svg>
              </button>
            )}

            {/* Close side panel button */}
            <button
              type="button"
              className="side-panel-header-btn side-panel-close-btn"
              onClick={() => {
                dispatch(setSidePanelOpen(false));
                if (activePanelId === 'lens' && window.electronAPI?.closeGoogleLens) {
                  window.electronAPI.closeGoogleLens();
                }
              }}
              title="Close side panel"
              aria-label="Close side panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Side panel body in a floating rounded card */}
        <div className="side-panel-card">
          <div className="side-panel-content-body">
            {activePanelId === 'reading-list' && <ReadingListPanel />}
            {activePanelId === 'bookmarks' && <BookmarksPanel />}
            {activePanelId === 'history' && <HistoryPanel />}
            {activePanelId === 'lens' && <LensPanel />}
          </div>
        </div>
      </div>
    </>
  );
}
