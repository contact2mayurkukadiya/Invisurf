const { describe, it } = require('node:test');
const assert = require('node:assert');

async function loadDeps() {
  const mod = await import('../../../src/store/browserSlice.js');
  const model = await import('../../../src/utils/tabGroupModel.js');
  return {
    reducer: mod.default,
    actions: mod,
    ...model,
  };
}

describe('Tab Group 5 Enhancements Verification', () => {
  it('Requirement 4: Automatically adds non-grouped tab when dropped over an expanded group area', async () => {
    const { reconcileTabOrderAfterDrag } = await loadDeps();

    const tabs = {
      'tab-1': { id: 'tab-1', groupId: 'g1' },
      'tab-2': { id: 'tab-2', groupId: 'g1' },
      'tab-3': { id: 'tab-3', groupId: null }, // non-grouped tab
    };
    const tabOrder = ['tab-1', 'tab-2', 'tab-3'];
    const groups = {
      g1: { id: 'g1', title: 'Work', color: 'blue', collapsed: false },
    };

    // Tab-3 is dragged over group g1 area (targetGroupId: 'g1')
    const result = reconcileTabOrderAfterDrag(
      tabs,
      tabOrder,
      ['tab-1', 'tab-3', 'tab-2'],
      groups,
      { movedTabId: 'tab-3', targetGroupId: 'g1' }
    );

    assert.strictEqual(result.tabs['tab-3'].groupId, 'g1', 'tab-3 should be automatically added to group g1');
    assert.deepStrictEqual(result.tabOrder, ['tab-1', 'tab-3', 'tab-2']);
    assert.strictEqual(Object.keys(result.groups).length, 1);
  });

  it('Requirement 5: Group cannot be dragged and released over another group area (snaps outside)', async () => {
    const { moveGroup } = await loadDeps();

    const tabs = {
      // Group A (2 tabs)
      'ta-1': { id: 'ta-1', groupId: 'ga' },
      'ta-2': { id: 'ta-2', groupId: 'ga' },
      // Group B (2 tabs)
      'tb-1': { id: 'tb-1', groupId: 'gb' },
      'tb-2': { id: 'tb-2', groupId: 'gb' },
      // Ungrouped tab
      'tc-1': { id: 'tc-1', groupId: null },
    };
    const tabOrder = ['ta-1', 'ta-2', 'tb-1', 'tb-2', 'tc-1'];
    const groups = {
      ga: { id: 'ga', title: 'Group A', color: 'blue', collapsed: false },
      gb: { id: 'gb', title: 'Group B', color: 'red', collapsed: false },
    };

    // User attempts to move Group A into index 3 (which is right in the middle of Group B between tb-1 and tb-2)
    const result = moveGroup({
      tabs,
      tabOrder,
      groups,
      groupId: 'ga',
      insertIndex: 3,
    });

    // Group A should NOT split Group B! It should snap outside Group B (after tb-2)
    assert.strictEqual(result.tabs['ta-1'].groupId, 'ga', 'Group A tabs retain their own groupId');
    assert.strictEqual(result.tabs['ta-2'].groupId, 'ga', 'Group A tabs retain their own groupId');
    assert.strictEqual(result.tabs['tb-1'].groupId, 'gb', 'Group B tabs retain their own groupId');
    assert.strictEqual(result.tabs['tb-2'].groupId, 'gb', 'Group B tabs retain their own groupId');

    // Group B must remain contiguous: tb-1 immediately followed by tb-2
    const b1Idx = result.tabOrder.indexOf('tb-1');
    const b2Idx = result.tabOrder.indexOf('tb-2');
    assert.strictEqual(b2Idx, b1Idx + 1, 'Group B tabs remain unbroken and contiguous');

    // Group A must remain contiguous: ta-1 immediately followed by ta-2
    const a1Idx = result.tabOrder.indexOf('ta-1');
    const a2Idx = result.tabOrder.indexOf('ta-2');
    assert.strictEqual(a2Idx, a1Idx + 1, 'Group A tabs remain unbroken and contiguous');
  });

  it('Requirement 1 & 2: Supports smooth collapse state toggling and maintains active tab outside collapsing group', async () => {
    const { toggleCollapse } = await loadDeps();

    const tabs = {
      't1': { id: 't1', groupId: 'g1' },
      't2': { id: 't2', groupId: 'g1' },
      't3': { id: 't3', groupId: null },
    };
    const tabOrder = ['t1', 't2', 't3'];
    const groups = {
      g1: { id: 'g1', title: 'Design', color: 'blue', collapsed: false },
    };

    // If active tab is inside group when collapsing, switches active tab to outside group (t3)
    const collapsed = toggleCollapse({
      tabs,
      tabOrder,
      groups,
      groupId: 'g1',
      collapsed: true,
      activeTabId: 't1',
    });

    assert.strictEqual(collapsed.groups.g1.collapsed, true);
    assert.strictEqual(collapsed.nextActiveTabId, 't3', 'Active tab switched to t3 outside the collapsed group');

    // Expanding group again restores collapsed: false
    const expanded = toggleCollapse({
      tabs,
      tabOrder,
      groups: collapsed.groups,
      groupId: 'g1',
      collapsed: false,
      activeTabId: 't3',
    });

    assert.strictEqual(expanded.groups.g1.collapsed, false);
    assert.strictEqual(expanded.nextActiveTabId, 't3');
  });

  it('Requirement 4: Re-attaching tab with groupId joins group, while non-group reattach prevents breaking group contiguity', async () => {
    const { reducer, actions } = await loadDeps();
    let state = {
      tabs: {
        't1': { id: 't1', url: 'https://example.com/1', title: 'T1', groupId: 'g1' },
        't2': { id: 't2', url: 'https://example.com/2', title: 'T2', groupId: 'g1' },
      },
      tabOrder: ['t1', 't2'],
      tabGroups: {
        g1: { id: 'g1', title: 'Work', color: 'blue', collapsed: false },
      },
      currentTabId: 't1',
    };

    // Reattach a tab into group g1 area
    state = reducer(state, actions.insertTabAt({
      index: 1,
      id: 't-new',
      url: 'https://example.com/new',
      title: 'New Tab',
      groupId: 'g1',
    }));

    assert.strictEqual(state.tabs['t-new'].groupId, 'g1', 'Reattached tab joins group');
    assert.deepStrictEqual(state.tabOrder, ['t1', 't-new', 't2']);
  });

  it('Requirement 5: DetachGroup removes group and its member tabs cleanly from source window state', async () => {
    const { reducer, actions } = await loadDeps();
    let state = {
      tabs: {
        't1': { id: 't1', url: 'https://example.com/1', title: 'T1', groupId: 'g1' },
        't2': { id: 't2', url: 'https://example.com/2', title: 'T2', groupId: 'g1' },
        't3': { id: 't3', url: 'https://example.com/3', title: 'T3', groupId: null },
      },
      tabOrder: ['t1', 't2', 't3'],
      tabGroups: {
        g1: { id: 'g1', title: 'Work', color: 'blue', collapsed: false },
      },
      currentTabId: 't1',
    };

    state = reducer(state, actions.detachGroup({
      groupId: 'g1',
      memberTabIds: ['t1', 't2'],
    }));

    assert.strictEqual(state.tabGroups['g1'], undefined, 'Group g1 removed from source window');
    assert.strictEqual(state.tabs['t1'], undefined, 'Member t1 removed');
    assert.strictEqual(state.tabs['t2'], undefined, 'Member t2 removed');
    assert.deepStrictEqual(state.tabOrder, ['t3']);
    assert.strictEqual(state.currentTabId, 't3', 'Active tab switched to remaining tab t3');
  });

  it('Requirement 2: Sorts multiple groups by moving end group to center between other groups', async () => {
    const { moveGroup } = await loadDeps();
    const tabs = {
      'ta-1': { id: 'ta-1', groupId: 'ga' },
      'ta-2': { id: 'ta-2', groupId: 'ga' },
      'tb-1': { id: 'tb-1', groupId: 'gb' },
      'tb-2': { id: 'tb-2', groupId: 'gb' },
      'tc-1': { id: 'tc-1', groupId: 'gc' },
      'tc-2': { id: 'tc-2', groupId: 'gc' },
    };
    const tabOrder = ['ta-1', 'ta-2', 'tb-1', 'tb-2', 'tc-1', 'tc-2'];
    const groups = {
      ga: { id: 'ga', title: 'A', color: 'blue', collapsed: false },
      gb: { id: 'gb', title: 'B', color: 'red', collapsed: false },
      gc: { id: 'gc', title: 'C', color: 'green', collapsed: false },
    };

    // Move group gc (tabs tc-1, tc-2) to index 2 (between group ga and gb)
    const result = moveGroup({ tabs, tabOrder, groups, groupId: 'gc', insertIndex: 2 });
    assert.deepStrictEqual(result.tabOrder, ['ta-1', 'ta-2', 'tc-1', 'tc-2', 'tb-1', 'tb-2'], 'Group gc should be moved to center between ga and gb');
  });

  it('MRU Activation: Redux tracks activation order and removes closed tabs from mruOrder', async () => {
    const { reducer, actions } = await loadDeps();
    let state = {
      tabs: {
        't1': { id: 't1', url: 'https://1.com', title: '1', groupId: null },
        't2': { id: 't2', url: 'https://2.com', title: '2', groupId: null },
        't3': { id: 't3', url: 'https://3.com', title: '3', groupId: null },
      },
      tabOrder: ['t1', 't2', 't3'],
      mruOrder: ['t1'],
      currentTabId: 't1',
      tabGroups: {},
    };

    // User switches to t2, then t3, then back to t2
    state = reducer(state, actions.setCurrentTab('t2'));
    assert.deepStrictEqual(state.mruOrder, ['t2', 't1']);

    state = reducer(state, actions.setCurrentTab('t3'));
    assert.deepStrictEqual(state.mruOrder, ['t3', 't2', 't1']);

    state = reducer(state, actions.setCurrentTab('t2'));
    assert.deepStrictEqual(state.mruOrder, ['t2', 't3', 't1']);

    // Closing t2 cleans up mruOrder
    state = reducer(state, actions.removeTab('t2'));
    assert.deepStrictEqual(state.mruOrder, ['t3', 't1']);
    assert.strictEqual(state.tabs['t2'], undefined);
  });

  it('Group Collapse: Deactivates active tab in group and prioritizes non-grouped tab from MRU', async () => {
    const { toggleCollapse } = await loadDeps();
    const tabs = {
      't1': { id: 't1', groupId: 'g1' },
      't2': { id: 't2', groupId: 'g1' },
      't3': { id: 't3', groupId: null },
      't4': { id: 't4', groupId: null },
    };
    const tabOrder = ['t1', 't2', 't3', 't4'];
    const groups = {
      g1: { id: 'g1', title: 'Design', color: 'blue', collapsed: false },
    };

    // User was previously on t4 (more recently used non-grouped tab than t3)
    const mruOrder = ['t1', 't4', 't3', 't2'];

    const res = toggleCollapse({
      tabs,
      tabOrder,
      groups,
      groupId: 'g1',
      collapsed: true,
      activeTabId: 't1',
      mruOrder,
    });

    assert.strictEqual(res.groups.g1.collapsed, true);
    assert.strictEqual(res.nextActiveTabId, 't4', 'Switched to last active non-grouped tab from MRU (t4)');
  });

  it('Group Collapse: Falls back to first non-grouped tab if MRU has no non-grouped candidate', async () => {
    const { toggleCollapse } = await loadDeps();
    const tabs = {
      't1': { id: 't1', groupId: 'g1' },
      't2': { id: 't2', groupId: 'g1' },
      't3': { id: 't3', groupId: null },
    };
    const tabOrder = ['t1', 't2', 't3'];
    const groups = {
      g1: { id: 'g1', title: 'Design', color: 'blue', collapsed: false },
    };

    // MRU only has tabs inside the collapsing group
    const mruOrder = ['t1', 't2'];

    const res = toggleCollapse({
      tabs,
      tabOrder,
      groups,
      groupId: 'g1',
      collapsed: true,
      activeTabId: 't1',
      mruOrder,
    });

    assert.strictEqual(res.groups.g1.collapsed, true);
    assert.strictEqual(res.nextActiveTabId, 't3', 'Falls back to first non-grouped tab in tabOrder (t3)');
  });

  it('Move group to new window: Preserves group chip, colors, and member tabs in window state', async () => {
    const { reducer, actions } = await loadDeps();
    let state = {
      tabs: {},
      tabOrder: [],
      mruOrder: [],
      currentTabId: null,
      tabGroups: {},
    };

    const movedGroupPayload = {
      group: { id: 'g-designer', title: 'Designer', color: 'blue', collapsed: false },
      tabs: [
        { id: 'tab-1', url: 'https://canva.com', title: 'Canva', favicon: null },
        { id: 'tab-2', url: 'https://figma.com', title: 'Figma', favicon: null },
      ],
      activeTabId: 'tab-1',
    };

    // Simulate new window init handling movedGroup bootstrap payload
    state = reducer(state, actions.setTabGroups({ [movedGroupPayload.group.id]: movedGroupPayload.group }));
    state = reducer(state, actions.addTab({
      id: 'tab-1',
      initialUrl: 'https://canva.com',
      groupId: 'g-designer',
    }));
    state = reducer(state, actions.addSleepingTab({
      id: 'tab-2',
      url: 'https://figma.com',
      title: 'Figma',
      groupId: 'g-designer',
    }));
    state = reducer(state, actions.setCurrentTab('tab-1'));

    assert.strictEqual(state.tabGroups['g-designer'].title, 'Designer');
    assert.strictEqual(state.tabGroups['g-designer'].color, 'blue');
    assert.strictEqual(state.tabs['tab-1'].groupId, 'g-designer');
    assert.strictEqual(state.tabs['tab-2'].groupId, 'g-designer');
    assert.deepStrictEqual(state.tabOrder, ['tab-1', 'tab-2']);
    assert.strictEqual(state.currentTabId, 'tab-1');
  });
});

