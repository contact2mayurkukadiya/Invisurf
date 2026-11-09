import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addTab, addSleepingTab, wakeTab,
  removeTab, setCurrentTab,
  reorderTabs,
  insertTabAfter,
  insertTabAt,
  setTabPinned,
  setTabAudioMuted,
  setShowBookmarkBar,
  toggleSidePanel,
  setSidePanelOpen,
  setSidePanelActiveView,
  setSidePanelWidth,
  setSidePanelCustomUrl,
  setSplitGroup,
  removeSplitGroup,
  detachSplitTab,
  insertSplitTabAt,
  swapSplitSides,
  toggleSplitStacked,
  createTabGroup,
  addTabsToGroup,
  removeTabsFromGroup,
  ungroupTabGroup,
  setTabGroups,
  reattachTabGroup,
} from './store/browserSlice';
import { setBookmarks } from './store/bookmarksSlice';
import { useElectronIPC } from './hooks/useElectronIPC';
import { useChromeTheme } from './hooks/useChromeTheme';
import { useToolbarFocusBridge } from './hooks/useToolbarFocusBridge';
import { useGhostTitleBarInteractivity } from './hooks/useGhostTitleBarInteractivity';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import BookmarkBar from './components/BookmarkBar';
import ScreenShareBanner from './components/ScreenShareBanner';
import SearchTabsModal from './components/SearchTabsModal';
import CommandPaletteModal from './components/CommandPaletteModal';
import SidePanel from './components/sidepanel/SidePanel';
import SplitDivider from './components/split/SplitDivider';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import { TabOverlayProvider } from './context/TabOverlayContext';
import { ChromeOverlayProvider } from './context/ChromeOverlayContext';
import { isSameInternalPage } from './utils/invisurfInternalPages';
import {
  URL as URL_C,
  NAV_SOURCE,
  TAB_STRIP_MENU,
  CONTEXT_MENU,
} from './constants/conditionStrings.js';

function hostnameFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

function getNextActiveTabOnClose({ closingId, tabOrder, remaining, tabs, tabGroups, mruOrder }) {
  if (!remaining || remaining.length === 0) return null;

  const isTabVisible = (tid) => {
    if (!tid || !tabs[tid]) return false;
    const gid = tabs[tid].groupId;
    return !gid || !tabGroups?.[gid]?.collapsed;
  };

  // 1. Try finding the most recently used visible tab from mruOrder
  if (Array.isArray(mruOrder)) {
    for (const tid of mruOrder) {
      if (tid !== closingId && remaining.includes(tid) && isTabVisible(tid)) {
        return tid;
      }
    }
  }

  // 2. Fallback: spatial neighbor (first uncollapsed neighbor to right, then left)
  const idx = tabOrder.indexOf(closingId);
  const rightNeighbor = remaining[idx];
  const leftNeighbor = remaining[idx - 1];

  if (rightNeighbor && isTabVisible(rightNeighbor)) return rightNeighbor;
  if (leftNeighbor && isTabVisible(leftNeighbor)) return leftNeighbor;

  // 3. Any visible tab in remaining
  const anyVisible = remaining.find(isTabVisible);
  if (anyVisible) return anyVisible;

  // 4. Default fallback to standard spatial neighbor (even if collapsed)
  return rightNeighbor ?? leftNeighbor ?? remaining[0] ?? null;
}

