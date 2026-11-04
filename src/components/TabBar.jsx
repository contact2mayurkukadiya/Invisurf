import React, { useEffect, useRef, useCallback, useMemo, useState, useLayoutEffect } from 'react';
import { useSelector } from 'react-redux';
import Tab from './Tab';
import SplitTab from './SplitTab';
import { tabAddSvg } from '../constants/appAssetUrls';
import { PLATFORM } from '../constants/conditionStrings.js';

const ADD_ICON = <img className="chrome-toolbar-icon-img" src={tabAddSvg} width={25} height={25} alt="" />;
const TAB_DISPLAY_MODE = {
  FULL: 'full',
  ICON_ONLY: 'icon-only',
  EXTREME_OVERFLOW: 'extreme-overflow',
};

const TAB_WIDTH_THRESHOLDS = {
  full: 60,
  iconOnly: 28,
};

function getTabDisplayMode(tabWidth) {
  if (tabWidth >= TAB_WIDTH_THRESHOLDS.full) return TAB_DISPLAY_MODE.FULL;
  if (tabWidth > TAB_WIDTH_THRESHOLDS.iconOnly) return TAB_DISPLAY_MODE.ICON_ONLY;
  return TAB_DISPLAY_MODE.EXTREME_OVERFLOW;
}

function getSplitTabDisplayMode(tabWidth) {
  const subTabWidth = tabWidth / 2;
  if (subTabWidth >= TAB_WIDTH_THRESHOLDS.full) return TAB_DISPLAY_MODE.FULL;
  if (subTabWidth > TAB_WIDTH_THRESHOLDS.iconOnly) return TAB_DISPLAY_MODE.ICON_ONLY;
  return TAB_DISPLAY_MODE.EXTREME_OVERFLOW;
}

