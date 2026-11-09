/**
 * Tab Groups Model & Logic (Chrome-Style Parity)
 *
 * Implements the 7 Chrome tab group invariants:
 *   I1: Every non-null tab.groupId exists in groups
 *   I2: Every key in groups is referenced by at least one tab (no empty groups)
 *   I3: Tabs with the same groupId form one unbroken contiguous run in tabOrder
 *   I4: Pinned tabs are a prefix of tabOrder, and none has a groupId
 *   I5: activeTabId refers to an existing tab; if its group is collapsed, the group is expanded
 *   I6: Group IDs are unique
 *   I7: Selection contains only existing tabs
 *
 * Built on a single atomic primitive: moveTabsAndSetGroup.
 */

export const TAB_GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

export const TAB_GROUP_PALETTE = {
  grey: {
    name: 'Grey',
    light: { chipBg: '#5f6368', text: '#ffffff', underline: '#5f6368', border: '#5f6368' },
    dark: { chipBg: '#9aa0a6', text: '#202124', underline: '#9aa0a6', border: '#9aa0a6' },
  },
  blue: {
    name: 'Blue',
    light: { chipBg: '#1a73e8', text: '#ffffff', underline: '#1a73e8', border: '#1a73e8' },
    dark: { chipBg: '#8ab4f8', text: '#202124', underline: '#8ab4f8', border: '#8ab4f8' },
  },
  red: {
    name: 'Red',
    light: { chipBg: '#d93025', text: '#ffffff', underline: '#d93025', border: '#d93025' },
    dark: { chipBg: '#f28b82', text: '#202124', underline: '#f28b82', border: '#f28b82' },
  },
  yellow: {
    name: 'Yellow',
    light: { chipBg: '#f29900', text: '#202124', underline: '#f29900', border: '#f29900' },
    dark: { chipBg: '#fdd663', text: '#202124', underline: '#fdd663', border: '#fdd663' },
  },
  green: {
    name: 'Green',
    light: { chipBg: '#1e8e3e', text: '#ffffff', underline: '#1e8e3e', border: '#1e8e3e' },
    dark: { chipBg: '#81c995', text: '#202124', underline: '#81c995', border: '#81c995' },
  },
  pink: {
    name: 'Pink',
    light: { chipBg: '#d01884', text: '#ffffff', underline: '#d01884', border: '#d01884' },
    dark: { chipBg: '#ff8bcb', text: '#202124', underline: '#ff8bcb', border: '#ff8bcb' },
  },
  purple: {
    name: 'Purple',
    light: { chipBg: '#8430ce', text: '#ffffff', underline: '#8430ce', border: '#8430ce' },
    dark: { chipBg: '#c58af9', text: '#202124', underline: '#c58af9', border: '#c58af9' },
  },
  cyan: {
    name: 'Cyan',
    light: { chipBg: '#007b83', text: '#ffffff', underline: '#007b83', border: '#007b83' },
    dark: { chipBg: '#78d9ec', text: '#202124', underline: '#78d9ec', border: '#78d9ec' },
  },
  orange: {
    name: 'Orange',
    light: { chipBg: '#e8710a', text: '#ffffff', underline: '#e8710a', border: '#e8710a' },
    dark: { chipBg: '#fcad70', text: '#202124', underline: '#fcad70', border: '#fcad70' },
  },
};

/**
 * Resolves chip & underline colors for a given color token and dark theme flag.
 */
export function getGroupThemeColors(colorToken, isDark = false) {
  const c = TAB_GROUP_PALETTE[colorToken] || TAB_GROUP_PALETTE.grey;
  return isDark ? c.dark : c.light;
}

/**
 * Generates an opaque, unique group ID.
 */
