import { createSlice } from '@reduxjs/toolkit';
import { URL as URL_C } from '../constants/conditionStrings.js';

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
  };
}

/** All pinned tabs first (left), then unpinned; preserves relative order within each group. */
function applyPinnedLeadingOrder(state) {
  const pinned = state.tabOrder.filter(tid => state.tabs[tid]?.isPinned);
  const unpinned = state.tabOrder.filter(tid => !state.tabs[tid]?.isPinned);
  state.tabOrder = [...pinned, ...unpinned];
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

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    tabs: {},
    tabOrder: [],
    currentTabId: null,
    splitGroups: {}, // { [splitId]: { id, leftTabId, rightTabId, ratio: 0.5, focusedSide: 'left' } }
    searchEngine: 'google',
    showBookmarkBar: true,
    sidePanel: {
      isOpen: false,
      width: 360,
      activePanelId: 'reading-list',
      customUrl: null,
      pinnedPanelIds: getInitialPinnedPanels(),
    },
  },
  reducers: {
    toggleSidePanel(state) {
      state.sidePanel.isOpen = !state.sidePanel.isOpen;
    },
    setSidePanelOpen(state, action) {
      state.sidePanel.isOpen = !!action.payload;
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
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('invisurf:pinned-sidepanels', JSON.stringify(state.sidePanel.pinnedPanelIds));
        }
      } catch (_) {}
    },
    setPinnedPanels(state, action) {
      state.sidePanel.pinnedPanelIds = (Array.isArray(action.payload) ? action.payload : []).filter(id => id !== 'lens');
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
      const { id, isStealth = false, initialUrl = null } = action.payload;
      const url = initialUrl || NTP_URL;
      const existingSplitPair = Object.values(state.splitGroups || {}).find(
        (p) => p.leftTabId === id || p.rightTabId === id
      );
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
      }
      applyPinnedLeadingOrder(state);
    },

    /**
     * Inserts a new tab immediately after `afterId` in tabOrder and focuses it.
     */
    insertTabAfter(state, action) {
      const { afterId, id, isStealth = false, initialUrl = null } = action.payload;
      const url = initialUrl || NTP_URL;
      const afterIdx = state.tabOrder.indexOf(afterId);
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isNtpUrl(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
        ...tabChromeDefaults(),
      };
      if (afterIdx === -1) {
        state.tabOrder.push(id);
      } else {
        state.tabOrder.splice(afterIdx + 1, 0, id);
      }
      state.currentTabId = id;
      applyPinnedLeadingOrder(state);
    },

    /**
     * Registers a session-restored tab as sleeping: the tab strip shows the
     * saved title/favicon immediately, but no WebContentsView is created until
     * the user first activates the tab.
     */
    addSleepingTab(state, action) {
      const { id, url, title, favicon, isStealth = false } = action.payload;
      const resolvedUrl = url || NTP_URL;
      state.tabs[id] = {
        url: resolvedUrl,
        title: title || 'New Tab',
        favicon: favicon || null,
        isNewTab: isNtpUrl(resolvedUrl),
        isStealth,
        isLoading: false,
        isSleeping: true,
        ...tabChromeDefaults(),
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
        if (old.rightTabId) {
          if (state.tabs[old.rightTabId]) {
            state.tabs[old.rightTabId].splitPairId = null;
          }
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
      if (state.tabs[id]) {
        state.tabs[id].lastActiveAt = Date.now();
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
      if (!state.tabs[id]) {
        state.tabs[id] = {
          url: NTP_URL,
          isNewTab: true,
          isStealth: false,
          isLoading: false,
          ...tabChromeDefaults(),
        };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
      const tab = state.tabs[id];
      if (url != null) tab.url = url;
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
      if (!state.tabs[id]) {
        state.tabs[id] = {
          url: NTP_URL,
          isNewTab: true,
          isStealth: false,
          isLoading: false,
          ...tabChromeDefaults(),
        };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
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
      // action.payload: new ordered array of tab IDs
      let nextOrder = Array.isArray(action.payload) ? [...action.payload] : [];
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
      state.tabOrder = nextOrder;
      applyPinnedLeadingOrder(state);
    },
  },
});

export const {
  addTab,
  insertTabAfter,
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
  setSplitGroup,
  removeSplitGroup,
  setSplitRatio,
  setSplitFocusedSide,
  swapSplitSides,
  toggleSplitStacked,
} = browserSlice.actions;

export default browserSlice.reducer;
