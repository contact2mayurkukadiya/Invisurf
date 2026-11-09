import { createSlice } from '@reduxjs/toolkit';
import { URL as URL_C } from '../constants/conditionStrings.js';
import {
  createGroup as modelCreateGroup,
  addToGroup as modelAddToGroup,
  removeFromGroup as modelRemoveFromGroup,
  ungroup as modelUngroup,
  moveGroup as modelMoveGroup,
  toggleCollapse as modelToggleCollapse,
  repairInvariants,
  reconcileTabOrderAfterDrag,
} from '../utils/tabGroupModel.js';

// Empty URL in Redux means “new tab” — main.js resolves to newtab.html on load.
const NTP_URL = '';

/**
 * Returns true when a URL represents the custom New Tab Page.
 * Covers empty sentinel, legacy app://newtab, and resolved app://localhost paths.
 */
function isNtpUrl(url) {
  if (!url || !String(url).trim()) return true;
  const lower = url.toLowerCase();
  return lower === URL_C.NTP_DISPLAY || lower.startsWith(URL_C.NTP_LOCALHOST_PREFIX);
}

function tabChromeDefaults() {
  return {
    isPinned: false,
    isAudioMuted: false,
    zoomFactor: 1.0,
    lastActiveAt: Date.now(),
    splitPairId: null,
    groupId: null,
  };
}

/** All pinned tabs first (left), then unpinned; preserves relative order within each group. */
function applyPinnedLeadingOrder(state) {
  const pinned = state.tabOrder.filter(tid => state.tabs[tid]?.isPinned);
  const unpinned = state.tabOrder.filter(tid => !state.tabs[tid]?.isPinned);
  state.tabOrder = [...pinned, ...unpinned];
}

/** Updates Most Recently Used (MRU) activation order with id at index 0 */
function touchMruTab(state, id) {
  if (!id) return;
  state.mruOrder = [id, ...(state.mruOrder || []).filter(tid => tid !== id && state.tabs[tid])];
}

function getCompanionTabIds(state, tabIds) {
  if (!Array.isArray(tabIds)) return [];
  const result = new Set(tabIds);
  for (const tid of tabIds) {
    const pairId = state.tabs[tid]?.splitPairId;
    if (pairId && state.splitGroups?.[pairId]) {
      const pair = state.splitGroups[pairId];
      if (pair.leftTabId) result.add(pair.leftTabId);
      if (pair.rightTabId) result.add(pair.rightTabId);
    }
  }
  return Array.from(result);
}

const getInitialPinnedPanels = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('invisurf:pinned-sidepanels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter(id => id !== 'lens');
          if (cleaned.length !== parsed.length) {
            window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(cleaned));
          }
          return cleaned;
        }
      }
    }
  } catch (_) {}
  return [];
};

export const DEFAULT_TOOLBAR_CONFIG = Object.freeze({
  home: false,
  forward: true,
  splitView: false,
  newIncognito: false,
  newGhost: false,
  bookmarks: false,
  readingList: false,
  history: false,
  downloads: true,
  deleteBrowsingData: false,
  print: false,
  lens: false,
  devTools: false,
  arrangeWindow: true,
  transparency: true,
});

