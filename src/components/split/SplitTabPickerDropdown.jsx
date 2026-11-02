import React, { useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { swapSplitSides } from '../../store/browserSlice';
import './SplitTabPickerDropdown.css';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

export default function SplitTabPickerDropdown({
  isOpen,
  onClose,
  anchorRef,
}) {
  const dispatch = useDispatch();
  const dropdownRef = useRef(null);
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const tabOrder = useSelector((s) => s.browser.tabOrder);
  const tabs = useSelector((s) => s.browser.tabs);
  const splitGroups = useSelector((s) => s.browser.splitGroups);

  const currentTab = currentTabId ? tabs[currentTabId] : null;
  const splitPair = Object.values(splitGroups || {}).find(
    (p) => p.leftTabId === currentTabId || p.rightTabId === currentTabId
  ) || null;

  // Close on outside click or Esc
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    const handlePointerDown = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          (!anchorRef?.current || !anchorRef.current.contains(e.target))) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const handlePairWithTab = (targetTabId) => {
    onClose();
    if (currentTabId && window.electronAPI?.splitTabEnter) {
      window.electronAPI.splitTabEnter(currentTabId, targetTabId);
    }
  };

  const handleSplitWithNewTab = () => {
    onClose();
    if (currentTabId && window.electronAPI?.splitTabEnter) {
      window.electronAPI.splitTabEnter(currentTabId, 'choose-tab');
    }
  };

  const handleSwapSides = () => {
    onClose();
    if (splitPair && window.electronAPI?.splitTabSwapSides) {
      dispatch(swapSplitSides(splitPair.id));
      window.electronAPI.splitTabSwapSides(splitPair.id);
    }
  };

  const handleSeparate = () => {
    onClose();
    const sid = splitPair?.id || (currentTabId && tabs[currentTabId]?.splitPairId) || currentTabId;
    if (sid && window.electronAPI?.splitTabExit) {
      window.electronAPI.splitTabExit(sid);
    }
  };

  const handleCloseActiveSide = () => {
    onClose();
    const sid = splitPair?.id || (currentTabId && tabs[currentTabId]?.splitPairId) || currentTabId;
    if (sid && window.electronAPI?.splitTabExit) {
      window.electronAPI.splitTabExit(sid, { closeOtherSide: true });
    }
  };

  // If already in split view, render active split management menu
  if (splitPair) {
    return (
      <div ref={dropdownRef} className="split-picker-dropdown">
        <div className="split-picker-header">Split Screen Controls</div>
        <button type="button" className="split-picker-item" onClick={handleSwapSides}>
          <svg className="split-picker-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.5 2.5a.5.5 0 0 0-.5.5v2.5H2a.5.5 0 0 0 0 1h2V9a.5.5 0 0 0 .854.354l2.5-2.5a.5.5 0 0 0 0-.708l-2.5-2.5A.5.5 0 0 0 4.5 2.5zm7 11a.5.5 0 0 0 .5-.5V10.5H14a.5.5 0 0 0 0-1h-2V7a.5.5 0 0 0-.854-.354l-2.5 2.5a.5.5 0 0 0 0 .708l2.5 2.5a.5.5 0 0 0 .854.146z" />
          </svg>
          <span className="split-picker-item-label">Switch sides</span>
        </button>
        <button type="button" className="split-picker-item" onClick={handleSeparate}>
          <svg className="split-picker-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V3z" />
          </svg>
          <span className="split-picker-item-label">Separate tabs</span>
        </button>
        <div className="split-picker-separator" />
        <button type="button" className="split-picker-item split-picker-item--danger" onClick={handleCloseActiveSide}>
          <svg className="split-picker-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
          </svg>
          <span className="split-picker-item-label">Close active split tab</span>
        </button>
      </div>
    );
  }

  // Filter available tabs: exclude current tab and any tab currently in another split
  const availableTabs = tabOrder
    .filter((id) => id !== currentTabId && !tabs[id]?.splitPairId)
    .map((id) => ({ id, ...tabs[id] }));

  return (
    <div ref={dropdownRef} className="split-picker-dropdown">
      <div className="split-picker-header">Split Screen with</div>

      {availableTabs.length > 0 && (
        <div className="split-picker-list">
          {availableTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="split-picker-item"
              onClick={() => handlePairWithTab(t.id)}
            >
              <img
                src={t.favicon || DEFAULT_FAVICON}
                className="split-picker-favicon"
                alt=""
                onError={(e) => { e.target.src = DEFAULT_FAVICON; }}
              />
              <span className="split-picker-item-title">{t.title || 'Tab'}</span>
            </button>
          ))}
        </div>
      )}

      {availableTabs.length > 0 && <div className="split-picker-separator" />}

      {/* New Tab Option */}
      <button
        type="button"
        className="split-picker-item split-picker-item--primary"
        onClick={handleSplitWithNewTab}
      >
        <svg className="split-picker-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z" />
        </svg>
        <span className="split-picker-item-label">New Tab</span>
      </button>
    </div>
  );
}
