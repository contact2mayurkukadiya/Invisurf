const { describe, it } = require('node:test');
const assert = require('node:assert');

// In node tests with ES modules / commonjs:
// We can import tabGroupModel using dynamic import()
async function loadModel() {
  return await import('../../../src/utils/tabGroupModel.js');
}

describe('TabGroupModel Core Engine & Invariants', () => {
  it('color palette and nextGroupColor cycling', async () => {
    const { TAB_GROUP_COLORS, nextGroupColor, getGroupThemeColors } = await loadModel();
    assert.strictEqual(TAB_GROUP_COLORS.length, 9);

    const initialColor = nextGroupColor({});
    assert.strictEqual(initialColor, 'grey');

    const groups = {
      g1: { color: 'grey' },
      g2: { color: 'blue' },
    };
    const c3 = nextGroupColor(groups);
    assert.strictEqual(c3, 'red');

    const themeColors = getGroupThemeColors('blue', false);
    assert.ok(themeColors.chipBg);
    assert.ok(themeColors.underline);
  });

  it('createGroup creates group, places tabs at first tab index, and preserves order', async () => {
    const { createGroup, assertInvariants } = await loadModel();

    const tabs = {
      t1: { id: 't1', isPinned: true },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
      t4: { id: 't4', isPinned: false },
      t5: { id: 't5', isPinned: false },
    };
    const tabOrder = ['t1', 't2', 't3', 't4', 't5'];
    const groups = {};

    // Group t3 and t5 together
    const res = createGroup({
      tabs,
      tabOrder,
      groups,
      tabIds: ['t3', 't5'],
      title: 'Research',
    });

    assert.ok(res.newGroupId);
    assert.strictEqual(res.groups[res.newGroupId].title, 'Research');
    assert.strictEqual(res.tabs.t3.groupId, res.newGroupId);
    assert.strictEqual(res.tabs.t5.groupId, res.newGroupId);

    // Order: t3 was index 2, so t3 and t5 should gather at index 2
    assert.deepStrictEqual(res.tabOrder, ['t1', 't2', 't3', 't5', 't4']);
    assert.doesNotThrow(() => assertInvariants(res.tabs, res.tabOrder, res.groups, 't3'));
  });

  it('addToGroup moves tabs to end of existing group', async () => {
    const { createGroup, addToGroup, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
      t4: { id: 't4', isPinned: false },
    };
    let tabOrder = ['t1', 't2', 't3', 't4'];
    let groups = {};

    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1'], title: 'Group A' });
    tabs = gRes.tabs;
    tabOrder = gRes.tabOrder;
    groups = gRes.groups;
    const gid = gRes.newGroupId;

    const addRes = addToGroup({ tabs, tabOrder, groups, tabIds: ['t4'], groupId: gid });
    assert.deepStrictEqual(addRes.tabOrder, ['t1', 't4', 't2', 't3']);
    assert.strictEqual(addRes.tabs.t4.groupId, gid);
    assert.doesNotThrow(() => assertInvariants(addRes.tabs, addRes.tabOrder, addRes.groups));
  });

  it('removeFromGroup preserves contiguity (middle tab moves to after group)', async () => {
    const { createGroup, removeFromGroup, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
      t4: { id: 't4', isPinned: false },
    };
    let tabOrder = ['t1', 't2', 't3', 't4'];
    let groups = {};

    // Group t1, t2, t3
    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1', 't2', 't3'], title: 'Group 1' });
    tabs = gRes.tabs;
    tabOrder = gRes.tabOrder;
    groups = gRes.groups;

    // Remove middle tab t2 from group
    const remRes = removeFromGroup({ tabs, tabOrder, groups, tabIds: ['t2'] });
    // t1 and t3 stay contiguous in the group, t2 moves right after t3
    assert.deepStrictEqual(remRes.tabOrder, ['t1', 't3', 't2', 't4']);
    assert.strictEqual(remRes.tabs.t2.groupId, null);
    assert.strictEqual(remRes.tabs.t1.groupId, gRes.newGroupId);
    assert.strictEqual(remRes.tabs.t3.groupId, gRes.newGroupId);
    assert.doesNotThrow(() => assertInvariants(remRes.tabs, remRes.tabOrder, remRes.groups));
  });

  it('removeFromGroup at group edge stays in place', async () => {
    const { createGroup, removeFromGroup, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
    };
    let tabOrder = ['t1', 't2', 't3'];
    let groups = {};

    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1', 't2', 't3'], title: 'Group 1' });
    tabs = gRes.tabs;
    tabOrder = gRes.tabOrder;
    groups = gRes.groups;

    // Remove t3 (edge tab)
    const remRes = removeFromGroup({ tabs, tabOrder, groups, tabIds: ['t3'] });
    assert.deepStrictEqual(remRes.tabOrder, ['t1', 't2', 't3']);
    assert.strictEqual(remRes.tabs.t3.groupId, null);
    assert.doesNotThrow(() => assertInvariants(remRes.tabs, remRes.tabOrder, remRes.groups));
  });

  it('ungroup removes group and leaves tabs in place', async () => {
    const { createGroup, ungroup, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
    };
    let tabOrder = ['t1', 't2'];
    let groups = {};

    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1', 't2'] });
    const uRes = ungroup({ tabs: gRes.tabs, tabOrder: gRes.tabOrder, groups: gRes.groups, groupId: gRes.newGroupId });

    assert.strictEqual(Object.keys(uRes.groups).length, 0);
    assert.strictEqual(uRes.tabs.t1.groupId, null);
    assert.strictEqual(uRes.tabs.t2.groupId, null);
    assert.deepStrictEqual(uRes.tabOrder, ['t1', 't2']);
    assert.doesNotThrow(() => assertInvariants(uRes.tabs, uRes.tabOrder, uRes.groups));
  });

  it('moveGroup moves member block as a single unit without interleaving', async () => {
    const { createGroup, moveGroup, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
      t4: { id: 't4', isPinned: false },
    };
    let tabOrder = ['t1', 't2', 't3', 't4'];
    let groups = {};

    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1', 't2'], title: 'Block' });
    const gid = gRes.newGroupId;

    // Move group to index 4 (end of strip)
    const mRes = moveGroup({
      tabs: gRes.tabs,
      tabOrder: gRes.tabOrder,
      groups: gRes.groups,
      groupId: gid,
      insertIndex: 4,
    });

    assert.deepStrictEqual(mRes.tabOrder, ['t3', 't4', 't1', 't2']);
    assert.doesNotThrow(() => assertInvariants(mRes.tabs, mRes.tabOrder, mRes.groups));
  });

  it('toggleCollapse switches active tab if inside collapsing group', async () => {
    const { createGroup, toggleCollapse, assertInvariants } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: false },
      t2: { id: 't2', isPinned: false },
      t3: { id: 't3', isPinned: false },
    };
    let tabOrder = ['t1', 't2', 't3'];
    let groups = {};

    const gRes = createGroup({ tabs, tabOrder, groups, tabIds: ['t1', 't2'] });
    const gid = gRes.newGroupId;

    const cRes = toggleCollapse({
      tabs: gRes.tabs,
      tabOrder: gRes.tabOrder,
      groups: gRes.groups,
      groupId: gid,
      collapsed: true,
      activeTabId: 't1',
    });

    assert.strictEqual(cRes.groups[gid].collapsed, true);
    // Focus should switch to nearest visible tab outside collapsed group -> t3
    assert.strictEqual(cRes.nextActiveTabId, 't3');
    assert.doesNotThrow(() => assertInvariants(cRes.tabs, cRes.tabOrder, cRes.groups, cRes.nextActiveTabId));
  });

  it('repairInvariants recovers from corrupted state', async () => {
    const { repairInvariants, assertInvariants } = await loadModel();

    // Corrupted:
    // - t1 has non-existent group 'g-ghost'
    // - t2 is pinned but has group 'g1'
    // - 'g-empty' has 0 tabs
    // - 'g1' tabs (t3 and t5) are split apart by t4 (I3 broken)
    const corruptedTabs = {
      t1: { id: 't1', isPinned: false, groupId: 'g-ghost' },
      t2: { id: 't2', isPinned: true, groupId: 'g1' },
      t3: { id: 't3', isPinned: false, groupId: 'g1' },
      t4: { id: 't4', isPinned: false, groupId: null },
      t5: { id: 't5', isPinned: false, groupId: 'g1' },
    };
    const corruptedOrder = ['t2', 't1', 't3', 't4', 't5'];
    const corruptedGroups = {
      g1: { id: 'g1', title: 'G1', color: 'blue', collapsed: false },
      'g-empty': { id: 'g-empty', title: 'Empty', color: 'red', collapsed: false },
    };

    const repaired = repairInvariants(corruptedTabs, corruptedOrder, corruptedGroups);

    assert.strictEqual(repaired.tabs.t1.groupId, null); // Ghost group dropped
    assert.strictEqual(repaired.tabs.t2.groupId, null); // Pinned tab ungrouped
    assert.strictEqual(repaired.groups['g-empty'], undefined); // Empty group pruned
    // t3 and t5 are gathered contiguously
    assert.doesNotThrow(() => assertInvariants(repaired.tabs, repaired.tabOrder, repaired.groups));
  });

  it('Fuzz testing: 10,000 random operations with zero invariant violations', async () => {
    const {
      createGroup,
      addToGroup,
      removeFromGroup,
      ungroup,
      moveGroup,
      toggleCollapse,
      assertInvariants,
    } = await loadModel();

    let tabs = {
      t1: { id: 't1', isPinned: true, groupId: null },
      t2: { id: 't2', isPinned: false, groupId: null },
      t3: { id: 't3', isPinned: false, groupId: null },
      t4: { id: 't4', isPinned: false, groupId: null },
      t5: { id: 't5', isPinned: false, groupId: null },
      t6: { id: 't6', isPinned: false, groupId: null },
    };
    let tabOrder = ['t1', 't2', 't3', 't4', 't5', 't6'];
    let groups = {};
    let activeTabId = 't2';

    const unpinned = ['t2', 't3', 't4', 't5', 't6'];

    for (let step = 0; step < 10000; step++) {
      const op = Math.floor(Math.random() * 6);
      const groupIds = Object.keys(groups);

      if (op === 0) {
        // createGroup
        const count = 1 + Math.floor(Math.random() * 3);
        const shuffled = [...unpinned].sort(() => Math.random() - 0.5);
        const chosen = shuffled.slice(0, count);
        const res = createGroup({ tabs, tabOrder, groups, tabIds: chosen });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
      } else if (op === 1 && groupIds.length > 0) {
        // addToGroup
        const gid = groupIds[Math.floor(Math.random() * groupIds.length)];
        const target = unpinned[Math.floor(Math.random() * unpinned.length)];
        const res = addToGroup({ tabs, tabOrder, groups, tabIds: [target], groupId: gid, activeTabId });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
      } else if (op === 2) {
        // removeFromGroup
        const target = unpinned[Math.floor(Math.random() * unpinned.length)];
        const res = removeFromGroup({ tabs, tabOrder, groups, tabIds: [target] });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
      } else if (op === 3 && groupIds.length > 0) {
        // ungroup
        const gid = groupIds[Math.floor(Math.random() * groupIds.length)];
        const res = ungroup({ tabs, tabOrder, groups, groupId: gid });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
      } else if (op === 4 && groupIds.length > 0) {
        // moveGroup
        const gid = groupIds[Math.floor(Math.random() * groupIds.length)];
        const targetIdx = 1 + Math.floor(Math.random() * tabOrder.length);
        const res = moveGroup({ tabs, tabOrder, groups, groupId: gid, insertIndex: targetIdx, pinnedTabCount: 1 });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
      } else if (op === 5 && groupIds.length > 0) {
        // toggleCollapse
        const gid = groupIds[Math.floor(Math.random() * groupIds.length)];
        const res = toggleCollapse({ tabs, tabOrder, groups, groupId: gid, activeTabId });
        tabs = res.tabs;
        tabOrder = res.tabOrder;
        groups = res.groups;
        if (res.nextActiveTabId && res.nextActiveTabId !== 'NEW_TAB') {
          activeTabId = res.nextActiveTabId;
        }
      }

      // Assert invariants after each step!
      assert.doesNotThrow(
        () => assertInvariants(tabs, tabOrder, groups, activeTabId),
        `Failed invariant at fuzz step ${step}`
      );
    }
  });
});