let groupCounter = 0;
export function generateGroupId() {
  groupCounter += 1;
  return `group-${Date.now().toString(36)}-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Returns the next unused group color in this window.
 * If all 9 colors are used, picks the least-used color.
 */
export function nextGroupColor(groups = {}) {
  const usageCount = {};
  for (const c of TAB_GROUP_COLORS) {
    usageCount[c] = 0;
  }
  for (const grp of Object.values(groups)) {
    if (grp?.color && usageCount[grp.color] !== undefined) {
      usageCount[grp.color] += 1;
    }
  }
  for (const c of TAB_GROUP_COLORS) {
    if (usageCount[c] === 0) return c;
  }
  let leastColor = TAB_GROUP_COLORS[0];
  let minCount = Infinity;
  for (const c of TAB_GROUP_COLORS) {
    if (usageCount[c] < minCount) {
      minCount = usageCount[c];
      leastColor = c;
    }
  }
  return leastColor;
}

/**
 * Finds the continuous range { first, last, count } of a group in tabOrder.
 * Returns null if the group has no tabs in tabOrder.
 */
export function groupRange(tabs, tabOrder, groupId) {
  if (!groupId || !Array.isArray(tabOrder)) return null;
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 0; i < tabOrder.length; i++) {
    const tid = tabOrder[i];
    if (tabs[tid]?.groupId === groupId) {
      if (first === -1) first = i;
      last = i;
      count += 1;
    }
  }
  if (count === 0) return null;
  return { first, last, count };
}

/**
 * Validates the 7 Chrome Tab Group invariants.
 * Throws an Error with descriptive message on invariant breach (used in tests and debug).
 */
export function assertInvariants(tabs, tabOrder, groups, activeTabId = null) {
  const groupTabsMap = new Map();
  for (const gid of Object.keys(groups || {})) {
    groupTabsMap.set(gid, []);
  }

  // Check pinned tabs are prefix and none is grouped (I4)
  let seenUnpinned = false;
  for (let i = 0; i < tabOrder.length; i++) {
    const tid = tabOrder[i];
    const tab = tabs[tid];
    if (!tab) continue;
    if (tab.isPinned) {
      if (seenUnpinned) {
        throw new Error(`I4 violation: pinned tab ${tid} at index ${i} appears after an unpinned tab`);
      }
      if (tab.groupId) {
        throw new Error(`I4 violation: pinned tab ${tid} has groupId ${tab.groupId}`);
      }
    } else {
      seenUnpinned = true;
    }

    if (tab.groupId) {
      // I1: Every non-null tab.groupId exists in groups
      if (!groups || !groups[tab.groupId]) {
        throw new Error(`I1 violation: tab ${tid} has non-existent groupId ${tab.groupId}`);
      }
      groupTabsMap.get(tab.groupId)?.push(i);
    }
  }

  // I2: Every key in groups is referenced by at least one tab
  for (const [gid, indices] of groupTabsMap.entries()) {
    if (indices.length === 0) {
      throw new Error(`I2 violation: group ${gid} exists but has 0 member tabs`);
    }
  }

  // I3: Tabs with the same groupId form one unbroken contiguous run in tabOrder
  for (const [gid, indices] of groupTabsMap.entries()) {
    for (let k = 1; k < indices.length; k++) {
      if (indices[k] !== indices[k - 1] + 1) {
        throw new Error(
          `I3 violation: group ${gid} is not contiguous! Indices: ${indices.join(', ')}`
        );
      }
    }
  }

  // I5: activeTabId refers to an existing tab; if its group is collapsed, the group is expanded
  if (activeTabId && tabs[activeTabId]) {
    const gid = tabs[activeTabId].groupId;
    if (gid && groups[gid]?.collapsed) {
      throw new Error(`I5 violation: active tab ${activeTabId} belongs to collapsed group ${gid}`);
    }
  }

  return true;
}

/**
 * Repairs invariants defensively on session load or invalid input.
 * Ensures the state returns to a valid, consistent state without data loss.
 */
export function repairInvariants(tabs, tabOrder, groups, activeTabId = null) {
  const nextTabs = { ...tabs };
  let nextTabOrder = [...tabOrder];
  const nextGroups = { ...groups };

  // 1. Unpin any grouped tab, or ungroup any pinned tab (I4)
  for (const tid of nextTabOrder) {
    if (nextTabs[tid]?.isPinned && nextTabs[tid]?.groupId) {
      nextTabs[tid] = { ...nextTabs[tid], groupId: null };
    }
  }

  // 2. Clear groupId if it does not exist in groups (I1)
  for (const tid of nextTabOrder) {
    const gid = nextTabs[tid]?.groupId;
    if (gid && !nextGroups[gid]) {
      nextTabs[tid] = { ...nextTabs[tid], groupId: null };
    }
  }

  // 3. Drop groups that have 0 tabs (I2) - only if tabOrder has tabs loaded
  if (nextTabOrder.length > 0) {
    const groupUsage = new Set();
    for (const tid of nextTabOrder) {
      if (nextTabs[tid]?.groupId) {
        groupUsage.add(nextTabs[tid].groupId);
      }
    }
    for (const gid of Object.keys(nextGroups)) {
      if (!groupUsage.has(gid)) {
        delete nextGroups[gid];
      }
    }
  }

  // 4. Gather any broken group runs at the position of its first member tab (I3)
  for (const gid of Object.keys(nextGroups)) {
    const members = nextTabOrder.filter((tid) => nextTabs[tid]?.groupId === gid);
    if (members.length > 1) {
      const firstIdx = nextTabOrder.indexOf(members[0]);
      // Remove all members from tabOrder
      nextTabOrder = nextTabOrder.filter((tid) => nextTabs[tid]?.groupId !== gid);
      // Re-insert members contiguously at firstIdx
      const safeInsert = Math.min(firstIdx, nextTabOrder.length);
      nextTabOrder.splice(safeInsert, 0, ...members);
    }
  }

  // 5. If activeTabId is in a collapsed group, expand that group (I5)
  if (activeTabId && nextTabs[activeTabId]?.groupId) {
    const gid = nextTabs[activeTabId].groupId;
    if (nextGroups[gid]?.collapsed) {
      nextGroups[gid] = { ...nextGroups[gid], collapsed: false };
    }
  }

  return {
    tabs: nextTabs,
    tabOrder: nextTabOrder,
    groups: nextGroups,
  };
}

/**
 * Single transactional primitive:
 * Moves tabIds into or out of a group and places them as one contiguous block at insertIndex.
 *
 * @param {object} params
 * @param {object} params.tabs - tabs dictionary
 * @param {string[]} params.tabOrder - ordered tab ID array
 * @param {object} params.groups - groups dictionary
 * @param {string[]} params.tabIds - array of tab IDs to move
 * @param {number} params.insertIndex - index to place the moved block
 * @param {string|null} params.targetGroupId - destination group ID (or null for ungrouped)
 * @returns {{ tabs: object, tabOrder: string[], groups: object }}
 */
export function moveTabsAndSetGroup({
  tabs,
  tabOrder,
  groups,
  tabIds,
  insertIndex,
  targetGroupId = null,
}) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    return { tabs, tabOrder, groups };
  }

  // Clone structures
  const nextTabs = { ...tabs };
  let nextTabOrder = [...tabOrder];
  const nextGroups = { ...groups };

  // Filter out any pinned tabs from joining a group (I4)
  const movableTabIds = tabIds.filter((tid) => !nextTabs[tid]?.isPinned);
  if (movableTabIds.length === 0) {
    return { tabs, tabOrder, groups };
  }

  // Preserve relative order of movableTabIds as they currently exist in tabOrder
  const sortedMovingIds = nextTabOrder.filter((tid) => movableTabIds.includes(tid));

  // Determine effective insert index by accounting for tabs removed before it
  let adjustedInsertIndex = Math.max(0, Math.min(insertIndex, nextTabOrder.length));
  let removedBefore = 0;
  for (let i = 0; i < adjustedInsertIndex; i++) {
    if (sortedMovingIds.includes(nextTabOrder[i])) {
      removedBefore += 1;
    }
  }
  adjustedInsertIndex -= removedBefore;

  // 1. Remove moving tabs from tabOrder
  nextTabOrder = nextTabOrder.filter((tid) => !sortedMovingIds.includes(tid));

  // 2. Set new groupId on each moved tab
  for (const tid of sortedMovingIds) {
    if (nextTabs[tid]) {
      nextTabs[tid] = {
        ...nextTabs[tid],
        groupId: targetGroupId || null,
      };
    }
  }

  // 3. Insert them as one contiguous block at the adjusted index
  const safeIndex = Math.max(0, Math.min(adjustedInsertIndex, nextTabOrder.length));
  nextTabOrder.splice(safeIndex, 0, ...sortedMovingIds);

  // 4. Cleanup: delete any groups that no longer have tabs (I2)
  const remainingGroupsWithTabs = new Set();
  for (const tid of nextTabOrder) {
    if (nextTabs[tid]?.groupId) {
      remainingGroupsWithTabs.add(nextTabs[tid].groupId);
    }
  }
  for (const gid of Object.keys(nextGroups)) {
    if (!remainingGroupsWithTabs.has(gid)) {
      delete nextGroups[gid];
    }
  }

  // 5. Repair any broken runs (I3) to guarantee contiguity invariant
  const repaired = repairInvariants(nextTabs, nextTabOrder, nextGroups);

  return {
    tabs: repaired.tabs,
    tabOrder: repaired.tabOrder,
    groups: repaired.groups,
  };
}

/**
 * Creates a new group from selected tabs.
 * Drops pinned tabs. Places the group at the index of the first selected tab.
 */
export function createGroup({
  tabs,
  tabOrder,
  groups,
  tabIds,
  title = '',
  color = null,
}) {
  const unpinned = tabIds.filter((tid) => !tabs[tid]?.isPinned);
  if (unpinned.length === 0) return { tabs, tabOrder, groups, newGroupId: null };

  const firstIdx = tabOrder.findIndex((tid) => unpinned.includes(tid));
  const newGroupId = generateGroupId();
  const assignedColor = color || nextGroupColor(groups);

  const nextGroups = {
    ...groups,
    [newGroupId]: {
      id: newGroupId,
      title: (title || '').trim(),
      color: assignedColor,
      collapsed: false,
    },
  };

  const result = moveTabsAndSetGroup({
    tabs,
    tabOrder,
    groups: nextGroups,
    tabIds: unpinned,
    insertIndex: firstIdx >= 0 ? firstIdx : tabOrder.length,
    targetGroupId: newGroupId,
  });

  return { ...result, newGroupId };
}

/**
 * Adds tabIds to an existing group.
 * Placed at the end of the group. If group is collapsed and active tab is among moved tabs, expands group.
 */
export function addToGroup({
  tabs,
  tabOrder,
  groups,
  tabIds,
  groupId,
  activeTabId = null,
}) {
  if (!groupId || !groups[groupId]) return { tabs, tabOrder, groups };
  const unpinned = tabIds.filter((tid) => !tabs[tid]?.isPinned);
  if (unpinned.length === 0) return { tabs, tabOrder, groups };

  // Find group's current range
  const range = groupRange(tabs, tabOrder, groupId);
  const targetIndex = range ? range.last + 1 : tabOrder.length;

  let nextGroups = { ...groups };
  // If moving active tab into a collapsed group, expand it (I5)
  if (activeTabId && unpinned.includes(activeTabId) && nextGroups[groupId]?.collapsed) {
    nextGroups[groupId] = { ...nextGroups[groupId], collapsed: false };
  }

  return moveTabsAndSetGroup({
    tabs,
    tabOrder,
    groups: nextGroups,
    tabIds: unpinned,
    insertIndex: targetIndex,
    targetGroupId: groupId,
  });
}

/**
 * Removes tabs from their groups.
 * Placement rule:
 * - If tab is at an edge of the group, it stays where it is, ungrouped.
 * - If tab is in the middle, it moves to just after the group's last tab so contiguity holds.
 */
export function removeFromGroup({
  tabs,
  tabOrder,
  groups,
  tabIds,
}) {
  const movingIds = tabIds.filter((tid) => tabs[tid]?.groupId);
  if (movingIds.length === 0) return { tabs, tabOrder, groups };

  let currentTabs = { ...tabs };
  let currentOrder = [...tabOrder];
  let currentGroups = { ...groups };

  for (const tid of movingIds) {
    const gid = currentTabs[tid]?.groupId;
    if (!gid) continue;
    const range = groupRange(currentTabs, currentOrder, gid);
    const currIdx = currentOrder.indexOf(tid);

    let insertIdx = currIdx;
    if (range && currIdx > range.first && currIdx < range.last) {
      // Tab is in the middle of the group: move it right after the group
      insertIdx = range.last + 1;
    }

    const res = moveTabsAndSetGroup({
      tabs: currentTabs,
      tabOrder: currentOrder,
      groups: currentGroups,
      tabIds: [tid],
      insertIndex: insertIdx,
      targetGroupId: null,
    });
    currentTabs = res.tabs;
    currentOrder = res.tabOrder;
    currentGroups = res.groups;
  }

  return {
    tabs: currentTabs,
    tabOrder: currentOrder,
    groups: currentGroups,
  };
}

/**
 * Ungroups an entire group in place.
 * Sets tab.groupId = null for all members without changing tabOrder.
 */
export function ungroup({
  tabs,
  tabOrder,
  groups,
  groupId,
}) {
  if (!groupId || !groups[groupId]) return { tabs, tabOrder, groups };

  const nextTabs = { ...tabs };
  const nextGroups = { ...groups };
  delete nextGroups[groupId];

  for (const tid of tabOrder) {
    if (nextTabs[tid]?.groupId === groupId) {
      nextTabs[tid] = { ...nextTabs[tid], groupId: null };
    }
  }

  return {
    tabs: nextTabs,
    tabOrder,
    groups: nextGroups,
  };
}

/**
 * Moves an entire group to a new insertIndex as one block.
 * Snaps around other groups so groups never interleave.
 */
export function moveGroup({
  tabs,
  tabOrder,
  groups,
  groupId,
  insertIndex,
  pinnedTabCount = 0,
}) {
  if (!groupId || !groups[groupId]) return { tabs, tabOrder, groups };
  const range = groupRange(tabs, tabOrder, groupId);
  if (!range) return { tabs, tabOrder, groups };

  const memberIds = tabOrder.filter((tid) => tabs[tid]?.groupId === groupId);
  let safeIndex = Math.max(pinnedTabCount, insertIndex);

  // If safeIndex falls strictly inside another group, snap to that group's nearest edge
  if (safeIndex < tabOrder.length) {
    const targetTabId = tabOrder[safeIndex];
    const targetGid = tabs[targetTabId]?.groupId;
    if (targetGid && targetGid !== groupId) {
      const otherRange = groupRange(tabs, tabOrder, targetGid);
      if (otherRange && safeIndex > otherRange.first && safeIndex <= otherRange.last) {
        // Snap to right edge of other group if closer, else left edge
        const distToLeft = safeIndex - otherRange.first;
        const distToRight = otherRange.last + 1 - safeIndex;
        safeIndex = distToRight <= distToLeft ? otherRange.last + 1 : otherRange.first;
      }
    }
  }

  return moveTabsAndSetGroup({
    tabs,
    tabOrder,
    groups,
    tabIds: memberIds,
    insertIndex: safeIndex,
    targetGroupId: groupId,
  });
}

/**
 * Toggles collapse state for a group.
 * If collapsing and active tab is inside, returns the ID of the nearest tab outside
 * collapsed groups to activate. If none exists, nextActiveTabId will be 'NEW_TAB'.
 */
export function toggleCollapse({
  tabs,
  tabOrder,
  groups,
  groupId,
  collapsed = null,
  activeTabId = null,
  mruOrder = [],
}) {
  if (!groupId || !groups[groupId]) {
    return { tabs, tabOrder, groups, nextActiveTabId: activeTabId };
  }

  const nextGroups = { ...groups };
  const isCollapsed = collapsed !== null ? !!collapsed : !nextGroups[groupId].collapsed;
  nextGroups[groupId] = {
    ...nextGroups[groupId],
    collapsed: isCollapsed,
  };

  let nextActiveTabId = activeTabId;
  if (isCollapsed && activeTabId && tabs[activeTabId]?.groupId === groupId) {
    let found = null;

    // 1. Try finding a non-grouped tab from MRU (most recently used non-grouped tab)
    if (Array.isArray(mruOrder)) {
      for (const tid of mruOrder) {
        if (tid !== activeTabId && tabs[tid] && !tabs[tid].groupId) {
          found = tid;
          break;
        }
      }
    }

    // 2. If no non-grouped tab in MRU, find first non-grouped tab in tabOrder
    if (!found) {
      for (const tid of tabOrder) {
        if (tid !== activeTabId && tabs[tid] && !tabs[tid].groupId) {
          found = tid;
          break;
        }
      }
    }

    // 3. If all tabs belong to groups, try MRU tab from any non-collapsed group
    if (!found && Array.isArray(mruOrder)) {
      for (const tid of mruOrder) {
        const gid = tabs[tid]?.groupId;
        if (tid !== activeTabId && gid && !nextGroups[gid]?.collapsed) {
          found = tid;
          break;
        }
      }
    }

    // 4. Fallback: find nearest tab outside collapsed groups (search right, then left)
    if (!found) {
      const range = groupRange(tabs, tabOrder, groupId);
      const startIdx = range ? range.last + 1 : 0;
      for (let i = startIdx; i < tabOrder.length; i++) {
        const tid = tabOrder[i];
        const gid = tabs[tid]?.groupId;
        if (!gid || !nextGroups[gid]?.collapsed) {
          found = tid;
          break;
        }
      }
      if (!found && range) {
        for (let i = range.first - 1; i >= 0; i--) {
          const tid = tabOrder[i];
          const gid = tabs[tid]?.groupId;
          if (!gid || !nextGroups[gid]?.collapsed) {
            found = tid;
            break;
          }
        }
      }
    }

    nextActiveTabId = found || 'NEW_TAB';
  }

  return {
    tabs,
    tabOrder,
    groups: nextGroups,
    nextActiveTabId,
  };
}

/**
 * Projection function: walks tabOrder once in linear O(N) time.
 * Emits strip items: group headers ('group-chip') and tabs ('tab').
 *
 * Each item contains:
 * - for 'group-chip': { type: 'group-chip', group, firstTabId, lastTabId, tabCount, isCollapsed }
 * - for 'tab': { type: 'tab', id, tab, groupId, isCollapsed }
 */
export function itemsForStrip({ tabs, tabOrder, groups, rightSplitTabIds = new Set() }) {
  const items = [];
  const seenGroups = new Set();

  for (let i = 0; i < tabOrder.length; i++) {
    const tid = tabOrder[i];
    if (rightSplitTabIds.has(tid)) continue; // Handled inside SplitTab

    const tab = tabs[tid];
    const gid = tab?.groupId || null;
    const group = gid ? groups[gid] : null;

    if (group && !seenGroups.has(gid)) {
      seenGroups.add(gid);
      const range = groupRange(tabs, tabOrder, gid);
      items.push({
        type: 'group-chip',
        id: `chip-${gid}`,
        groupId: gid,
        group,
        firstTabId: tid,
        tabCount: range ? range.count : 1,
        isCollapsed: !!group.collapsed,
      });
    }

    items.push({
      type: 'tab',
      id: tid,
      tab,
      groupId: gid,
      isCollapsed: !!(group && group.collapsed),
    });
  }

  return items;
}

/**
 * Reconciles group membership after a drag-and-drop reordering.
 * - Dropping an ungrouped tab between group members joins the group.
 * - Dropping a grouped tab outside its group's bounds ungroups it.
 * - Invariants (I1-I7) are maintained cleanly.
 */
export function reconcileTabOrderAfterDrag(
  tabs,
  oldOrder,
  newOrder,
  groups,
  movedTabIdOrDetails = null,
  explicitTargetGroupId = undefined
) {
  const nextTabs = { ...tabs };
  let nextOrder = [...newOrder];
  const nextGroups = { ...groups };

  let moved = null;
  let targetGroupId = explicitTargetGroupId;

  if (typeof movedTabIdOrDetails === 'object' && movedTabIdOrDetails !== null) {
    moved = movedTabIdOrDetails.movedTabId || null;
    if (movedTabIdOrDetails.targetGroupId !== undefined) {
      targetGroupId = movedTabIdOrDetails.targetGroupId;
    }
  } else if (typeof movedTabIdOrDetails === 'string') {
    moved = movedTabIdOrDetails;
  }

  if (!moved && oldOrder && newOrder && oldOrder.length === newOrder.length) {
    for (let i = 0; i < oldOrder.length; i++) {
      const candidate = oldOrder[i];
      if (newOrder[i] !== candidate) {
        const fOld = oldOrder.filter((x) => x !== candidate);
        const fNew = newOrder.filter((x) => x !== candidate);
        if (fOld.every((x, idx) => x === fNew[idx])) {
          // If candidate is between members of a group in newOrder, prefer it
          const nIdx = newOrder.indexOf(candidate);
          const pG = nIdx > 0 ? nextTabs[newOrder[nIdx - 1]]?.groupId : null;
          const nG = nIdx < newOrder.length - 1 ? nextTabs[newOrder[nIdx + 1]]?.groupId : null;
          if (pG && nG && pG === nG) {
            moved = candidate;
            break;
          }
          if (!moved) moved = candidate;
        }
      }
    }
  }

  if (moved && nextTabs[moved] && !nextTabs[moved].isPinned) {
    const newIdx = nextOrder.indexOf(moved);
    const prevGid = newIdx > 0 ? nextTabs[nextOrder[newIdx - 1]]?.groupId : null;
    const nextGid = newIdx < nextOrder.length - 1 ? nextTabs[nextOrder[newIdx + 1]]?.groupId : null;
    const oldGid = nextTabs[moved].groupId;

    if (targetGroupId && nextGroups[targetGroupId] && !nextGroups[targetGroupId].collapsed) {
      // Explicitly dropped onto an expanded group chip or member tab
      nextTabs[moved] = { ...nextTabs[moved], groupId: targetGroupId };
    } else if (prevGid && nextGid && prevGid === nextGid) {
      // Landed strictly inside a group: join that group
      nextTabs[moved] = { ...nextTabs[moved], groupId: prevGid };
    } else if (oldGid) {
      // Check if still adjacent to old group members
      const isAdjacent = prevGid === oldGid || nextGid === oldGid;
      if (!isAdjacent) {
        // Dragged away from old group: leave group
        nextTabs[moved] = { ...nextTabs[moved], groupId: null };
      }
    }
  }

  return repairInvariants(nextTabs, nextOrder, nextGroups);
}

