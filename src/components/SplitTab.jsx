import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTabDrag } from '../hooks/useTabDrag';
import { useInvsurfLogoFaviconUrl } from '../hooks/useInvsurfLogoFavicon';
import { isInvsurfBrandedInternalTab } from '../utils/invisurfInternalPages';
import { logoIcognitoDarkSvg, tabCloseSvg } from '../constants/appAssetUrls';
import { setCurrentTab, setSplitFocusedSide } from '../store/browserSlice';
import './SplitTab.css';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

export default function SplitTab({
  splitPair,
  leftTab,
  rightTab,
  isActive,
  onCloseLeft,
  onCloseRight,
  onClose,
  onSwitch,
  onDragEnd,
  onContextMenu,
  displayMode = 'full',
  pinnedTabCount = 0,
  tabCount = 1,
  onDetachTab,
}) {
  const dispatch = useDispatch();
  const currentTabId = useSelector(s => s.browser.currentTabId);
  const invsurfLogoFavicon = useInvsurfLogoFaviconUrl();
  const leftTabId = splitPair.leftTabId;
  const rightTabId = splitPair.rightTabId;
  const isSwapped = !!splitPair.isSwapped;

  // Visual sub-tabs reflect the screen-side content panes:
  // When swapped, visual left is rightTab, visual right is leftTab
  const visualLeftTab = isSwapped ? rightTab : leftTab;
  const visualRightTab = isSwapped ? leftTab : rightTab;
  const visualLeftId = isSwapped ? rightTabId : leftTabId;
  const visualRightId = isSwapped ? leftTabId : rightTabId;
  const visualLeftIsChoosing = isSwapped ? !!splitPair.isChoosing : false;
  const visualRightIsChoosing = isSwapped ? false : !!splitPair.isChoosing;

  const isVisualLeftActive = isActive && (
    currentTabId === visualLeftId ||
    (!currentTabId && (isSwapped ? splitPair.focusedSide === 'right' : splitPair.focusedSide === 'left'))
  );
  const isVisualRightActive = isActive && (
    currentTabId === visualRightId ||
    (!currentTabId && (isSwapped ? splitPair.focusedSide === 'left' : splitPair.focusedSide === 'right'))
  );

  const handleSwitchTab = useCallback((tabId) => onSwitch(tabId), [onSwitch]);
  const handleDragEnd = useCallback((ids) => onDragEnd(ids), [onDragEnd]);

  // Tab drag hook keyed to the compound tab
  const tabRef = useTabDrag({
    id: leftTabId,
    tab: leftTab,
    onSwitchTab: handleSwitchTab,
    onDragEnd: handleDragEnd,
    onHideTooltip: () => {},
    isPinned: false,
    pinnedTabCount,
    isActive,
    tabCount,
    onDetachTab,
  });

  const getFavicon = (tab) => {
    if (!tab) return DEFAULT_FAVICON;
    if (tab.isLoading) return null;
    if (tab.isStealth) return logoIcognitoDarkSvg;
    if (isInvsurfBrandedInternalTab(tab)) return invsurfLogoFavicon;
    if (tab.favicon) return tab.favicon;
    if (tab.url && tab.url.includes('google.com')) return 'https://www.google.com/favicon.ico';
    return DEFAULT_FAVICON;
  };

  const visualLeftFavicon = getFavicon(visualLeftTab);
  const visualRightFavicon = getFavicon(visualRightTab);

  const handleClickTab = (e) => {
    if (e.target.closest('.mini-tab-close-btn')) return;
    const targetId = splitPair.focusedSide === 'right' ? rightTabId : leftTabId;
    if (targetId) onSwitch(targetId);
  };

  const handleSubTabClick = (e, visualSide) => {
    if (e.target.closest('.mini-tab-close-btn')) return;
    e.stopPropagation();

    const isChoosing = visualSide === 'left' ? visualLeftIsChoosing : visualRightIsChoosing;
    const targetId = visualSide === 'left' ? visualLeftId : visualRightId;
    const logicalSide = visualSide === 'left' ? (isSwapped ? 'right' : 'left') : (isSwapped ? 'left' : 'right');

    if (isChoosing) {
      if (window.electronAPI?.splitTabFocusSide) {
        window.electronAPI.splitTabFocusSide(splitPair.id, logicalSide);
      }
      return;
    }

    if (window.electronAPI?.splitTabFocusSide) {
      window.electronAPI.splitTabFocusSide(splitPair.id, logicalSide);
    }
    if (targetId) {
      dispatch(setCurrentTab(targetId));
      dispatch(setSplitFocusedSide({ splitId: splitPair.id, side: logicalSide }));
      onSwitch(targetId);
    }
  };

  const handleCloseSubTab = (e, visualSide) => {
    e.stopPropagation();
    const isChoosing = visualSide === 'left' ? visualLeftIsChoosing : visualRightIsChoosing;
    const targetId = visualSide === 'left' ? visualLeftId : visualRightId;

    if (isChoosing) {
      if (window.electronAPI?.splitTabExit) {
        window.electronAPI.splitTabExit(splitPair.id);
      }
      return;
    }

    const isLogicalLeft = (visualSide === 'left' && !isSwapped) || (visualSide === 'right' && isSwapped);
    if (isLogicalLeft) {
      if (onCloseLeft) {
        onCloseLeft();
      } else if (onClose && targetId) {
        onClose(targetId);
      }
    } else {
      if (onCloseRight) {
        onCloseRight();
      } else if (onClose && targetId) {
        onClose(targetId);
      }
    }
  };

  const handleContextMenuSubTab = (e, visualSide) => {
    e.preventDefault();
    e.stopPropagation();
    const targetId = visualSide === 'left' ? visualLeftId : visualRightId;
    if (onContextMenu && targetId) onContextMenu(e, targetId);
  };

  const handleTabContextMenu = (e) => {
    e.preventDefault();
    if (onContextMenu) onContextMenu(e, leftTabId);
  };

  const handleAuxClickSubTab = (e, visualSide) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      handleCloseSubTab(e, visualSide);
    }
  };

  const className = [
    'tab',
    'split-compound-tab',
    isActive ? 'active' : '',
    `tab--mode-${displayMode}`,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={tabRef}
      id={leftTabId}
      className={className}
      data-tab-id={leftTabId}
      data-split-id={splitPair.id}
      onClick={handleClickTab}
      onContextMenu={handleTabContextMenu}
    >
      {/* Left visual mini-tab */}
      <div
        className={`split-mini-tab split-mini-tab--left${isVisualLeftActive ? ' active' : ''}${visualLeftIsChoosing ? ' split-mini-tab--choosing' : ''}`}
        title={visualLeftIsChoosing ? 'Choose a tab' : (visualLeftTab?.title || 'Tab')}
        onClick={(e) => handleSubTabClick(e, 'left')}
        onContextMenu={(e) => handleContextMenuSubTab(e, 'left')}
        onAuxClick={(e) => handleAuxClickSubTab(e, 'left')}
      >
        <div className="icon-container">
          {visualLeftIsChoosing ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7 }}>
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h4V3H3zm5 0v10h5V3H8z" />
            </svg>
          ) : visualLeftTab?.isLoading ? (
            <div className="spinner" />
          ) : (
            <img
              src={visualLeftFavicon}
              className="tab-icon"
              alt=""
              onError={(e) => { e.target.src = DEFAULT_FAVICON; }}
            />
          )}
        </div>
        <span className="tab-title">{visualLeftIsChoosing ? 'Choose a tab' : (visualLeftTab?.title || 'New Tab')}</span>
        <div
          className="close-btn mini-tab-close-btn"
          aria-label="Close Left Tab"
          onClick={(e) => handleCloseSubTab(e, 'left')}
          title={visualLeftIsChoosing ? 'Cancel split view' : 'Close tab'}
        >
          <img src={tabCloseSvg} className="tab-close-icon chrome-toolbar-icon-img" width={14} height={14} alt="" />
        </div>
      </div>

      <div className="split-mini-divider" />

      {/* Right visual mini-tab */}
      <div
        className={`split-mini-tab split-mini-tab--right${isVisualRightActive ? ' active' : ''}${visualRightIsChoosing ? ' split-mini-tab--choosing' : ''}`}
        title={visualRightIsChoosing ? 'Choose a tab' : (visualRightTab?.title || 'Tab')}
        onClick={(e) => handleSubTabClick(e, 'right')}
        onContextMenu={(e) => handleContextMenuSubTab(e, 'right')}
        onAuxClick={(e) => handleAuxClickSubTab(e, 'right')}
      >
        <div className="icon-container">
          {visualRightIsChoosing ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7 }}>
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h4V3H3zm5 0v10h5V3H8z" />
            </svg>
          ) : visualRightTab?.isLoading ? (
            <div className="spinner" />
          ) : (
            <img
              src={visualRightFavicon}
              className="tab-icon"
              alt=""
              onError={(e) => { e.target.src = DEFAULT_FAVICON; }}
            />
          )}
        </div>
        <span className="tab-title">{visualRightIsChoosing ? 'Choose a tab' : (visualRightTab?.title || 'New Tab')}</span>
        <div
          className="close-btn mini-tab-close-btn"
          aria-label="Close Right Tab"
          onClick={(e) => handleCloseSubTab(e, 'right')}
          title={visualRightIsChoosing ? 'Cancel split view' : 'Close tab'}
        >
          <img src={tabCloseSvg} className="tab-close-icon chrome-toolbar-icon-img" width={14} height={14} alt="" />
        </div>
      </div>
    </div>
  );
}