function AppShell() {
  useChromeTheme();
  const dispatch = useDispatch();
  const tabs = useSelector(s => s.browser.tabs);
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const mruOrder = useSelector(s => s.browser.mruOrder || []);
  const currentTabId = useSelector(s => s.browser.currentTabId);
  const splitGroups = useSelector(s => s.browser.splitGroups || {});
  const tabGroups = useSelector(s => s.browser.tabGroups || {});
  const showBookmarkBar = useSelector(s => s.browser.showBookmarkBar !== false);
  /** True for dedicated stealth (incognito) windows — all tabs are private; chrome is fixed dark InvSurf. */
  const stealthWindowRef = useRef(!!(typeof window !== 'undefined' && window.__INVISURF_STEALTH_WINDOW__));
  const isStealthShell = stealthWindowRef.current;
  /** True for dedicated ghost (non-activating) windows. */
  const [isGhostShell, setIsGhostShell] = useState(
    () => !!(typeof window !== 'undefined' && (window.__INVISURF_GHOST_WINDOW__ || window.__APP_BOOTSTRAP?.ghostWindow))
  );
  const ghostWindowRef = useRef(isGhostShell);
  ghostWindowRef.current = isGhostShell;

  const [searchTabsOpen, setSearchTabsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchEngine, setSearchEngine] = useState('google');

  const sidePanelState = useSelector(s => s.browser.sidePanel || {});
  const isSidePanelOpen = !!sidePanelState.isOpen;
  const sidePanelWidth = sidePanelState.width || 360;

  const screenShareState = useSelector(s => s.browser.screenShare || {});
  const isTabSharing = Boolean(screenShareState.active && screenShareState.sourceKind === 'tab');

  useEffect(() => {
    const root = document.documentElement;
    const bannerOffset = isTabSharing ? 38 : 0;
    if (isSidePanelOpen) {
      root.style.setProperty('--side-panel-width', `${sidePanelWidth}px`);
      root.style.setProperty('--side-panel-open', '1');
      root.style.setProperty('--tab-content-top', `${126 + bannerOffset}px`);
      root.style.setProperty('--tab-content-left', '8px');
      root.style.setProperty('--tab-content-width', `calc(100vw - ${sidePanelWidth}px - 14px)`);
      root.style.setProperty('--tab-content-height', `calc(100vh - ${134 + bannerOffset}px)`);
      root.style.setProperty('--tab-content-radius', '14px');
    } else {
      root.style.setProperty('--side-panel-width', '0px');
      root.style.setProperty('--side-panel-open', '0');
      root.style.setProperty('--tab-content-top', `${122 + bannerOffset}px`);
      root.style.setProperty('--tab-content-left', '0px');
      root.style.setProperty('--tab-content-width', '100vw');
      root.style.setProperty('--tab-content-height', `calc(100vh - ${122 + bannerOffset}px)`);
      root.style.setProperty('--tab-content-radius', '0px');
    }
  }, [isSidePanelOpen, sidePanelWidth, isTabSharing]);

  // Always-fresh ref so event-handler closures never capture stale state
  const stateRef = useRef({});
  stateRef.current = { tabs, tabOrder, mruOrder, currentTabId, splitGroups, tabGroups };
  // Startup waits on IPC before deciding whether to create its default tab.
  // Track tab creation synchronously so Cmd+T can win that race safely.
  const hasRegisteredTabRef = useRef(false);
  /** Latest handlers for native tab strip context menu action IPC (refilled each render). */
  const tabStripMenuHandlersRef = useRef({});

  // ── Session save (debounced) ─────────────────────────────────────────────
  const sessionTimer = useRef(null);
  const requestSessionSave = useCallback(() => {
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      const { tabs, tabOrder, currentTabId, splitGroups, tabGroups } = stateRef.current;
      const tabsToSave = tabOrder
        .filter(id => tabs[id] && !tabs[id].isStealth)
        .map(id => ({
          id,
          url: tabs[id].url || '',
          // Persist display metadata so sleeping tabs can show the right
          // title and favicon immediately on the next session restore.
          title: tabs[id].title || URL_C.NEW_TAB_LABEL,
          favicon: tabs[id].favicon || null,
          splitPairId: tabs[id].splitPairId || null,
          groupId: tabs[id].groupId || null,
        }));

      if (tabsToSave.length > 0 && window.electronAPI.sessionSave) {
        let activeTab = currentTabId;
        if (tabs[activeTab]?.isStealth) {
          activeTab = tabsToSave[tabsToSave.length - 1]?.id || null;
        }
        window.electronAPI.sessionSave({
          tabs: tabsToSave,
          activeTabId: activeTab,
          splitGroups: splitGroups || {},
          tabGroups: tabGroups || {},
        });
      }
    }, 700);
  }, []);

  useEffect(() => {
    if (tabOrder.length > 0) requestSessionSave();
  }, [tabOrder, splitGroups, tabGroups, requestSessionSave]);

  // Native Tab menu: Mute/Unmute Site + Pin/Unpin labels for the active tab
  useEffect(() => {
    const sync = window.electronAPI.tabMenuSyncLabels;
    if (!sync) return;
    const cur = tabs[currentTabId];
    let muteSiteShowsUnmute = false;
    let pinShowsUnpin = false;
    if (cur) {
      pinShowsUnpin = !!cur.isPinned;
      const host = hostnameFromUrl(cur.url);
      if (host) {
        const match = tabOrder.filter((tid) => hostnameFromUrl(tabs[tid]?.url) === host);
        muteSiteShowsUnmute = match.length > 0 && match.every((tid) => tabs[tid]?.isAudioMuted);
      }
    }
    sync({ muteSiteShowsUnmute, pinShowsUnpin });
  }, [tabs, tabOrder, currentTabId]);

  // ── navigate bridge for bookmark-popup.html (separate overlay window) ───
  useEffect(() => {
    window.__navigateCurrentTab = (url) => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) window.electronAPI.navigate(currentTabId, url, { source: NAV_SOURCE.BOOKMARK });
    };
  }, []);

  // ── Tab operations ───────────────────────────────────────────────────────
  const switchTab = useCallback((id) => {
    if (stateRef.current.currentTabId === id) return;
    dispatch(setCurrentTab(id));
    window.electronAPI.switchTab(id);
  }, [dispatch]);

  const createTab = useCallback(() => {
    const st = stealthWindowRef.current;
    const id = 'tab-' + Date.now();
    hasRegisteredTabRef.current = true;
    dispatch(addTab({ id, isStealth: st, initialUrl: null }));
    // Main activates the tab inside new-tab → createTab; avoid redundant switch-tab IPC
    // (stateRef is stale until the next render, so switchTab would always fire duplicate IPC).
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const createTabWithUrl = useCallback((id, isStealth, initialUrl, options = {}) => {
    const st = stealthWindowRef.current || isStealth;
    hasRegisteredTabRef.current = true;
    dispatch(addTab({ id, isStealth: st, initialUrl }));
    window.electronAPI.newTab(id, st, initialUrl, options);
  }, [dispatch]);

  /** Close this browser shell when the last tab is gone (main process performs teardown). */
  const closeCurrentShellWindow = useCallback(() => {
    window.electronAPI.closeCurrentWindow?.();
  }, []);

  const closeTab = useCallback((id) => {
    const { tabOrder, currentTabId, tabs, tabGroups, mruOrder } = stateRef.current;
    const isActive = currentTabId === id;
    const remaining = tabOrder.filter((tid) => tid !== id);
    const closeWindowIfLast = remaining.length === 0;

    dispatch(removeTab(id));
    window.electronAPI.closeTab(id, { closeWindowIfLast });

    if (isActive && !closeWindowIfLast) {
      const nextId = getNextActiveTabOnClose({
        closingId: id,
        tabOrder,
        remaining,
        tabs,
        tabGroups,
        mruOrder,
      });

      if (nextId) {
        // Small delay so removeTab dispatch settles before switchTab
        setTimeout(() => {
          dispatch(setCurrentTab(nextId));
          window.electronAPI.switchTab(nextId);
        }, 0);
      }
    }
  }, [dispatch]);

  const handleTabClosedExternal = useCallback((id) => {
    if (!id) return;
    const { tabOrder, currentTabId, tabs, tabGroups, mruOrder } = stateRef.current;
    if (!tabOrder.includes(id)) return;
    const isActive = currentTabId === id;
    const remaining = tabOrder.filter((tid) => tid !== id);
    const closeWindowIfLast = remaining.length === 0;

    dispatch(removeTab(id));

    if (isActive && !closeWindowIfLast) {
      const nextId = getNextActiveTabOnClose({
        closingId: id,
        tabOrder,
        remaining,
        tabs,
        tabGroups,
        mruOrder,
      });

      if (nextId) {
        setTimeout(() => {
          dispatch(setCurrentTab(nextId));
          window.electronAPI.switchTab(nextId);
        }, 0);
      }
    } else if (closeWindowIfLast) {
      closeCurrentShellWindow();
    }
  }, [dispatch, closeCurrentShellWindow]);

  const handleDragEnd = useCallback((newTabOrder, details) => {
    dispatch(reorderTabs({ tabOrder: newTabOrder, movedTabId: details?.movedTabId, targetGroupId: details?.targetGroupId }));
    requestSessionSave();
  }, [dispatch, requestSessionSave]);

  const handleDetachTab = useCallback((id, splitPair) => {
    const { tabOrder, currentTabId, splitGroups, tabs, tabGroups, mruOrder } = stateRef.current;
    const pair = splitPair || (splitGroups && Object.values(splitGroups).find(p => p.leftTabId === id || p.rightTabId === id));

    if (pair) {
      const leftId = pair.leftTabId;
      const rightId = pair.rightTabId;
      const wasActive = currentTabId === leftId || currentTabId === rightId;
      const toRemove = [leftId, rightId].filter(Boolean);
      const remaining = tabOrder.filter((tid) => !toRemove.includes(tid));

      dispatch(detachSplitTab(pair.id));

      if (wasActive && remaining.length > 0) {
        const nextId = getNextActiveTabOnClose({
          closingId: leftId,
          tabOrder,
          remaining,
          tabs,
          tabGroups,
          mruOrder,
        });
        if (nextId) {
          dispatch(setCurrentTab(nextId));
          window.electronAPI?.switchTab?.(nextId);
        }
      }
      return;
    }

    const isActive = currentTabId === id;
    const remaining = tabOrder.filter((tid) => tid !== id);

    dispatch(removeTab(id));

    if (isActive && remaining.length > 0) {
      const nextId = getNextActiveTabOnClose({
        closingId: id,
        tabOrder,
        remaining,
        tabs,
        tabGroups,
        mruOrder,
      });
      if (nextId) {
        dispatch(setCurrentTab(nextId));
        window.electronAPI?.switchTab?.(nextId);
      }
    }
  }, [dispatch]);

  const handleSwitchTabDir = useCallback((direction) => {
    const { tabOrder, currentTabId } = stateRef.current;
    if (tabOrder.length <= 1) return;
    const idx = tabOrder.indexOf(currentTabId);
    const nextId = tabOrder[(idx + direction + tabOrder.length) % tabOrder.length];
    dispatch(setCurrentTab(nextId));
    window.electronAPI.switchTab(nextId);
  }, [dispatch]);

  const newTabToRight = useCallback(() => {
    const { currentTabId } = stateRef.current;
    if (!currentTabId) return;
    const st = stealthWindowRef.current;
    const id = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: currentTabId, id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const duplicateTab = useCallback(() => {
    const { currentTabId, tabs: tmap } = stateRef.current;
    if (!currentTabId || !tmap[currentTabId]) return;
    const t = tmap[currentTabId];
    const url = t.url || 'https://www.google.com/';
    const isStealth = !!t.isStealth;
    const newId = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: currentTabId, id: newId, isStealth, initialUrl: url }));
    window.electronAPI.newTab(newId, isStealth, url);
  }, [dispatch]);

  const toggleMuteSite = useCallback(() => {
    const { tabs: tmap, tabOrder: order, currentTabId: cur } = stateRef.current;
    if (!cur || !tmap[cur]) return;
    const host = hostnameFromUrl(tmap[cur].url);
    if (!host) return;
    const matching = order.filter((id) => hostnameFromUrl(tmap[id]?.url) === host);
    const anyUnmuted = matching.some((id) => !tmap[id]?.isAudioMuted);
    const muted = anyUnmuted;
    matching.forEach((id) => {
      dispatch(setTabAudioMuted({ id, muted }));
      if (!tmap[id]?.isSleeping && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(id, muted);
      }
    });
  }, [dispatch]);

  const togglePinTab = useCallback(() => {
    const { currentTabId: cur, tabs: tmap } = stateRef.current;
    if (!cur || !tmap[cur]) return;
    dispatch(setTabPinned({ id: cur, pinned: !tmap[cur].isPinned }));
  }, [dispatch]);

  const closeOtherTabs = useCallback(() => {
    const { currentTabId: cur, tabOrder: order } = stateRef.current;
    if (!cur) return;
    const toClose = order.filter((id) => id !== cur);
    toClose.forEach((id) => closeTab(id));
  }, [closeTab]);

  const closeTabsToTheRight = useCallback(() => {
    const { currentTabId: cur, tabOrder: order } = stateRef.current;
    if (!cur) return;
    const idx = order.indexOf(cur);
    if (idx === -1) return;
    const toClose = order.slice(idx + 1);
    toClose.forEach((id) => closeTab(id));
  }, [closeTab]);

  const newTabToTheRightOf = useCallback((afterId) => {
    if (!afterId) return;
    const st = stealthWindowRef.current;
    const id = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId, id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const duplicateTabFrom = useCallback((sourceId) => {
    const t = stateRef.current.tabs[sourceId];
    if (!t) return;
    const url = t.url || 'https://www.google.com/';
    const isStealth = !!t.isStealth;
    const newId = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: sourceId, id: newId, isStealth, initialUrl: url }));
    window.electronAPI.newTab(newId, isStealth, url);
  }, [dispatch]);

  const muteSiteForTab = useCallback((anchorTabId) => {
    const { tabs: tmap, tabOrder: order } = stateRef.current;
    const anchor = tmap[anchorTabId];
    if (!anchor) return;
    const host = hostnameFromUrl(anchor.url);
    if (!host) return;
    const matching = order.filter((tid) => hostnameFromUrl(tmap[tid]?.url) === host);
    const anyUnmuted = matching.some((tid) => !tmap[tid]?.isAudioMuted);
    const muted = anyUnmuted;
    matching.forEach((tid) => {
      dispatch(setTabAudioMuted({ id: tid, muted }));
      if (!tmap[tid]?.isSleeping && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(tid, muted);
      }
    });
  }, [dispatch]);

  const togglePinForTab = useCallback((tabId) => {
    const t = stateRef.current.tabs[tabId];
    if (!t) return;
    dispatch(setTabPinned({ id: tabId, pinned: !t.isPinned }));
  }, [dispatch]);

  const closeOtherTabsThan = useCallback((keepId) => {
    const { tabOrder: order } = stateRef.current;
    order.filter((id) => id !== keepId).forEach((id) => closeTab(id));
  }, [closeTab]);

  const closeTabsToTheRightOf = useCallback((boundaryId) => {
    const { tabOrder: order } = stateRef.current;
    const idx = order.indexOf(boundaryId);
    if (idx === -1) return;
    order.slice(idx + 1).forEach((id) => closeTab(id));
  }, [closeTab]);

  const moveTabToNewWindowFor = useCallback(async (tabId) => {
    const { tabOrder, currentTabId } = stateRef.current;
    const wasActive = currentTabId === tabId;
    let fallbackTabId = null;
    if (wasActive) {
      const idx = tabOrder.indexOf(tabId);
      const remaining = tabOrder.filter((tid) => tid !== tabId);
      fallbackTabId = remaining[idx] ?? remaining[idx - 1] ?? null;
    }
    const move = window.electronAPI.tabMoveToNewWindow;
    if (!move) return;
    const result = await move(tabId, fallbackTabId);
    if (!result?.ok) return;
    dispatch(removeTab(tabId));
    if (wasActive) {
      if (fallbackTabId) {
        dispatch(setCurrentTab(fallbackTabId));
      } else {
        closeCurrentShellWindow();
      }
    }
  }, [dispatch, closeCurrentShellWindow]);

  const handleTabMoveNewWindowShortcut = useCallback(() => {
    const id = stateRef.current.currentTabId;
    if (id) moveTabToNewWindowFor(id);
  }, [moveTabToNewWindowFor]);

  /** Serializable rows for main-process Menu.buildFromTemplate (ids allowlisted in main). */
  const buildTabStripContextMenuSpec = useCallback((targetId) => {
    const { tabs: tmap, tabOrder: order } = stateRef.current;
    const t = tmap[targetId];
    if (!t) return [];

    const host = hostnameFromUrl(t.url);
    let muteLabel = 'Mute Site';
    if (host) {
      const match = order.filter((tid) => hostnameFromUrl(tmap[tid]?.url) === host);
      if (match.length > 0 && match.every((tid) => tmap[tid]?.isAudioMuted)) {
        muteLabel = 'Unmute Site';
      }
    }
    const pinLabel = t.isPinned ? 'Unpin' : 'Pin';
    const stealthShell = stealthWindowRef.current;

    const splitGroup = t.splitPairId ? (stateRef.current.splitGroups[t.splitPairId] || Object.values(stateRef.current.splitGroups || {}).find(p => p.leftTabId === targetId || p.rightTabId === targetId)) : null;

    const splitItems = t.splitPairId ? [
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.SPLIT_SWITCH_SIDES, label: 'Switch Sides', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.SPLIT_TOGGLE_STACKED, label: splitGroup?.isStacked ? 'Show Side by Side' : 'Show Stacked', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.SPLIT_SEPARATE, label: 'Separate Tabs', enabled: true },
      { type: CONTEXT_MENU.TYPE_SEPARATOR },
    ] : [
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.ADD_TO_SPLIT, label: 'New in Split View', enabled: true },
      { type: CONTEXT_MENU.TYPE_SEPARATOR },
    ];

    const tabGroups = stateRef.current.tabGroups || {};
    const groupList = Object.values(tabGroups);

    // Grouping submenu: "Add tab to group"
    const addSubmenu = [
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.GROUP_NEW, label: 'New group', enabled: !t.isPinned },
    ];
    if (groupList.length > 0) {
      addSubmenu.push({ type: CONTEXT_MENU.TYPE_SEPARATOR });
      groupList.forEach((grp) => {
        const title = grp.title && grp.title.trim() ? grp.title : 'Untitled group';
        addSubmenu.push({
          type: CONTEXT_MENU.TYPE_ITEM,
          id: `groupAdd:${grp.id}`,
          label: title,
          enabled: !t.isPinned && t.groupId !== grp.id,
        });
      });
    }

    const groupItems = [
      {
        type: CONTEXT_MENU.TYPE_SUBMENU,
        label: 'Add tab to group',
        enabled: !t.isPinned,
        submenu: addSubmenu,
      },
    ];
    if (t.groupId) {
      groupItems.push({
        type: CONTEXT_MENU.TYPE_ITEM,
        id: TAB_STRIP_MENU.GROUP_REMOVE,
        label: 'Remove from group',
        enabled: true,
      });
      groupItems.push({
        type: CONTEXT_MENU.TYPE_ITEM,
        id: TAB_STRIP_MENU.GROUP_MOVE_NEW_WINDOW,
        label: 'Move group to new window',
        enabled: !stealthShell,
      });
    }
    groupItems.push({ type: CONTEXT_MENU.TYPE_SEPARATOR });

    return [
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.NEW_TAB_RIGHT, label: 'New Tab to the Right', enabled: true },
      ...groupItems,
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.MOVE_NEW_WINDOW, label: 'Move Tab to New Window', enabled: !stealthShell },
      ...splitItems,
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.RELOAD, label: 'Reload', enabled: !t.isSleeping },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.DUPLICATE, label: 'Duplicate', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.TOGGLE_PIN, label: pinLabel, enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.TOGGLE_MUTE_SITE, label: muteLabel, enabled: !!host },
      { type: CONTEXT_MENU.TYPE_SEPARATOR },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE, label: 'Close', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE_OTHERS, label: 'Close Other Tabs', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE_RIGHT, label: 'Close Tabs to the Right', enabled: true },
    ];
  }, []);

  const handleTabStripContextMenu = useCallback(async (e, tabId) => {
    e.preventDefault();
    const api = window.electronAPI;
    if (!api?.tabStripContextMenuShow) return;
    const items = buildTabStripContextMenuSpec(tabId);
    if (items.length === 0) return;
    try {
      await api.tabStripContextMenuShow({
        tabId,
        x: e.clientX,
        y: e.clientY,
        items,
      });
    } catch (err) {
      console.error('tabStripContextMenuShow', err);
    }
  }, [buildTabStripContextMenuSpec]);

  /**
   * Opens an internal invisurf:// page as a singleton tab (legacy stealth:// is still accepted in main).
   * If a tab with the given URL is already open, switches to it instead
   * of creating a duplicate — matching Chrome's behaviour for chrome:// pages.
   *
   * @param {string} navigateTo - The invisurf:// URL to navigate to (e.g. 'invisurf://History')
   * @param {string} canonicalUrl - The lowercase display URL stored in Redux (e.g. 'invisurf://history')
   */
  const openSingletonTab = useCallback((navigateTo, canonicalUrl) => {
    const { tabs, tabOrder } = stateRef.current;
    const existingId = tabOrder.find(id => isSameInternalPage(tabs[id]?.url, canonicalUrl));
    if (existingId) {
      dispatch(setCurrentTab(existingId));
      window.electronAPI.switchTab(existingId);
      return;
    }
    const st = stealthWindowRef.current;
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
    setTimeout(() => window.electronAPI.navigate(id, navigateTo), 50);
  }, [dispatch]);

  const handleOpenHistory = useCallback(() => {
    openSingletonTab(URL_C.HISTORY_NAVIGATE, URL_C.HISTORY_DISPLAY);
  }, [openSingletonTab]);

  const handleOpenBookmark = useCallback(() => {
    console.log("Opening Bookmarks")
    openSingletonTab(URL_C.BOOKMARK_NAVIGATE, URL_C.BOOKMARK_DISPLAY);
  }, [openSingletonTab]);

  const handleOpenDownloads = useCallback(() => {
    openSingletonTab(URL_C.DOWNLOADS_NAVIGATE, URL_C.DOWNLOADS_DISPLAY);
  }, [openSingletonTab]);

  const handleOpenExtensions = useCallback(() => {
    openSingletonTab(URL_C.EXTENSIONS_NAVIGATE, URL_C.EXTENSIONS_DISPLAY);
  }, [openSingletonTab]);

  const handleDeleteBrowsingData = useCallback(() => {
    const { tabs, tabOrder } = stateRef.current;
    const existingId = tabOrder.find(id => tabs[id]?.url === URL_C.HISTORY_DISPLAY);
    const targetUrl = `${URL_C.HISTORY_LOAD}#clearBrowsingData`;
    if (existingId) {
      dispatch(setCurrentTab(existingId));
      window.electronAPI.switchTab(existingId);
      window.electronAPI.navigate(existingId, targetUrl);
      return;
    }
    const st = stealthWindowRef.current;
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
    setTimeout(() => window.electronAPI.navigate(id, targetUrl), 50);
  }, [dispatch]);

  const paletteCommands = useMemo(
    () =>
      buildCommandPaletteCommands({
        platform: window.electronAPI?.platform || 'darwin',
        createTab,
        getCurrentTabId: () => stateRef.current.currentTabId,
        closeCurrentTab: () => {
          const id = stateRef.current.currentTabId;
          if (id) closeTab(id);
        },
        reload: () => {
          const id = stateRef.current.currentTabId;
          if (id) window.electronAPI.reload(id);
        },
        openHistory: handleOpenHistory,
        openBookmark: handleOpenBookmark,
        openDownloads: handleOpenDownloads,
        switchTabDir: handleSwitchTabDir,
        newTabToRight,
        duplicateTab,
        toggleMuteSite,
        togglePinTab,
        closeOtherTabs,
        closeTabsToTheRight,
        openTabSearch: () => {
          setCommandPaletteOpen(false);
          setSearchTabsOpen(true);
        },
        runMenuCommand: (id) => window.electronAPI.runMenuCommand(id),
        createStealthWindow: () => window.electronAPI.createStealthWindow?.(),
        createGhostWindow: () => window.electronAPI.createGhostWindow?.(),
        toggleGhostClickThrough: () => window.electronAPI.ghostToggleClickThrough?.(),
        isGhostWindow: isGhostShell,
      }),
    [
      isGhostShell,
      createTab,
      closeTab,
      handleOpenHistory,
      handleOpenBookmark,
      handleSwitchTabDir,
      newTabToRight,
      duplicateTab,
      toggleMuteSite,
      togglePinTab,
      closeOtherTabs,
      closeTabsToTheRight,
    ],
  );

  const handleOpenSettings = useCallback(() => {
    openSingletonTab(URL_C.SETTINGS_NAVIGATE, URL_C.SETTINGS_DISPLAY);
  }, [openSingletonTab]);

  const handleTabCreated = useCallback(({ id, url, isStealth, groupId, groupVisual }) => {
    console.log('handleTabCreated', id, url, isStealth);
    hasRegisteredTabRef.current = true;
    const { tabs, tabGroups } = stateRef.current;
    if (!tabs[id]) {
      if (groupId && groupVisual && !tabGroups?.[groupId]) {
        dispatch(setGroupVisuals({ groupId, ...groupVisual }));
      }
      dispatch(addTab({ id, isStealth, initialUrl: url, groupId: groupId || null }));
    }
  }, [dispatch]);

  const handleTabSwitched = useCallback((id) => {
    dispatch(setCurrentTab(id));
  }, [dispatch]);

  // Fired by main process when a sleeping tab's WebContentsView is created.
  const handleTabAwoken = useCallback((id) => {
    dispatch(wakeTab(id));
    setTimeout(() => {
      const t = stateRef.current.tabs[id];
      if (t?.isAudioMuted && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(id, true);
      }
    }, 0);
  }, [dispatch]);

  useEffect(() => {
    const handleCreateGroupForTabs = (e) => {
      const { tabIds, title, color } = e.detail || {};
      if (Array.isArray(tabIds) && tabIds.length > 0) {
        dispatch(createTabGroup({ tabIds, title, color }));
      }
    };
    window.addEventListener('invisurf:create-group-for-tabs', handleCreateGroupForTabs);
    return () => window.removeEventListener('invisurf:create-group-for-tabs', handleCreateGroupForTabs);
  }, [dispatch]);

  // ── Register all IPC listeners ───────────────────────────────────────────
  useEffect(() => {
    const unsub = window.electronAPI?.onTabStripContextMenuAction?.((data) => {
      const { tabId, id } = data || {};
      if (!tabId || !id) return;
      if (typeof id === 'string' && id.startsWith('groupAdd:')) {
        const gid = id.replace('groupAdd:', '');
        tabStripMenuHandlersRef.current?.handleGroupAdd?.(tabId, gid);
        return;
      }
      const fn = tabStripMenuHandlersRef.current[id];
      if (typeof fn === 'function') fn(tabId);
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  useToolbarFocusBridge();
  useGhostTitleBarInteractivity(isGhostShell);

  useElectronIPC({
    onNewTab: createTab,
    onTabCreated: handleTabCreated,
    onTabClosedExternal: handleTabClosedExternal,
    onTabSwitched: handleTabSwitched,
    onTabAwoken: handleTabAwoken,
    onCloseTab: () => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) closeTab(currentTabId);
    },
    onReload: () => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) window.electronAPI.reload(currentTabId);
    },
    onSwitchTabDir: handleSwitchTabDir,
    onHistory: handleOpenHistory,
    onBookmark: handleOpenBookmark,
    onDownloads: handleOpenDownloads,
    onSettings: handleOpenSettings,
    onTabNewToRight: newTabToRight,
    onTabDuplicate: duplicateTab,
    onTabMuteSite: toggleMuteSite,
    onTabPin: togglePinTab,
    onTabCloseOthers: closeOtherTabs,
    onTabCloseRight: closeTabsToTheRight,
    onTabMoveNewWindow: handleTabMoveNewWindowShortcut,
    onTabSearch: () => {
      setCommandPaletteOpen(false);
      setSearchTabsOpen(true);
    },
    onCommandPalette: () => {
      setSearchTabsOpen(false);
      setCommandPaletteOpen(true);
    },
  });

  // ── Initialise: load bookmarks then restore session ──────────────────────
  useEffect(() => {
    async function init() {
      const bootstrap = typeof window.__APP_BOOTSTRAP !== 'undefined' ? window.__APP_BOOTSTRAP : null;
      if (bootstrap?.stealthWindow) {
        stealthWindowRef.current = true;
      }
      if (bootstrap?.ghostWindow) {
        ghostWindowRef.current = true;
        setIsGhostShell(true);
      }

      // 1. Load bookmarks and settings in parallel
      const [bkData, settingsData] = await Promise.all([
        window.electronAPI.bookmarksGet(),
        window.electronAPI.settingsGet?.() || Promise.resolve({}),
      ]);
      dispatch(setBookmarks(bkData));
      if (settingsData?.searchEngine) setSearchEngine(settingsData.searchEngine);

      // 1.4 Bootstrap payload for detached tabs / groups from vertical drag
      if (bootstrap?.detachedGroup) {
        const { group, tabs: groupTabs, activeTabId } = bootstrap.detachedGroup;
        hasRegisteredTabRef.current = true;
        if (group?.id) {
          dispatch(setTabGroups({ [group.id]: { ...group } }));
        }
        if (Array.isArray(groupTabs)) {
          for (let i = 0; i < groupTabs.length; i++) {
            const t = groupTabs[i];
            dispatch(insertTabAt({
              index: i,
              id: t.id,
              url: t.url,
              title: t.title || 'New Tab',
              favicon: t.favicon || null,
              isLoading: !!t.isLoading,
              isStealth: !!t.isStealth,
              groupId: group.id,
            }));
          }
        }
        if (activeTabId) {
          dispatch(setCurrentTab(activeTabId));
        }
        return;
      }

      // 1.45 Bootstrap payload for "Move Group to New Window"
      if (bootstrap?.movedGroup) {
        const { group, tabs: groupTabs, activeTabId } = bootstrap.movedGroup;
        hasRegisteredTabRef.current = true;
        if (group?.id) {
          dispatch(setTabGroups({ [group.id]: { ...group } }));
        }
        if (Array.isArray(groupTabs) && groupTabs.length > 0) {
          const actId = activeTabId && groupTabs.some(t => t.id === activeTabId)
            ? activeTabId
            : groupTabs[0].id;

          const activeTabObj = groupTabs.find(t => t.id === actId) || groupTabs[0];

          for (let i = 0; i < groupTabs.length; i++) {
            const t = groupTabs[i];
            if (t.id === activeTabObj.id) {
              dispatch(addTab({
                id: t.id,
                isStealth: !!t.isStealth,
                initialUrl: t.url,
                groupId: group.id,
              }));
              window.electronAPI.newTab(t.id, !!t.isStealth, t.url);
            } else {
              dispatch(addSleepingTab({
                id: t.id,
                url: t.url,
                title: t.title || 'New Tab',
                favicon: t.favicon || null,
                isStealth: !!t.isStealth,
                groupId: group.id,
              }));
              window.electronAPI.tabSleepRegister?.(t.id, t.url);
            }
          }
          dispatch(setCurrentTab(activeTabObj.id));
        }
        return;
      }

      if (bootstrap?.detachedSplit) {
        const { splitPair, leftTab, rightTab } = bootstrap.detachedSplit;
        hasRegisteredTabRef.current = true;
        dispatch(insertSplitTabAt({
          index: 0,
          splitPair,
          leftTab,
          rightTab,
        }));
        return;
      }

      if (bootstrap?.detachedTab) {
        const { id, url, title, favicon, isLoading, isStealth } = bootstrap.detachedTab;
        hasRegisteredTabRef.current = true;
        dispatch(insertTabAt({
          index: 0,
          id,
          url,
          title: title || 'New Tab',
          favicon: favicon || null,
          isLoading: !!isLoading,
          isStealth: !!isStealth,
        }));
        return;
      }

      // 1.5 Bootstrap payload for windows created from "Move Tab to New Window".
      if (bootstrap?.movedTab?.url) {
        const movedTabId = `tab-${Date.now()}`;
        createTabWithUrl(movedTabId, !!bootstrap.movedTab.isStealth, bootstrap.movedTab.url, {
          history: bootstrap.movedTab.history || null,
        });
        return;
      }

      // 1.6 Bootstrap payload for windows spawned with a specific initial URL
      //     (e.g. "Open in new window" / "Open in stealth tab" from bookmark context menu).
      if (bootstrap?.initialUrl) {
        const isStealth = !!bootstrap.stealthWindow;
        const tabId = `tab-${Date.now()}`;
        createTabWithUrl(tabId, isStealth, bootstrap.initialUrl);
        return;
      }

      // 1.7 Bootstrap payload for "Open All (N) in new window / stealth window".
      //     Opens every URL as a separate tab; first URL becomes the active tab.
      if (Array.isArray(bootstrap?.initialUrls) && bootstrap.initialUrls.length > 0) {
        const isStealth = !!bootstrap.stealthWindow;
        const activeTabId = `tab-${Date.now()}-0`;
        // Create the first tab eagerly (active)
        createTabWithUrl(activeTabId, isStealth, bootstrap.initialUrls[0]);
        // Remaining tabs: open them as sleeping tabs so the window isn't flooded
        for (let i = 1; i < bootstrap.initialUrls.length; i++) {
          const tid = `tab-${Date.now()}-${i}`;
          dispatch(addSleepingTab({ id: tid, url: bootstrap.initialUrls[i], title: bootstrap.initialUrls[i], favicon: null }));
          window.electronAPI.tabSleepRegister(tid, bootstrap.initialUrls[i]);
        }
        return;
      }

      // 1.8 Dedicated stealth window fallback: one fresh private tab (session not restored).
      if (bootstrap?.stealthWindow) {
        createTab();
        return;
      }

      // 1.9 Bootstrap payload for Cmd/Ctrl+Shift+T closed-window restore.
      if (bootstrap?.restoreWindow?.tabs?.length) {
        const { tabs, activeTabId, tabGroups, splitGroups } = bootstrap.restoreWindow;
        if (tabGroups && typeof tabGroups === 'object') {
          dispatch(setTabGroups(tabGroups));
        }
        if (splitGroups && typeof splitGroups === 'object') {
          for (const [pairId, group] of Object.entries(splitGroups)) {
            if (tabs.some((t) => t.id === group.leftTabId) && tabs.some((t) => t.id === group.rightTabId)) {
              dispatch(setSplitGroup({ pairId, ...group }));
            }
          }
        }
        const activeId = activeTabId && tabs.some((t) => t.id === activeTabId)
          ? activeTabId
          : tabs[tabs.length - 1].id;

        for (const t of tabs) {
          if (t.id === activeId) {
            dispatch(addTab({
              id: t.id,
              isStealth: false,
              initialUrl: t.url,
              splitPairId: t.splitPairId || null,
              groupId: t.groupId || null,
            }));
            window.electronAPI.newTab(t.id, false, t.url, { history: t.history || null });
          } else {
            dispatch(addSleepingTab({
              id: t.id,
              url: t.url,
              title: t.title,
              favicon: t.favicon,
              splitPairId: t.splitPairId || null,
              groupId: t.groupId || null,
            }));
            window.electronAPI.tabSleepRegister(t.id, t.url, {
              title: t.title,
              favicon: t.favicon,
              history: t.history || null,
            });
          }
        }

        if (tabGroups && typeof tabGroups === 'object') {
          dispatch(setTabGroups(tabGroups));
        }

        setTimeout(() => {
          dispatch(setCurrentTab(activeId));
          window.electronAPI.switchTab(activeId);
        }, 0);
        return;
      }

      // 2. Restore session
      let session = null;
      if (window.electronAPI.sessionLoad) {
        session = await window.electronAPI.sessionLoad();
      }

      // A user-created tab arrived while initialization was awaiting IPC. Do
      // not append the default/restored tab after it.
      if (hasRegisteredTabRef.current) return;

      if (session?.tabs?.length > 0) {
        const splitGroupsToRestore = session.splitGroups || {};
        const tabGroupsToRestore = session.tabGroups || {};
        if (tabGroupsToRestore && Object.keys(tabGroupsToRestore).length > 0) {
          dispatch(setTabGroups(tabGroupsToRestore));
        }
        const activeId = session.activeTabId && session.tabs.some(t => t.id === session.activeTabId)
          ? session.activeTabId
          : session.tabs[session.tabs.length - 1].id;

        let activeSplitPair = null;
        for (const group of Object.values(splitGroupsToRestore)) {
          if (group.leftTabId === activeId || group.rightTabId === activeId) {
            activeSplitPair = group;
            break;
          }
        }

        for (const t of session.tabs) {
          const isEager = t.id === activeId || (activeSplitPair && (t.id === activeSplitPair.leftTabId || t.id === activeSplitPair.rightTabId));
          if (isEager) {
            // Active tab or companion split view: create the WebContentsView and load its URL eagerly.
            dispatch(addTab({
              id: t.id,
              isStealth: false,
              initialUrl: t.url,
              splitPairId: t.splitPairId || null,
              groupId: t.groupId || null,
            }));
            window.electronAPI.newTab(t.id, false, t.url);
          } else {
            // Inactive tabs: add to the tab strip using cached metadata only.
            // No WebContentsView is created; it will be created on first activation.
            dispatch(addSleepingTab({
              id: t.id,
              url: t.url,
              title: t.title,
              favicon: t.favicon,
              splitPairId: t.splitPairId || null,
              groupId: t.groupId || null,
            }));
            window.electronAPI.tabSleepRegister(t.id, t.url);
          }
        }

        for (const [pairId, group] of Object.entries(splitGroupsToRestore)) {
          if (session.tabs.some(t => t.id === group.leftTabId) && session.tabs.some(t => t.id === group.rightTabId)) {
            dispatch(setSplitGroup({ pairId, ...group }));
          }
        }

        if (tabGroupsToRestore && Object.keys(tabGroupsToRestore).length > 0) {
          dispatch(setTabGroups(tabGroupsToRestore));
        }

        // Give React a tick to render the tab strip before switching.
        setTimeout(() => {
          dispatch(setCurrentTab(activeId));
          window.electronAPI.switchTab(activeId);
          if (activeSplitPair && window.electronAPI.splitTabEnter) {
            window.electronAPI.splitTabEnter(activeSplitPair.leftTabId, activeSplitPair.rightTabId);
          }
        }, 0);
      } else {
        createTab();
      }
    }
    init();
  }, [dispatch, createTab, createTabWithUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!window.electronAPI?.onBookmarksUpdated) return undefined;
    const unsub = window.electronAPI.onBookmarksUpdated(async () => {
      try {
        const updated = await window.electronAPI.bookmarksGet();
        if (updated) {
          dispatch(setBookmarks(updated));
        }
      } catch (err) {
        console.error('[App] Failed to refresh bookmarks after update:', err);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [dispatch]);

  tabStripMenuHandlersRef.current = {
    [TAB_STRIP_MENU.NEW_TAB_RIGHT]: newTabToTheRightOf,
    [TAB_STRIP_MENU.MOVE_NEW_WINDOW]: moveTabToNewWindowFor,
    [TAB_STRIP_MENU.RELOAD]: (tid) => window.electronAPI.reload(tid),
    [TAB_STRIP_MENU.DUPLICATE]: duplicateTabFrom,
    [TAB_STRIP_MENU.TOGGLE_PIN]: togglePinForTab,
    [TAB_STRIP_MENU.TOGGLE_MUTE_SITE]: muteSiteForTab,
    [TAB_STRIP_MENU.CLOSE]: closeTab,
    [TAB_STRIP_MENU.CLOSE_OTHERS]: closeOtherTabsThan,
    [TAB_STRIP_MENU.CLOSE_RIGHT]: closeTabsToTheRightOf,
    [TAB_STRIP_MENU.ADD_TO_SPLIT]: (tid) => {
      window.electronAPI?.splitTabEnter?.(tid, 'choose-tab');
    },
    [TAB_STRIP_MENU.SPLIT_SWITCH_SIDES]: (tid) => {
      const pid = stateRef.current.tabs[tid]?.splitPairId
        || Object.values(stateRef.current.splitGroups || {}).find(p => p.leftTabId === tid || p.rightTabId === tid)?.id;
      if (pid) {
        dispatch(swapSplitSides(pid));
        window.electronAPI?.splitTabSwapSides?.(pid);
      }
    },
    [TAB_STRIP_MENU.SPLIT_TOGGLE_STACKED]: (tid) => {
      const pid = stateRef.current.tabs[tid]?.splitPairId
        || Object.values(stateRef.current.splitGroups || {}).find(p => p.leftTabId === tid || p.rightTabId === tid)?.id;
      if (pid) {
        dispatch(toggleSplitStacked(pid));
        window.electronAPI?.splitTabToggleStacked?.(pid);
      }
    },
    [TAB_STRIP_MENU.SPLIT_SEPARATE]: (tid) => {
      const pid = stateRef.current.tabs[tid]?.splitPairId
        || Object.values(stateRef.current.splitGroups || {}).find(p => p.leftTabId === tid || p.rightTabId === tid)?.id;
      if (pid) window.electronAPI?.splitTabExit?.(pid);
      else if (tid) window.electronAPI?.splitTabExit?.(tid);
    },
    [TAB_STRIP_MENU.GROUP_NEW]: (tid) => {
      dispatch(createTabGroup({ tabIds: [tid] }));
      setTimeout(() => {
        const updatedGroups = stateRef.current.tabGroups || {};
        const targetTab = stateRef.current.tabs[tid];
        if (targetTab?.groupId && updatedGroups[targetTab.groupId]) {
          window.dispatchEvent(new CustomEvent('invisurf:open-group-editor', {
            detail: { groupId: targetTab.groupId }
          }));
        }
      }, 60);
    },
    [TAB_STRIP_MENU.GROUP_REMOVE]: (tid) => {
      dispatch(removeTabsFromGroup({ tabIds: [tid] }));
    },
    [TAB_STRIP_MENU.GROUP_MOVE_NEW_WINDOW]: (tid) => {
      const gid = stateRef.current.tabs[tid]?.groupId;
      if (!gid) return;
      const group = stateRef.current.tabGroups?.[gid];
      const toMove = stateRef.current.tabOrder.filter((id) => stateRef.current.tabs[id]?.groupId === gid);
      if (group && toMove.length > 0 && window.electronAPI?.createWindow) {
        const memberTabsData = toMove.map((id) => {
          const tabObj = stateRef.current.tabs[id];
          return {
            id,
            url: tabObj?.url || '',
            title: tabObj?.title || 'New Tab',
            favicon: tabObj?.favicon || null,
            isStealth: !!tabObj?.isStealth,
          };
        });
        const curId = stateRef.current.currentTabId;
        const activeTabId = toMove.includes(curId) ? curId : toMove[0];

        window.electronAPI.createWindow({
          group: { ...group },
          tabs: memberTabsData,
          activeTabId,
        });
        toMove.forEach((id) => closeTab(id));
      }
    },
    handleGroupAdd: (tid, gid) => {
      dispatch(addTabsToGroup({ tabIds: [tid], groupId: gid }));
    },
  };

  useEffect(() => {
    const unsubToggle = window.electronAPI?.onSidePanelToggle?.(() => {
      dispatch(toggleSidePanel());
    });
    const unsubState = window.electronAPI?.onSidePanelStateChanged?.((state) => {
      if (!state) return;
      if (typeof state.isOpen === 'boolean') {
        dispatch(setSidePanelOpen(state.isOpen));
      }
      if (state.activePanelId) {
        dispatch(setSidePanelActiveView(state.activePanelId));
      }
      if (state.width) {
        dispatch(setSidePanelWidth(state.width));
      }
      if (typeof state.customUrl !== 'undefined') {
        dispatch(setSidePanelCustomUrl(state.customUrl));
      }
    });
    return () => {
      if (typeof unsubToggle === 'function') unsubToggle();
      if (typeof unsubState === 'function') unsubState();
    };
  }, [dispatch]);

  useEffect(() => {
    if (!window.electronAPI?.onSplitTabUpdated) return;
    const unsub = window.electronAPI.onSplitTabUpdated(({ splitId, pair, removed }) => {
      if (removed && splitId) {
        dispatch(removeSplitGroup(splitId));
      } else if (pair && pair.id) {
        dispatch(setSplitGroup({ splitId: pair.id, pair }));
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [dispatch]);

  // Handle cross-window tab reattaching / docking
  useEffect(() => {
    const unsubReattach = window.electronAPI?.onTabReattached?.((payload) => {
      const { tab, splitPair, leftTab, rightTab, group, tabs: groupTabs, screenX } = payload || {};

      // Handle reattaching a whole tab group from another window
      if (group && Array.isArray(groupTabs) && groupTabs.length > 0) {
        const { tabOrder } = stateRef.current;
        const container = document.querySelector('.tab-container');
        const containerRect = container?.getBoundingClientRect();
        let insertIndex = tabOrder.length;
        if (containerRect) {
          const windowLeft = window.screenX || 0;
          const relativeX = (Number(screenX) - windowLeft) - containerRect.left;
          const tabEls = Array.from(container.querySelectorAll('.tab'));
          for (let i = 0; i < tabEls.length; i++) {
            const r = tabEls[i].getBoundingClientRect();
            const tabCenter = (r.left - containerRect.left) + r.width / 2;
            if (relativeX < tabCenter) {
              insertIndex = i;
              break;
            }
          }
        }

        dispatch(reattachTabGroup({
          group,
          tabs: groupTabs,
          insertIndex,
        }));
        return;
      }

      if (splitPair && leftTab?.id) {
        const { tabOrder, tabs } = stateRef.current;
        if (tabs[leftTab.id]) return;

        const container = document.querySelector('.tab-container');
        const containerRect = container?.getBoundingClientRect();
        let insertIndex = tabOrder.length;
        if (containerRect) {
          const windowLeft = window.screenX || 0;
          const relativeX = (Number(screenX) - windowLeft) - containerRect.left;
          const tabEls = Array.from(container.querySelectorAll('.tab'));
          for (let i = 0; i < tabEls.length; i++) {
            const r = tabEls[i].getBoundingClientRect();
            const tabCenter = (r.left - containerRect.left) + r.width / 2;
            if (relativeX < tabCenter) {
              insertIndex = i;
              break;
            }
          }
        }

        // Check if reattaching into an expanded group's area
        const clientX = (Number(screenX) - (window.screenX || 0));
        let targetGroupId = null;
        const expandedChips = Array.from(document.querySelectorAll('.group-chip-wrapper:not(.group-chip-wrapper--collapsed)'));
        for (const chipWrapper of expandedChips) {
          const gid = chipWrapper.getAttribute('data-group-id') || chipWrapper.querySelector('.group-chip')?.getAttribute('data-group-id');
          if (!gid) continue;
          const memberTabs = Array.from(document.querySelectorAll(`.tab[data-group-id="${gid}"]`));
          if (memberTabs.length === 0) continue;
          const chipRect = chipWrapper.getBoundingClientRect();
          const firstMemberRect = memberTabs[0].getBoundingClientRect();
          const lastMemberRect = memberTabs[memberTabs.length - 1].getBoundingClientRect();
          const groupLeft = Math.min(chipRect.left, firstMemberRect.left);
          const groupRight = lastMemberRect.right + 20;
          if (clientX >= groupLeft - 10 && clientX <= groupRight) {
            targetGroupId = gid;
            break;
          }
        }

        const candidateGid = leftTab?.groupId || splitPair?.groupId;
        if (!targetGroupId && candidateGid && stateRef.current.tabGroups?.[candidateGid]) {
          targetGroupId = candidateGid;
        }

        if (!targetGroupId && insertIndex > 0) {
          const prevGid = tabs[tabOrder[insertIndex - 1]]?.groupId;
          const nextGid = insertIndex < tabOrder.length ? tabs[tabOrder[insertIndex]]?.groupId : null;
          if (prevGid && (prevGid === nextGid || prevGid === candidateGid)) {
            targetGroupId = prevGid;
          } else if (nextGid && nextGid === candidateGid) {
            targetGroupId = nextGid;
          }
        }

        dispatch(insertSplitTabAt({
          index: insertIndex,
          splitPair,
          leftTab,
          rightTab,
          groupId: targetGroupId,
        }));
        return;
      }

      if (!tab?.id) return;
      const { tabOrder, tabs } = stateRef.current;
      if (tabs[tab.id]) return;

      const container = document.querySelector('.tab-container');
      const containerRect = container?.getBoundingClientRect();
      let insertIndex = tabOrder.length;
      if (containerRect) {
        const windowLeft = window.screenX || 0;
        const relativeX = (Number(screenX) - windowLeft) - containerRect.left;
        const tabEls = Array.from(container.querySelectorAll('.tab'));
        for (let i = 0; i < tabEls.length; i++) {
          const r = tabEls[i].getBoundingClientRect();
          const tabCenter = (r.left - containerRect.left) + r.width / 2;
          if (relativeX < tabCenter) {
            insertIndex = i;
            break;
          }
        }
      }

      // Check if reattaching into an expanded group's area
      const clientX = (Number(screenX) - (window.screenX || 0));
      let targetGroupId = null;
      const expandedChips = Array.from(document.querySelectorAll('.group-chip-wrapper:not(.group-chip-wrapper--collapsed)'));
      for (const chipWrapper of expandedChips) {
        const gid = chipWrapper.getAttribute('data-group-id') || chipWrapper.querySelector('.group-chip')?.getAttribute('data-group-id');
        if (!gid) continue;
        const memberTabs = Array.from(document.querySelectorAll(`.tab[data-group-id="${gid}"]`));
        if (memberTabs.length === 0) continue;
        const chipRect = chipWrapper.getBoundingClientRect();
        const firstMemberRect = memberTabs[0].getBoundingClientRect();
        const lastMemberRect = memberTabs[memberTabs.length - 1].getBoundingClientRect();
        const groupLeft = Math.min(chipRect.left, firstMemberRect.left);
        const groupRight = lastMemberRect.right + 20;
        if (clientX >= groupLeft - 10 && clientX <= groupRight) {
          targetGroupId = gid;
          break;
        }
      }

      const candidateGid = tab.groupId;
      if (!targetGroupId && candidateGid && stateRef.current.tabGroups?.[candidateGid]) {
        targetGroupId = candidateGid;
      }

      if (!targetGroupId && insertIndex > 0) {
        const prevGid = tabs[tabOrder[insertIndex - 1]]?.groupId;
        const nextGid = insertIndex < tabOrder.length ? tabs[tabOrder[insertIndex]]?.groupId : null;
        if (prevGid && (prevGid === nextGid || prevGid === candidateGid)) {
          targetGroupId = prevGid;
        } else if (nextGid && nextGid === candidateGid) {
          targetGroupId = nextGid;
        }
      }

      dispatch(insertTabAt({
        index: insertIndex,
        id: tab.id,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon || null,
        isLoading: !!tab.isLoading,
        isStealth: !!tab.isStealth,
        groupId: targetGroupId,
      }));
      dispatch(setCurrentTab(tab.id));
    });

    return () => {
      if (typeof unsubReattach === 'function') unsubReattach();
    };
  }, [dispatch]);

  return (
    <>
      <div className={`header${isStealthShell ? ' header--stealth-window' : ''}${isGhostShell ? ' header--ghost-window' : ''}`}>
        <TabBar
          isGhostWindow={isGhostShell}
          onNewTab={createTab}
          onCloseTab={closeTab}
          onSwitchTab={switchTab}
          onDragEnd={handleDragEnd}
          onDetachTab={handleDetachTab}
          onTabStripContextMenu={handleTabStripContextMenu}
        />
        <NavBar
          currentTabId={currentTabId}
          onNewTab={createTab}
          onOpenHistory={handleOpenHistory}
          onOpenBookmark={handleOpenBookmark}
          onOpenDownloads={handleOpenDownloads}
          onOpenExtensions={handleOpenExtensions}
          onDeleteBrowsingData={handleDeleteBrowsingData}
          onOpenSettings={handleOpenSettings}
          searchEngine={searchEngine}
        />
        <BookmarkBar currentTabId={currentTabId} />
        <ScreenShareBanner currentTabId={currentTabId} />
      </div>
      <SidePanel />
      <SplitDivider />
      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={paletteCommands}
      />
      <SearchTabsModal
        open={searchTabsOpen}
        onClose={() => setSearchTabsOpen(false)}
        tabOrder={tabOrder}
        tabs={tabs}
        currentTabId={currentTabId}
        onSelectTab={(id) => {
          dispatch(setCurrentTab(id));
          window.electronAPI.switchTab(id);
        }}
        onCloseTab={closeTab}
      />
    </>
  );
}

export default function App() {
  return (
    <TabOverlayProvider>
      <ChromeOverlayProvider>
        <AppShell />
      </ChromeOverlayProvider>
    </TabOverlayProvider>
  );
}
