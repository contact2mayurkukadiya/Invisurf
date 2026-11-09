import React, { useEffect, useRef, useCallback, useMemo, useState, useLayoutEffect } from 'react';
import { useSelector, useDispatch, useStore } from 'react-redux';
import Tab from './Tab';
import SplitTab from './SplitTab';
import GroupChip from './tabgroup/GroupChip';
import './tabgroup/tabGroup.css';
import { toggleGroupCollapse, setGroupVisuals, ungroupTabGroup, addTab, moveTabGroup, detachGroup } from '../store/browserSlice';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext.jsx';
import { getGroupThemeColors } from '../utils/tabGroupModel';
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
  const screenShare = useSelector(s => s.browser.screenShare);
  const tabGroups = useSelector(s => s.browser.tabGroups || {});
  const dispatch = useDispatch();
  const store = useStore();

  const { reset, acquire, release, post } = useChromeShellMenuOverlay();
  const activeOverlayGroupIdRef = useRef(null);

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
  const tabOrderRef = useRef(tabOrder);
  tabOrderRef.current = tabOrder;
  const tabGroupsRef = useRef(tabGroups);
  tabGroupsRef.current = tabGroups;

  const openGroupEditor = useCallback(async (groupId, anchorRect) => {
    if (!groupId) return;
    const group = tabGroupsRef.current?.[groupId];
    activeOverlayGroupIdRef.current = groupId;
    try {
      await reset();
      await acquire();
      await post({
        kind: 'tabGroupEditor',
        groupId,
        title: group?.title || '',
        color: group?.color || 'grey',
        anchorRect: {
          left: anchorRect?.left || 0,
          top: anchorRect?.top || 0,
          width: anchorRect?.width || 24,
          height: anchorRect?.height || 24,
        },
      });
    } catch (err) {
      console.error('tabGroupEditor overlay open failed', err);
      try { await release(); } catch (_) {}
    }
  }, [reset, acquire, release, post]);

  // Listen for host events forwarded from the overlay view
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      const { type, groupId } = data || {};
      if (type === 'tabGroupSetTitle') {
        dispatch(setGroupVisuals({ groupId, title: data.title }));
      } else if (type === 'tabGroupSetColor') {
        dispatch(setGroupVisuals({ groupId, color: data.color }));
      } else if (type === 'tabGroupNewTab') {
        const newId = `tab-${Date.now()}`;
        dispatch(addTab({ id: newId, groupId }));
        if (window.electronAPI?.newTab) {
          window.electronAPI.newTab(newId, false, null);
        }
        void release();
      } else if (type === 'tabGroupUngroup') {
        dispatch(ungroupTabGroup({ groupId }));
        void release();
      } else if (type === 'tabGroupCloseGroup') {
        const toClose = tabOrderRef.current.filter((tid) => tabsRef.current[tid]?.groupId === groupId);
        toClose.forEach((tid) => onCloseTab(tid));
        void release();
      } else if (type === 'tabGroupMoveNewWindow') {
        const toMove = tabOrderRef.current.filter((tid) => tabsRef.current[tid]?.groupId === groupId);
        const group = tabGroupsRef.current?.[groupId] || store.getState().browser.tabGroups?.[groupId];
        if (group && toMove.length > 0 && window.electronAPI?.createWindow) {
          const memberTabsData = toMove.map((tid) => {
            const t = tabsRef.current[tid];
            return {
              id: tid,
              url: t?.url || '',
              title: t?.title || 'New Tab',
              favicon: t?.favicon || null,
              isStealth: !!t?.isStealth,
            };
          });
          const curId = store.getState().browser.currentTabId;
          const activeTabId = toMove.includes(curId) ? curId : toMove[0];

          window.electronAPI.createWindow({
            group: { ...group },
            tabs: memberTabsData,
            activeTabId,
          });
          toMove.forEach((tid) => onCloseTab(tid));
        }
        void release();
      } else if (type === 'dismiss') {
        activeOverlayGroupIdRef.current = null;
        void release();
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [dispatch, onCloseTab, release]);

  // Listen for external trigger to open group editor (e.g. after context menu creation)
  useEffect(() => {
    const handler = (e) => {
      const { groupId } = e.detail || {};
      if (groupId) {
        const chipEl = tabTrackRef.current?.querySelector(`[data-group-id="${groupId}"]`) || tabBarRef.current;
        const rect = chipEl ? chipEl.getBoundingClientRect() : null;
        openGroupEditor(groupId, rect);
      }
    };
    window.addEventListener('invisurf:open-group-editor', handler);
    return () => window.removeEventListener('invisurf:open-group-editor', handler);
  }, [openGroupEditor]);

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

  const uncollapsedVisibleTabOrder = useMemo(
    () => visibleTabOrder.filter((tid) => {
      const gid = tabs[tid]?.groupId;
      return !gid || !tabGroups[gid]?.collapsed;
    }),
    [visibleTabOrder, tabs, tabGroups]
  );

  const lastTabId = uncollapsedVisibleTabOrder[uncollapsedVisibleTabOrder.length - 1];

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

  const getCaptureRole = useCallback((tabId) => {
    if (!screenShare?.active || screenShare?.sourceKind !== 'tab') return null;
    const normId = String(tabId).replace(/^tab:/, '');
    const normShared = screenShare.sharedTabId !== null && screenShare.sharedTabId !== undefined
      ? String(screenShare.sharedTabId).replace(/^tab:/, '')
      : null;
    const normCapturer = screenShare.requestingTabId !== null && screenShare.requestingTabId !== undefined
      ? String(screenShare.requestingTabId).replace(/^tab:/, '')
      : null;
    if (normShared && normId === normShared) return 'captured';
    if (normCapturer && normId === normCapturer) return 'capturer';
    return null;
  }, [screenShare]);

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

    let groupChipsSpace = 0;
    const seenGids = new Set();
    visibleTabOrder.forEach((tid) => {
      const gid = tabs[tid]?.groupId;
      if (gid && tabGroups[gid] && !seenGids.has(gid)) {
        seenGids.add(gid);
        const titleLen = (tabGroups[gid].title || '').length;
        const chipW = titleLen === 0 ? 20 : Math.min(160, 36 + titleLen * 7);
        groupChipsSpace += chipW + 5;
      }
    });

    const unpinnedCount = uncollapsedVisibleTabOrder.length - pinnedTabCount;
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
    const totalWidthAtFull = (unpinnedCount * 240) + pinnedSpace + gapsAndPadding + groupChipsSpace;
    const shouldStick = totalWidthAtFull > maxAvailable;
    setIsStuckToRight(shouldStick);

    const availableForUnpinned = maxAvailable - pinnedSpace - gapsAndPadding - groupChipsSpace;
    const idealWidth = availableForUnpinned / unpinnedCount;
    const nextWidth = Math.min(240, Math.max(28, Math.floor(idealWidth)));

    setTabWidth(nextWidth);

    // If total tabs fit within container without extreme overflow, reset scrollLeft so tabs align cleanly
    const container = tabContainerRef.current;
    if (container && (!shouldStick || nextWidth > 28 || container.scrollWidth <= container.clientWidth)) {
      container.scrollLeft = 0;
    }
  }, [uncollapsedVisibleTabOrder.length, visibleTabOrder, tabGroups, pinnedTabCount]);

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
          tabIndex={-1}
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
          {(() => {
            const renderedGroupChips = new Set();
            return tabOrder.map((id) => {
              if (rightSplitTabIds.has(id)) return null;
              const tab = tabs[id];
              const gid = tab?.groupId;
              const group = (gid && tabGroups[gid]) ? tabGroups[gid] : null;

              let chipElement = null;
              if (group && !renderedGroupChips.has(gid)) {
                renderedGroupChips.add(gid);
                const memberCount = tabOrder.filter((tid) => tabs[tid]?.groupId === gid).length;
                chipElement = (
                  <GroupChip
                    key={`chip-${gid}`}
                    group={group}
                    tabCount={memberCount}
                    isCollapsed={!!group.collapsed}
                    onToggleCollapse={(targetGid) => {
                      const curTab = store.getState().browser.tabs[store.getState().browser.currentTabId];
                      const wasInGroup = curTab?.groupId === targetGid;
                      dispatch(toggleGroupCollapse({ groupId: targetGid }));
                      if (wasInGroup) {
                        const nextId = store.getState().browser.currentTabId;
                        if (nextId && nextId !== curTab.id) {
                          onSwitchTab?.(nextId);
                        } else if (!nextId) {
                          onNewTab?.();
                        }
                      }
                    }}
                    onOpenEditor={(targetGid, rect) => {
                      openGroupEditor(targetGid, rect);
                    }}
                    onContextMenu={onTabStripContextMenu}
                    onMoveGroup={(targetGid, targetIndex) => {
                      dispatch(moveTabGroup({ groupId: targetGid, targetIndex }));
                    }}
                    onDetachGroup={(targetGid, memberTabIds) => {
                      dispatch(detachGroup({ groupId: targetGid, memberTabIds }));
                    }}
                    activeTabId={currentTabId}
                    tabOrder={tabOrder}
                    tabs={tabs}
                    pinnedTabCount={pinnedTabCount}
                  />
                );
              }

              const groupUnderlineColor = group?.color ? getGroupThemeColors(group.color, false).underline : null;
              const memberTabs = gid ? tabOrder.filter((tid) => tabs[tid]?.groupId === gid && !rightSplitTabIds.has(tid)) : [];
              const memberIdx = memberTabs.indexOf(id);
              const isFirstInGroup = memberIdx === 0;
              const isLastInGroup = memberIdx === memberTabs.length - 1;
              const isCollapsedMember = !!group?.collapsed;
              const prevTabIsActiveInGroup = memberIdx > 0 && memberTabs[memberIdx - 1] === currentTabId;
              const nextTabIsActiveInGroup = memberIdx >= 0 && memberIdx < memberTabs.length - 1 && memberTabs[memberIdx + 1] === currentTabId;

              const splitPair = Object.values(splitGroups || {}).find(
                (p) => p.leftTabId === id && tabs[id]?.splitPairId === p.id
              );

              const tabContent = splitPair ? (
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
                  groupColor={groupUnderlineColor}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  prevTabIsActiveInGroup={prevTabIsActiveInGroup}
                  nextTabIsActiveInGroup={nextTabIsActiveInGroup}
                  isCollapsedMember={isCollapsedMember}
                />
              ) : (
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
                  captureRole={getCaptureRole(id)}
                  groupColor={groupUnderlineColor}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  prevTabIsActiveInGroup={prevTabIsActiveInGroup}
                  nextTabIsActiveInGroup={nextTabIsActiveInGroup}
                  isCollapsedMember={isCollapsedMember}
                />
              );

              if (chipElement) {
                return (
                  <React.Fragment key={`group-item-${id}`}>
                    {chipElement}
                    {tabContent}
                  </React.Fragment>
                );
              }
              return tabContent;
            });
          })()}
        </div>
      </div>
      {visibleTabOrder.length > 0 && (
        <div
          className={`tab-add-separator${lastTabHovered || isLastTabActive ? ' tab-add-separator--hidden' : ''}`}
          aria-hidden="true"
        />
      )}
      <button id="add-tab" tabIndex={-1} className="btn" onClick={() => onNewTab()}>
        {ADD_ICON}
      </button>
      {isGhostWindow && isMac && (
        <button
          type="button"
          tabIndex={-1}
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