const getInitialToolbarConfig = () => {
  const initialPinned = getInitialPinnedPanels();
  return {
    ...DEFAULT_TOOLBAR_CONFIG,
    bookmarks: initialPinned.includes('bookmarks'),
    readingList: initialPinned.includes('reading-list'),
    history: initialPinned.includes('history'),
  };
};

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    tabs: {},
    tabOrder: [],
    mruOrder: [],
    currentTabId: null,
    tabGroups: {}, // { [groupId]: { id, title, color, collapsed } }
    splitGroups: {}, // { [splitId]: { id, leftTabId, rightTabId, ratio: 0.5, focusedSide: 'left' } }
    searchEngine: 'google',
    showBookmarkBar: true,
    toolbarConfig: getInitialToolbarConfig(),
    sidePanel: {
      isOpen: false,
      width: 360,
      activePanelId: 'reading-list',
      customUrl: null,
      pinnedPanelIds: getInitialPinnedPanels(),
    },
    screenShare: {
      active: false,
      sourceKind: 'tab',
      sharedTabId: null,
      sharedHost: '',
      sharedTitle: '',
      requestingTabId: null,
      requestingHost: '',
      surfaceSwitching: 'include',
      state: 'idle',
    },
  },
  reducers: {
    toggleSidePanel(state) {
      state.sidePanel.isOpen = !state.sidePanel.isOpen;
    },
    setSidePanelOpen(state, action) {
      state.sidePanel.isOpen = !!action.payload;
    },
    setScreenShareStatus(state, action) {
      const payload = action.payload || {};
      state.screenShare = {
        active: !!payload.active,
        sourceKind: payload.sourceKind || 'tab',
        sharedTabId: payload.sharedTabId || null,
        sharedHost: payload.sharedHost || '',
        sharedTitle: payload.sharedTitle || '',
        requestingTabId: payload.requestingTabId || null,
        requestingHost: payload.requestingHost || '',
        surfaceSwitching: payload.surfaceSwitching || 'include',
        state: payload.state || (payload.active ? 'active' : 'idle'),
      };
    },
    setSidePanelWidth(state, action) {
      state.sidePanel.width = Math.max(260, Number(action.payload) || 360);
    },
    setSidePanelActiveView(state, action) {
      state.sidePanel.activePanelId = action.payload;
    },
    setSidePanelCustomUrl(state, action) {
      state.sidePanel.customUrl = action.payload;
    },
    togglePinSidePanel(state, action) {
      const panelId = action.payload;
      if (panelId === 'lens') return;
      if (!Array.isArray(state.sidePanel.pinnedPanelIds)) {
        state.sidePanel.pinnedPanelIds = [];
      }
      const idx = state.sidePanel.pinnedPanelIds.indexOf(panelId);
      if (idx >= 0) {
        state.sidePanel.pinnedPanelIds.splice(idx, 1);
      } else {
        state.sidePanel.pinnedPanelIds.push(panelId);
      }
      state.sidePanel.pinnedPanelIds = state.sidePanel.pinnedPanelIds.filter(id => id !== 'lens');
      if (!state.toolbarConfig) {
        state.toolbarConfig = { ...DEFAULT_TOOLBAR_CONFIG };
      }
      if (panelId === 'bookmarks') {
        state.toolbarConfig.bookmarks = state.sidePanel.pinnedPanelIds.includes('bookmarks');
      } else if (panelId === 'reading-list') {
        state.toolbarConfig.readingList = state.sidePanel.pinnedPanelIds.includes('reading-list');
      } else if (panelId === 'history') {
        state.toolbarConfig.history = state.sidePanel.pinnedPanelIds.includes('history');
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    setPinnedPanels(state, action) {
      state.sidePanel.pinnedPanelIds = (Array.isArray(action.payload) ? action.payload : []).filter(id => id !== 'lens');
      if (!state.toolbarConfig) {
        state.toolbarConfig = { ...DEFAULT_TOOLBAR_CONFIG };
      }
      state.toolbarConfig.bookmarks = state.sidePanel.pinnedPanelIds.includes('bookmarks');
      state.toolbarConfig.readingList = state.sidePanel.pinnedPanelIds.includes('reading-list');
      state.toolbarConfig.history = state.sidePanel.pinnedPanelIds.includes('history');
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    setToolbarConfig(state, action) {
      const incoming = action.payload && typeof action.payload === 'object' ? action.payload : {};
      state.toolbarConfig = {
        ...DEFAULT_TOOLBAR_CONFIG,
        ...(state.toolbarConfig || {}),
        ...incoming,
      };
      const pinned = new Set(Array.isArray(state.sidePanel.pinnedPanelIds) ? state.sidePanel.pinnedPanelIds : []);
      if (state.toolbarConfig.bookmarks) pinned.add('bookmarks'); else pinned.delete('bookmarks');
      if (state.toolbarConfig.readingList) pinned.add('reading-list'); else pinned.delete('reading-list');
      if (state.toolbarConfig.history) pinned.add('history'); else pinned.delete('history');
      pinned.delete('lens');
      state.sidePanel.pinnedPanelIds = Array.from(pinned);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    setToolbarConfigItem(state, action) {
      const { key, value } = action.payload || {};
      if (!key) return;
      if (!state.toolbarConfig) {
        state.toolbarConfig = { ...DEFAULT_TOOLBAR_CONFIG };
      }
      state.toolbarConfig[key] = !!value;
      const pinned = new Set(Array.isArray(state.sidePanel.pinnedPanelIds) ? state.sidePanel.pinnedPanelIds : []);
      if (key === 'bookmarks') {
        if (value) pinned.add('bookmarks'); else pinned.delete('bookmarks');
      } else if (key === 'readingList') {
        if (value) pinned.add('reading-list'); else pinned.delete('reading-list');
      } else if (key === 'history') {
        if (value) pinned.add('history'); else pinned.delete('history');
      }
      pinned.delete('lens');
      state.sidePanel.pinnedPanelIds = Array.from(pinned);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    resetToolbarConfig(state) {
      state.toolbarConfig = { ...DEFAULT_TOOLBAR_CONFIG };
      state.sidePanel.pinnedPanelIds = [];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    setShowBookmarkBar(state, action) {
      state.showBookmarkBar = action.payload;
    },
    setSearchEngine(state, action) {
      state.searchEngine = action.payload;
    },
    addTab(state, action) {
      const { id, isStealth = false, initialUrl = null, groupId = null } = action.payload;
      const url = initialUrl || NTP_URL;
      const existingSplitPair = Object.values(state.splitGroups || {}).find(
        (p) => p.leftTabId === id || p.rightTabId === id
      );
      const safeGroupId = groupId || null;
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isNtpUrl(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
        ...tabChromeDefaults(),
        splitPairId: existingSplitPair ? existingSplitPair.id : null,
        groupId: safeGroupId,
      };
      if (!state.tabOrder.includes(id)) {
        if (existingSplitPair && existingSplitPair.rightTabId === id && state.tabOrder.includes(existingSplitPair.leftTabId)) {
          const leftIdx = state.tabOrder.indexOf(existingSplitPair.leftTabId);
          state.tabOrder.splice(leftIdx + 1, 0, id);
        } else {
          state.tabOrder.push(id);
        }
      }
      if (!existingSplitPair || existingSplitPair.focusedSide === (existingSplitPair.leftTabId === id ? 'left' : 'right')) {
        state.currentTabId = id;
        touchMruTab(state, id);
      }
      applyPinnedLeadingOrder(state);
    },

    /**
     * Inserts a new tab immediately after `afterId` in tabOrder and focuses it.
     */
    insertTabAfter(state, action) {
      const { afterId, id, isStealth = false, initialUrl = null, groupId = null } = action.payload;
      const url = initialUrl || NTP_URL;
      const afterIdx = state.tabOrder.indexOf(afterId);
      const targetGid = groupId || (afterId ? state.tabs[afterId]?.groupId : null) || null;
      const safeGroupId = (targetGid && state.tabGroups?.[targetGid]) ? targetGid : null;
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isNtpUrl(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
        ...tabChromeDefaults(),
        groupId: safeGroupId,
      };
      if (afterIdx === -1) {
        state.tabOrder.push(id);
      } else {
        state.tabOrder.splice(afterIdx + 1, 0, id);
      }
      state.currentTabId = id;
      touchMruTab(state, id);
      if (safeGroupId && state.tabGroups?.[safeGroupId]?.collapsed) {
        state.tabGroups[safeGroupId].collapsed = false;
      }
      applyPinnedLeadingOrder(state);
    },

    /**
     * Inserts a tab at a specific index in tabOrder and activates it.
     */
    insertTabAt(state, action) {
      const { index, id, url, title, favicon, isStealth = false, isLoading = false, groupId = null } = action.payload;
      const resolvedUrl = url || NTP_URL;
      const existingFavicon = state.tabs[id]?.favicon || null;
      const safeGroupId = groupId || null;
      state.tabs[id] = {
        url: resolvedUrl,
        title: title || 'New Tab',
        favicon: favicon || existingFavicon,
        isNewTab: isNtpUrl(resolvedUrl),
        isStealth: !!isStealth,
        isLoading: !!isLoading,
        isSleeping: false,
        ...tabChromeDefaults(),
        groupId: safeGroupId,
      };
      if (state.tabOrder.includes(id)) {
        state.tabOrder = state.tabOrder.filter((tid) => tid !== id);
      }
      const safeIdx = Math.max(0, Math.min(state.tabOrder.length, Number(index) ?? state.tabOrder.length));
      state.tabOrder.splice(safeIdx, 0, id);
      state.currentTabId = id;
      touchMruTab(state, id);
      if (safeGroupId && state.tabGroups?.[safeGroupId]?.collapsed) {
        state.tabGroups[safeGroupId].collapsed = false;
      }
      applyPinnedLeadingOrder(state);
    },

    /**
     * Registers a session-restored tab as sleeping: the tab strip shows the
     * saved title/favicon immediately, but no WebContentsView is created until
     * the user first activates the tab.
     */
    addSleepingTab(state, action) {
      const { id, url, title, favicon, isStealth = false, groupId = null } = action.payload;
      const resolvedUrl = url || NTP_URL;
      const safeGroupId = groupId || null;
      state.tabs[id] = {
        url: resolvedUrl,
        title: title || 'New Tab',
        favicon: favicon || null,
        isNewTab: isNtpUrl(resolvedUrl),
        isStealth,
        isLoading: false,
        isSleeping: true,
        ...tabChromeDefaults(),
        groupId: safeGroupId,
      };
      state.tabOrder.push(id);
      // currentTabId is intentionally NOT set — the active tab is handled separately.
    },

    /**
     * Clears the isSleeping flag once the main process has created the
     * WebContentsView for this tab (triggered by tab:awoken IPC event).
     */
    wakeTab(state, action) {
      const id = action.payload;
      if (state.tabs[id]) state.tabs[id].isSleeping = false;
    },

    removeTab(state, action) {
      const id = action.payload;
      const tab = state.tabs[id];
      const gid = tab?.groupId;
      if (tab?.splitPairId) {
        const pair = state.splitGroups[tab.splitPairId];
        if (pair) {
          const otherId = pair.leftTabId === id ? pair.rightTabId : pair.leftTabId;
          if (state.tabs[otherId]) state.tabs[otherId].splitPairId = null;
          delete state.splitGroups[tab.splitPairId];
        }
      }
      delete state.tabs[id];
      state.tabOrder = state.tabOrder.filter(tid => tid !== id);
      state.mruOrder = (state.mruOrder || []).filter(tid => tid !== id);
      if (gid && state.tabGroups?.[gid]) {
        const hasRemaining = state.tabOrder.some(tid => state.tabs[tid]?.groupId === gid);
        if (!hasRemaining) {
          delete state.tabGroups[gid];
        }
      }
    },

    /**
     * Detaches an entire split tab (both tabs and split pair) cleanly from state
     * without un-merging or leaving an orphaned tab behind.
     */
    detachSplitTab(state, action) {
      const splitId = action.payload;
      let pair = state.splitGroups[splitId];
      if (!pair) {
        pair = Object.values(state.splitGroups || {}).find(
          (p) => p.id === splitId || p.leftTabId === splitId || p.rightTabId === splitId
        );
      }
      if (!pair) return;
      const { leftTabId, rightTabId, id } = pair;
      delete state.splitGroups[id];
      if (leftTabId) {
        delete state.tabs[leftTabId];
        state.tabOrder = state.tabOrder.filter(tid => tid !== leftTabId);
        state.mruOrder = (state.mruOrder || []).filter(tid => tid !== leftTabId);
      }
      if (rightTabId) {
        delete state.tabs[rightTabId];
        state.tabOrder = state.tabOrder.filter(tid => tid !== rightTabId);
        state.mruOrder = (state.mruOrder || []).filter(tid => tid !== rightTabId);
      }
    },

    /**
     * Inserts an entire split tab (both tabs and splitPair configuration)
     * at a specific position in tabOrder.
     */
    insertSplitTabAt(state, action) {
      const { index, splitPair, leftTab, rightTab, groupId = null } = action.payload || {};
      if (!splitPair || !leftTab?.id) return;

      const safeIndex = Math.max(0, Math.min(index ?? state.tabOrder.length, state.tabOrder.length));
      const safeGroupId = groupId || null;

      state.tabs[leftTab.id] = {
        ...tabChromeDefaults(),
        url: leftTab.url,
        title: leftTab.title || 'New Tab',
        favicon: leftTab.favicon || null,
        isNewTab: isNtpUrl(leftTab.url),
        isStealth: !!leftTab.isStealth,
        isLoading: !!leftTab.isLoading,
        splitPairId: splitPair.id,
        groupId: safeGroupId,
      };

      if (rightTab?.id) {
        state.tabs[rightTab.id] = {
          ...tabChromeDefaults(),
          url: rightTab.url,
          title: rightTab.title || 'New Tab',
          favicon: rightTab.favicon || null,
          isNewTab: isNtpUrl(rightTab.url),
          isStealth: !!rightTab.isStealth,
          isLoading: !!rightTab.isLoading,
          splitPairId: splitPair.id,
          groupId: safeGroupId,
        };
        state.tabOrder.splice(safeIndex, 0, leftTab.id, rightTab.id);
      } else {
        state.tabOrder.splice(safeIndex, 0, leftTab.id);
      }

      state.splitGroups[splitPair.id] = { ...splitPair };

      const activeId = (splitPair.focusedSide === 'right' && rightTab?.id) ? rightTab.id : leftTab.id;
      state.currentTabId = activeId;
    },

    setSplitGroup(state, action) {
      const { splitId, pair } = action.payload || {};
      const targetSplitId = splitId || pair?.id;
      if (!targetSplitId || !pair) {
        if (targetSplitId && state.splitGroups[targetSplitId]) {
          const old = state.splitGroups[targetSplitId];
          if (old.leftTabId && state.tabs[old.leftTabId]) state.tabs[old.leftTabId].splitPairId = null;
          if (old.rightTabId && state.tabs[old.rightTabId]) state.tabs[old.rightTabId].splitPairId = null;
          delete state.splitGroups[targetSplitId];
        }
        return;
      }
      // Purge any stale split groups that previously held either leftTabId or rightTabId
      for (const [gid, grp] of Object.entries(state.splitGroups)) {
        if (gid !== pair.id && (grp.leftTabId === pair.leftTabId || grp.rightTabId === pair.leftTabId ||
            (pair.rightTabId && (grp.leftTabId === pair.rightTabId || grp.rightTabId === pair.rightTabId)))) {
          delete state.splitGroups[gid];
        }
      }
      state.splitGroups[pair.id] = { ...pair };
      if (pair.leftTabId && state.tabs[pair.leftTabId]) state.tabs[pair.leftTabId].splitPairId = pair.id;
      if (pair.rightTabId) {
        if (state.tabs[pair.rightTabId]) {
          state.tabs[pair.rightTabId].splitPairId = pair.id;
        }
        const leftIdx = state.tabOrder.indexOf(pair.leftTabId);
        const rightIdx = state.tabOrder.indexOf(pair.rightTabId);
        if (leftIdx !== -1) {
          if (rightIdx === -1) {
            state.tabOrder.splice(leftIdx + 1, 0, pair.rightTabId);
          } else if (rightIdx !== leftIdx + 1) {
            state.tabOrder = state.tabOrder.filter(id => id !== pair.rightTabId);
            const newLeftIdx = state.tabOrder.indexOf(pair.leftTabId);
            state.tabOrder.splice(newLeftIdx + 1, 0, pair.rightTabId);
          }
        } else if (rightIdx === -1) {
          state.tabOrder.push(pair.rightTabId);
        }
      }
      if (pair.focusedSide) {
        const targetId = pair.focusedSide === 'left' ? pair.leftTabId : (pair.rightTabId || pair.leftTabId);
        if (targetId) state.currentTabId = targetId;
      }
    },

    removeSplitGroup(state, action) {
      const payload = action.payload;
      const splitId = typeof payload === 'string' ? payload : (payload?.splitId || payload?.id);
      let old = splitId ? state.splitGroups[splitId] : null;
      if (!old && splitId) {
        old = Object.values(state.splitGroups || {}).find(
          (p) => p.id === splitId || p.leftTabId === splitId || p.rightTabId === splitId
        ) || null;
      }
      if (old) {
        if (old.leftTabId && state.tabs[old.leftTabId]) {
          state.tabs[old.leftTabId].splitPairId = null;
        }
        if (old.rightTabId && state.tabs[old.rightTabId]) {
          state.tabs[old.rightTabId].splitPairId = null;
          // Crucial: ensure rightTabId is guaranteed in tabOrder immediately adjacent to leftTabId
          const leftIdx = state.tabOrder.indexOf(old.leftTabId);
          const rightIdx = state.tabOrder.indexOf(old.rightTabId);
          if (leftIdx !== -1) {
            if (rightIdx === -1) {
              state.tabOrder.splice(leftIdx + 1, 0, old.rightTabId);
            } else if (rightIdx !== leftIdx + 1) {
              state.tabOrder = state.tabOrder.filter(id => id !== old.rightTabId);
              const newLeftIdx = state.tabOrder.indexOf(old.leftTabId);
              state.tabOrder.splice(newLeftIdx + 1, 0, old.rightTabId);
            }
          } else if (rightIdx === -1) {
            state.tabOrder.push(old.rightTabId);
          }
        }
        delete state.splitGroups[old.id];
        // Clean up any stale duplicate groups that held leftTabId or rightTabId
        for (const [gid, grp] of Object.entries(state.splitGroups)) {
          if (grp.leftTabId === old.leftTabId || grp.rightTabId === old.leftTabId ||
              (old.rightTabId && (grp.leftTabId === old.rightTabId || grp.rightTabId === old.rightTabId))) {
            delete state.splitGroups[gid];
          }
        }
        state.tabOrder = state.tabOrder.filter(tid => !!state.tabs[tid]);
      }
    },

    setSplitRatio(state, action) {
      const { splitId, ratio } = action.payload || {};
      if (state.splitGroups[splitId]) {
        state.splitGroups[splitId].ratio = Math.max(0.2, Math.min(0.8, Number(ratio) || 0.5));
      }
    },

    setSplitFocusedSide(state, action) {
      const { splitId, side } = action.payload || {};
      if (state.splitGroups[splitId] && (side === 'left' || side === 'right')) {
        state.splitGroups[splitId].focusedSide = side;
        const targetId = side === 'left' ? state.splitGroups[splitId].leftTabId : state.splitGroups[splitId].rightTabId;
        if (targetId) {
          state.currentTabId = targetId;
        }
      }
    },

    swapSplitSides(state, action) {
      const splitId = action.payload;
      if (state.splitGroups[splitId]) {
        const pair = state.splitGroups[splitId];
        pair.isSwapped = !pair.isSwapped;
        pair.focusedSide = pair.focusedSide === 'left' ? 'right' : 'left';
        const targetId = pair.focusedSide === 'left' ? pair.leftTabId : (pair.rightTabId || pair.leftTabId);
        if (targetId) {
          state.currentTabId = targetId;
        }
      }
    },

    toggleSplitStacked(state, action) {
      const splitId = action.payload;
      if (state.splitGroups[splitId]) {
        state.splitGroups[splitId].isStacked = !state.splitGroups[splitId].isStacked;
      }
    },

    setCurrentTab(state, action) {
      const id = action.payload;
      state.currentTabId = id;
      touchMruTab(state, id);
      if (state.tabs[id]) {
        state.tabs[id].lastActiveAt = Date.now();
        const gid = state.tabs[id].groupId;
        if (gid && state.tabGroups?.[gid]?.collapsed) {
          state.tabGroups[gid].collapsed = false;
        }
      }
    },

    setTabPinned(state, action) {
      const { id, pinned } = action.payload;
      if (!state.tabs[id]) return;
      const wasPinned = !!state.tabs[id].isPinned;
      const next = !!pinned;
      if (next === wasPinned) return;
      state.tabs[id].isPinned = next;

      const others = state.tabOrder.filter(tid => tid !== id);
      if (next && !wasPinned) {
        if (state.tabs[id].groupId) {
          const oldGid = state.tabs[id].groupId;
          state.tabs[id].groupId = null;
          const hasRemaining = others.some(tid => state.tabs[tid]?.groupId === oldGid);
          if (!hasRemaining && state.tabGroups?.[oldGid]) {
            delete state.tabGroups[oldGid];
          }
        }
        const otherPinned = others.filter(tid => state.tabs[tid]?.isPinned);
        const unpinned = others.filter(tid => !state.tabs[tid]?.isPinned);
        state.tabOrder = [id, ...otherPinned, ...unpinned];
      } else if (!next && wasPinned) {
        const pinnedIds = others.filter(tid => state.tabs[tid]?.isPinned);
        const unpinnedIds = others.filter(tid => !state.tabs[tid]?.isPinned);
        state.tabOrder = [...pinnedIds, id, ...unpinnedIds];
      }
    },

    setTabAudioMuted(state, action) {
      const { id, muted } = action.payload;
      if (state.tabs[id]) state.tabs[id].isAudioMuted = !!muted;
    },

    updateTab(state, action) {
      const { id, title, favicon, isLoading, url, zoomFactor } = action.payload;
      if (!state.tabs[id]) return;
      const tab = state.tabs[id];
      if (url != null) {
        tab.url = url;
        tab.isNewTab = isNtpUrl(url);
      }
      if (favicon != null) tab.favicon = favicon;
      if (isLoading != null) tab.isLoading = isLoading;
      if (zoomFactor != null) tab.zoomFactor = Number(zoomFactor) || 1.0;
      if (title) {
        const currentUrl = url || tab.url || '';
        tab.title = (tab.isNewTab && isNtpUrl(currentUrl)) ? 'New Tab' : title;
      }
    },

    updateTabUrl(state, action) {
      const { id, url } = action.payload;
      if (!state.tabs[id]) return;
      const tab = state.tabs[id];
      tab.url = url;
      // NTP (empty omnibox) vs real navigations — e.g. clearing invisurf://settings + Enter.
      tab.isNewTab = isNtpUrl(url);
      if (tab.isNewTab) tab.title = 'New Tab';
    },

    setTabNewTab(state, action) {
      const { id, value } = action.payload;
      if (state.tabs[id]) state.tabs[id].isNewTab = value;
    },

    reorderTabs(state, action) {
      // action.payload: array of tab IDs or { tabOrder: string[], movedTabId?: string }
      const payload = action.payload;
      const rawOrder = Array.isArray(payload) ? payload : (Array.isArray(payload?.tabOrder) ? payload.tabOrder : []);
      const movedTabId = !Array.isArray(payload) ? (typeof payload === 'object' ? payload?.movedTabId : undefined) : undefined;
      const targetGroupId = !Array.isArray(payload) ? (typeof payload === 'object' ? payload?.targetGroupId : undefined) : undefined;
      let nextOrder = [...rawOrder];
      // Preserve any companion tabs that were omitted from action.payload (e.g. from tab dragging)
      Object.values(state.splitGroups || {}).forEach((pair) => {
        if (pair.rightTabId && state.tabs[pair.rightTabId] && !nextOrder.includes(pair.rightTabId)) {
          const lIdx = nextOrder.indexOf(pair.leftTabId);
          if (lIdx !== -1) {
            nextOrder.splice(lIdx + 1, 0, pair.rightTabId);
          } else {
            nextOrder.push(pair.rightTabId);
          }
        }
      });
      // Ensure any other existing tabs in state.tabs are not accidentally lost
      Object.keys(state.tabs).forEach((tid) => {
        if (!nextOrder.includes(tid)) {
          nextOrder.push(tid);
        }
      });
      // Invariant check, drag reconciliation & self-repair for group contiguity
      const reconciled = reconcileTabOrderAfterDrag(state.tabs, state.tabOrder, nextOrder, state.tabGroups, movedTabId, targetGroupId);
      state.tabs = reconciled.tabs;
      state.tabOrder = reconciled.tabOrder;
      state.tabGroups = reconciled.groups;
      applyPinnedLeadingOrder(state);
    },

    createTabGroup(state, action) {
      const { tabIds = [], title = '', color = null, groupId = null } = action.payload || {};
      const fullTabIds = getCompanionTabIds(state, tabIds);
      const res = modelCreateGroup({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        tabIds: fullTabIds,
        title,
        color,
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
      applyPinnedLeadingOrder(state);
    },

    addTabsToGroup(state, action) {
      const { tabIds = [], groupId } = action.payload || {};
      if (!groupId || !state.tabGroups?.[groupId]) return;
      const fullTabIds = getCompanionTabIds(state, tabIds);
      const res = modelAddToGroup({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        tabIds: fullTabIds,
        groupId,
        activeTabId: state.currentTabId,
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
      applyPinnedLeadingOrder(state);
    },

    removeTabsFromGroup(state, action) {
      const { tabIds = [] } = action.payload || {};
      const fullTabIds = getCompanionTabIds(state, tabIds);
      const res = modelRemoveFromGroup({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        tabIds: fullTabIds,
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
      applyPinnedLeadingOrder(state);
    },

    ungroupTabGroup(state, action) {
      const payload = action.payload;
      const groupId = typeof payload === 'string' ? payload : payload?.groupId;
      if (!groupId || !state.tabGroups?.[groupId]) return;
      const res = modelUngroup({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        groupId,
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
    },

    setGroupVisuals(state, action) {
      const { groupId, title, color } = action.payload || {};
      if (!groupId || !state.tabGroups?.[groupId]) return;
      if (title !== undefined) {
        state.tabGroups[groupId].title = String(title).slice(0, 50);
      }
      if (color !== undefined) {
        state.tabGroups[groupId].color = color;
      }
    },

    toggleGroupCollapse(state, action) {
      const { groupId, collapsed = null } = action.payload || {};
      if (!groupId || !state.tabGroups?.[groupId]) return;
      const res = modelToggleCollapse({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        groupId,
        collapsed,
        activeTabId: state.currentTabId,
        mruOrder: state.mruOrder || [],
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
      if (res.nextActiveTabId && res.nextActiveTabId !== 'NEW_TAB' && state.tabs[res.nextActiveTabId]) {
        state.currentTabId = res.nextActiveTabId;
        touchMruTab(state, res.nextActiveTabId);
      }
    },

    moveGroup(state, action) {
      const { groupId, targetIndex } = action.payload || {};
      if (!groupId || !state.tabGroups?.[groupId]) return;
      const pinnedCount = state.tabOrder.filter(tid => state.tabs[tid]?.isPinned).length;
      const res = modelMoveGroup({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        groups: state.tabGroups,
        groupId,
        insertIndex: Number(targetIndex) || 0,
        pinnedTabCount: pinnedCount,
      });
      state.tabs = res.tabs;
      state.tabOrder = res.tabOrder;
      state.tabGroups = res.groups;
      applyPinnedLeadingOrder(state);
    },

    setTabGroups(state, action) {
      state.tabGroups = action.payload && typeof action.payload === 'object' ? action.payload : {};
      const repaired = repairInvariants(state.tabs, state.tabOrder, state.tabGroups, state.currentTabId);
      state.tabs = repaired.tabs;
      state.tabOrder = repaired.tabOrder;
      state.tabGroups = repaired.groups;
      state.mruOrder = (state.mruOrder || []).filter((id) => !!state.tabs[id]);
    },

    detachGroup(state, action) {
      const { groupId, memberTabIds = [] } = action.payload || {};
      if (groupId && state.tabGroups?.[groupId]) {
        delete state.tabGroups[groupId];
      }
      for (const tid of memberTabIds) {
        delete state.tabs[tid];
      }
      state.tabOrder = state.tabOrder.filter((id) => !memberTabIds.includes(id));
      state.mruOrder = (state.mruOrder || []).filter((id) => !memberTabIds.includes(id));
      if (memberTabIds.includes(state.currentTabId)) {
        state.currentTabId = state.tabOrder[0] || null;
        if (state.currentTabId) {
          touchMruTab(state, state.currentTabId);
        }
      }
    },

    reattachTabGroup(state, action) {
      const { group, tabs = [], insertIndex = 0 } = action.payload || {};
      if (!group?.id || !Array.isArray(tabs) || tabs.length === 0) return;
      state.tabGroups = state.tabGroups || {};
      state.tabGroups[group.id] = { ...group };
      const safeIdx = Math.max(0, Math.min(state.tabOrder.length, Number(insertIndex) || 0));
      const addedIds = [];
      tabs.forEach((t) => {
        if (!t?.id) return;
        state.tabs[t.id] = {
          url: t.url || NTP_URL,
          title: t.title || 'New Tab',
          favicon: t.favicon || null,
          isNewTab: isNtpUrl(t.url || NTP_URL),
          isStealth: !!t.isStealth,
          isLoading: false,
          isSleeping: false,
          ...tabChromeDefaults(),
          ...t,
          groupId: group.id,
        };
        if (!state.tabOrder.includes(t.id)) {
          addedIds.push(t.id);
        }
      });
      state.tabOrder.splice(safeIdx, 0, ...addedIds);
      if (addedIds.length > 0) {
        state.currentTabId = addedIds[0];
        touchMruTab(state, addedIds[0]);
      }
      applyPinnedLeadingOrder(state);
    },
  },
});

export const {
  addTab,
  insertTabAfter,
  insertTabAt,
  addSleepingTab,
  wakeTab,
  removeTab,
  setCurrentTab,
  setTabPinned,
  setTabAudioMuted,
  updateTab,
  updateTabUrl,
  setTabNewTab,
  reorderTabs,
  setSearchEngine,
  setShowBookmarkBar,
  toggleSidePanel,
  setSidePanelOpen,
  setSidePanelWidth,
  setSidePanelActiveView,
  setSidePanelCustomUrl,
  togglePinSidePanel,
  setPinnedPanels,
  setToolbarConfig,
  setToolbarConfigItem,
  resetToolbarConfig,
  setScreenShareStatus,
  setSplitGroup,
  removeSplitGroup,
  detachSplitTab,
  insertSplitTabAt,
  setSplitRatio,
  setSplitFocusedSide,
  swapSplitSides,
  toggleSplitStacked,
  createTabGroup,
  addTabsToGroup,
  removeTabsFromGroup,
  ungroupTabGroup,
  setGroupVisuals,
  toggleGroupCollapse,
  moveGroup: moveTabGroup,
  setTabGroups,
  detachGroup,
  reattachTabGroup,
} = browserSlice.actions;

export default browserSlice.reducer;