export default function TabBar({
  isGhostWindow = false,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onDragEnd,
  onDetachTab,
  onTabStripContextMenu,
}) {
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const tabs = useSelector(s => s.browser.tabs);
  const currentTabId = useSelector(s => s.browser.currentTabId);
  const splitGroups = useSelector(s => s.browser.splitGroups);

  const [isStuckToRight, setIsStuckToRight] = useState(false);
  const [tabWidth, setTabWidth] = useState(240);
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [lastTabHovered, setLastTabHovered] = useState(false);
  const tabBarRef = useRef(null);
  const tabTrackRef = useRef(null);
  const tabContainerRef = useRef(null);

  const hoverTimeoutRef = useRef(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    window.electronAPI.tooltipHide();
  }, []);

  const handleWheel = useCallback((e) => {
    hideTooltip();
    const container = tabContainerRef.current;
    if (!container) return;
    if (container.scrollWidth <= container.clientWidth) return;

    // Trackpad horizontal swipe (deltaX !== 0) is natively handled by Chromium with momentum.
    // Only convert pure vertical wheel (e.g. mouse wheel where deltaX === 0) to horizontal scroll.
    if (Math.abs(e.deltaX) === 0 && e.deltaY !== 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }, [hideTooltip]);

  const handleGhostDragMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .tab, input')) return;

    e.preventDefault();

    let lastX = e.screenX;
    let lastY = e.screenY;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.screenX - lastX;
      const deltaY = moveEvent.screenY - lastY;
      lastX = moveEvent.screenX;
      lastY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        window.electronAPI?.ghostDrag?.(deltaX, deltaY);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    if (!isGhostWindow) return;
    let mounted = true;
    window.electronAPI?.ghostGetClickThrough?.().then((val) => {
      if (mounted && typeof val === 'boolean') {
        setIsClickThrough(val);
      }
    }).catch(() => {});

    const unsubscribe = window.electronAPI?.onGhostClickThroughChanged?.((data) => {
      if (mounted && data && typeof data.isClickThrough === 'boolean') {
        setIsClickThrough(data.isClickThrough);
      }
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isGhostWindow]);

  const handleGhostBadgeClick = useCallback((e) => {
    e.stopPropagation();
    window.electronAPI?.ghostToggleClickThrough?.();
  }, []);

  const platform = window.electronAPI?.platform;
  const isMac = platform === PLATFORM.DARWIN;
  const isWin = platform === PLATFORM.WIN32;
  const rightSplitTabIds = useMemo(() => {
    const set = new Set();
    Object.values(splitGroups || {}).forEach((p) => {
      if (
        p.rightTabId &&
        tabs[p.rightTabId]?.splitPairId === p.id &&
        p.leftTabId &&
        tabs[p.leftTabId]?.splitPairId === p.id
      ) {
        set.add(p.rightTabId);
      }
    });
    return set;
  }, [splitGroups, tabs]);

  const visibleTabOrder = useMemo(
    () => tabOrder.filter((tid) => !rightSplitTabIds.has(tid)),
    [tabOrder, rightSplitTabIds]
  );

  const lastTabId = visibleTabOrder[visibleTabOrder.length - 1];

  const isLastTabActive = useMemo(() => {
    if (!lastTabId) return false;
    if (lastTabId === currentTabId) return true;
    if (splitGroups) {
      return Object.values(splitGroups).some(
        (p) => p.leftTabId === lastTabId && (currentTabId === p.leftTabId || currentTabId === p.rightTabId)
      );
    }
    return false;
  }, [lastTabId, currentTabId, splitGroups]);

  const handleTabHoverEnter = useCallback((id, tabEl) => {
    setLastTabHovered(id === lastTabId);
    if (window._draggingTabId) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(async () => {
      if (window._draggingTabId) return;
      if (!tabEl || !document.contains(tabEl)) return;
      const info = await window.electronAPI.getTabInfo(id);
      if (!info || window._draggingTabId) return;
      if (!tabEl || !document.contains(tabEl)) return;
      const tabData = tabsRef.current?.[id];
      const title = (info.title && info.title.trim()) || (tabData?.title && tabData.title.trim()) || 'New Tab';
      const url = info.url || tabData?.url;
      const rect = tabEl.getBoundingClientRect();
      const tooltipWidth = 280;
      const tooltipHeight = 140;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      left = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, left));
      window.electronAPI.tooltipShow({
        title,
        url,
        memory: info.memory,
        x: left,
        y: rect.bottom + 8,
        width: tooltipWidth,
        height: tooltipHeight,
      });
    }, 500);
  }, [lastTabId]);

  const handleTabHoverLeave = useCallback(() => {
    setLastTabHovered(false);
    hideTooltip();
  }, [hideTooltip]);

  const pinnedTabCount = useMemo(
    () => visibleTabOrder.filter((tid) => tabs[tid]?.isPinned).length,
    [visibleTabOrder, tabs],
  );

  const updateTabWidth = useCallback(() => {
    const bar = tabBarRef.current;
    if (!bar) return;

    const computed = window.getComputedStyle(bar);
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;
    const totalBarWidth = bar.clientWidth - padLeft - padRight;

    // Reserve space for separator (8px) + #add-tab button (32px) + right window edge spacing (8px)
    const addTabSpace = 48;
    const maxAvailable = Math.max(100, totalBarWidth - addTabSpace);

    const unpinnedCount = visibleTabOrder.length - pinnedTabCount;
    if (unpinnedCount <= 0) {
      setIsStuckToRight(false);
      setTabWidth(240);
      return;
    }

    // Pinned tabs take 42px each + 5px gap = 47px
    const pinnedSpace = pinnedTabCount * 47;
    // Gaps between unpinned tabs (5px each) + container left/right padding (11px)
    const gapsAndPadding = Math.max(0, (unpinnedCount - 1) * 5) + 11;

    // Total width if all unpinned tabs were at full preferred width (240px)
    const totalWidthAtFull = (unpinnedCount * 240) + pinnedSpace + gapsAndPadding;
    const shouldStick = totalWidthAtFull > maxAvailable;
    setIsStuckToRight(shouldStick);

    const availableForUnpinned = maxAvailable - pinnedSpace - gapsAndPadding;
    const idealWidth = availableForUnpinned / unpinnedCount;
    const nextWidth = Math.min(240, Math.max(28, Math.floor(idealWidth)));

    setTabWidth(nextWidth);

    // If total tabs fit within container without extreme overflow, reset scrollLeft so tabs align cleanly
    const container = tabContainerRef.current;
    if (container && (!shouldStick || nextWidth > 28 || container.scrollWidth <= container.clientWidth)) {
      container.scrollLeft = 0;
    }
  }, [visibleTabOrder.length, pinnedTabCount]);

  useLayoutEffect(() => {
    updateTabWidth();

    const barEl = tabBarRef.current;
    if (!barEl) return undefined;

    const resizeObserver = new ResizeObserver(() => {
      updateTabWidth();
    });
    resizeObserver.observe(barEl);

    window.addEventListener('resize', updateTabWidth);

    return () => {
      window.removeEventListener('resize', updateTabWidth);
      resizeObserver.disconnect();
    };
  }, [updateTabWidth]);

  useLayoutEffect(() => {
    if (!currentTabId || !tabTrackRef.current) return;
    const container = tabContainerRef.current;
    if (tabWidth <= 28) {
      const activeTabEl = tabTrackRef.current.querySelector(`.tab[data-tab-id="${currentTabId}"]`);
      if (activeTabEl) {
        activeTabEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    } else if (container && container.scrollLeft !== 0) {
      container.scrollLeft = 0;
    }
  }, [currentTabId, tabWidth]);

  const displayMode = useMemo(() => {
    return getTabDisplayMode(tabWidth);
  }, [tabWidth]);

  const splitDisplayMode = useMemo(() => {
    return getSplitTabDisplayMode(tabWidth);
  }, [tabWidth]);

  return (
    <div
      ref={tabBarRef}
      className={`tab-bar${isMac ? ' tab-bar--mac' : ''}${isWin ? ' tab-bar--win' : ''}${isGhostWindow ? ' tab-bar--ghost' : ''}`}
      onMouseDown={isGhostWindow ? handleGhostDragMouseDown : undefined}
    >
      {isGhostWindow && !isMac && (
        <button
          type="button"
          className={`ghost-badge ghost-badge--left${isClickThrough ? ' ghost-badge--passthrough' : ''}`}
          onClick={handleGhostBadgeClick}
          title={isClickThrough ? "Click-Through: ON (Passthrough) • Press Ctrl+Shift+G to restore" : "Click-Through: OFF (Interactive) • Click or Ctrl+Shift+G to enable passthrough"}
          aria-label="Ghost Window Click-Through Status"
        >
          <span className={`ghost-badge-dot${isClickThrough ? ' ghost-badge-dot--passthrough' : ''}`} />
          <span>{isClickThrough ? 'Ghost • Passthrough' : 'Ghost'}</span>
        </button>
      )}
      <div
        ref={tabContainerRef}
        className={`tab-container${isStuckToRight ? ' tab-container--stuck' : ''}${displayMode === TAB_DISPLAY_MODE.EXTREME_OVERFLOW ? ' tab-container--overflow' : ''}`}
        onWheel={handleWheel}
      >
        <div ref={tabTrackRef} className="tab-track" style={{ '--tab-width': `${tabWidth}px` }}>
          {tabOrder.map(id => {
            if (rightSplitTabIds.has(id)) return null;
            const splitPair = Object.values(splitGroups || {}).find(
              (p) => p.leftTabId === id && tabs[id]?.splitPairId === p.id
            );

            if (splitPair) {
              return (
                <SplitTab
                  key={`split-${splitPair.id}`}
                  splitPair={splitPair}
                  leftTab={tabs[splitPair.leftTabId]}
                  rightTab={tabs[splitPair.rightTabId]}
                  isActive={currentTabId === splitPair.leftTabId || currentTabId === splitPair.rightTabId}
                  displayMode={splitDisplayMode}
                  pinnedTabCount={pinnedTabCount}
                  tabCount={visibleTabOrder.length}
                  onCloseLeft={() => onCloseTab(splitPair.leftTabId)}
                  onCloseRight={() => onCloseTab(splitPair.rightTabId)}
                  onClose={() => onCloseTab(id)}
                  onSwitch={onSwitchTab}
                  onDragEnd={onDragEnd}
                  onDetachTab={onDetachTab}
                  onContextMenu={onTabStripContextMenu}
                />
              );
            }

            return (
              <Tab
                key={id}
                id={id}
                tab={tabs[id]}
                isActive={id === currentTabId}
                displayMode={displayMode}
                pinnedTabCount={pinnedTabCount}
                tabCount={visibleTabOrder.length}
                onClose={() => onCloseTab(id)}
                onSwitch={onSwitchTab}
                onDragEnd={onDragEnd}
                onDetachTab={onDetachTab}
                onHoverEnter={handleTabHoverEnter}
                onHoverLeave={handleTabHoverLeave}
                onHideTooltip={hideTooltip}
                onContextMenu={onTabStripContextMenu ? (e) => onTabStripContextMenu(e, id) : undefined}
              />
            );
          })}
        </div>
      </div>
      {visibleTabOrder.length > 0 && (
        <div
          className={`tab-add-separator${lastTabHovered || isLastTabActive ? ' tab-add-separator--hidden' : ''}`}
          aria-hidden="true"
        />
      )}
      <button id="add-tab" className="btn" onClick={() => onNewTab()}>
        {ADD_ICON}
      </button>
      {isGhostWindow && isMac && (
        <button
          type="button"
          className={`ghost-badge ghost-badge--right${isClickThrough ? ' ghost-badge--passthrough' : ''}`}
          onClick={handleGhostBadgeClick}
          title={isClickThrough ? "Click-Through: ON (Passthrough) • Press ⌘⇧G to restore" : "Click-Through: OFF (Interactive) • Click or ⌘⇧G to enable passthrough"}
          aria-label="Ghost Window Click-Through Status"
        >
          <span className={`ghost-badge-dot${isClickThrough ? ' ghost-badge-dot--passthrough' : ''}`} />
          <span>{isClickThrough ? 'Ghost • Passthrough' : 'Ghost'}</span>
        </button>
      )}
    </div>
  );
}
