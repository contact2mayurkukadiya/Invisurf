import React, { useCallback } from 'react';
import { useTabDrag } from '../hooks/useTabDrag';
import { useInvsurfLogoFaviconUrl } from '../hooks/useInvsurfLogoFavicon';
import { isInvsurfBrandedInternalTab } from '../utils/invisurfInternalPages';
import { logoIcognitoDarkSvg, tabCloseSvg } from '../constants/appAssetUrls';
import TabGroupBorder from './tabgroup/TabGroupBorder';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

export default function Tab({
  id, tab, isActive,
  onClose, onSwitch, onDragEnd,
  onHoverEnter, onHoverLeave, onHideTooltip,
  onContextMenu,
  displayMode = 'full',
  pinnedTabCount = 0,
  tabCount = 1,
  onDetachTab,
  onGetFallbackTabId,
  captureRole = null,
  groupColor = null,
  isFirstInGroup = false,
  isLastInGroup = false,
  prevTabIsActiveInGroup = false,
  nextTabIsActiveInGroup = false,
  isCollapsedMember = false,
}) {
  const { url, title, favicon, isNewTab, isStealth, isLoading, isPinned } = tab || {};
  const invsurfLogoFavicon = useInvsurfLogoFaviconUrl();

  const handleSwitchTab = useCallback((tabId) => onSwitch(tabId), [onSwitch]);
  const handleDragEnd = useCallback((ids, details) => onDragEnd(ids, details), [onDragEnd]);

  const tabRef = useTabDrag({
    id,
    tab,
    onSwitchTab: handleSwitchTab,
    onDragEnd: handleDragEnd,
    onHideTooltip,
    isPinned: !!isPinned,
    pinnedTabCount,
    isActive,
    tabCount,
    onDetachTab,
    onGetFallbackTabId,
  });

  // Resolve favicon to display
  const resolvedFavicon = (() => {
    if (isLoading) return null;
    if (isStealth) return logoIcognitoDarkSvg;
    if (isInvsurfBrandedInternalTab(tab)) return invsurfLogoFavicon;
    if (favicon) return favicon;
    if (url && url.includes('google.com')) return 'https://www.google.com/favicon.ico';
    return DEFAULT_FAVICON;
  })();

  const handleClose = (e) => {
    e.stopPropagation();
    onHideTooltip();
    onClose();
  };

  const handleHoverEnter = () => {
    if (tabRef.current) onHoverEnter(id, tabRef.current);
  };

  // Middle-click closes on release, matching Chrome's wheel-button behavior.
  const handleMouseDown = (e) => {
    if (e.button === 1) e.preventDefault();
  };

  const handleMouseUp = (e) => {
    if (e.button === 1) { e.preventDefault(); onHideTooltip(); onClose(); }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    onHideTooltip();
    if (onContextMenu) onContextMenu(e, id);
  };

  const className = [
    'tab',
    isActive ? 'active' : '',
    isStealth ? 'stealth-tab' : '',
    isPinned ? 'tab--pinned' : '',
    groupColor ? 'tab--in-group' : '',
    groupColor && isFirstInGroup ? 'tab--group-first' : '',
    groupColor && isLastInGroup ? 'tab--group-last' : '',
    isCollapsedMember ? 'tab--collapsed-member' : '',
    `tab--mode-${displayMode}`,
    captureRole ? 'tab--has-capture-indicator' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      ref={tabRef}
      className={className}
      data-tab-id={id}
      data-group-id={tab?.groupId || undefined}
      style={groupColor ? { '--group-color': groupColor } : undefined}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Tab Group Chrome-parity connected border / baseline */}
      <TabGroupBorder
        groupColor={groupColor}
        isActive={isActive}
        isFirstInGroup={isFirstInGroup}
        isLastInGroup={isLastInGroup}
        prevTabIsActiveInGroup={prevTabIsActiveInGroup}
        nextTabIsActiveInGroup={nextTabIsActiveInGroup}
      />
      {/* Icon / Spinner */}
      <div className="icon-container">
        {isLoading
          ? <div className="spinner" />
          : <img src={resolvedFavicon} className="tab-icon" alt="" onError={e => { e.target.src = DEFAULT_FAVICON; }} />
        }
      </div>

      {/* Title */}
      <div className="tab-title">
        {title || 'New Tab'}
      </div>

      {/* Screen Share / Tab Capture Indicator */}
      {captureRole && (
        <div
          className={`tab-capture-indicator tab-capture-indicator--${captureRole}`}
          title={captureRole === 'captured' ? 'This tab is being shared' : 'This tab is sharing a screen'}
          aria-label={captureRole === 'captured' ? 'Sharing tab' : 'Meeting sharing screen'}
        >
          {captureRole === 'captured' ? (
            <span className="tab-capture-dot" />
          ) : (
            <svg className="tab-capture-cast-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M1.5 2.5A1.5 1.5 0 0 0 0 4v8a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 16 12V4a1.5 1.5 0 0 0-1.5-1.5h-13zM1 4a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V4z"/>
              <path d="M4.5 10.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z"/>
            </svg>
          )}
        </div>
      )}

      {/* Close button */}
      <div className="close-btn" onClick={handleClose}>
        <img src={tabCloseSvg} className="tab-close-icon chrome-toolbar-icon-img" width={14} height={14} alt="" />
      </div>
    </div>
  );
}
