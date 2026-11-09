const { describe, it } = require('node:test');
const assert = require('node:assert');

async function loadSlice() {
  const mod = await import('../../../src/store/browserSlice.js');
  return {
    reducer: mod.default,
    actions: mod,
  };
}

describe('BrowserSlice Tab Groups Reducers & Split Tab Integration', () => {
  it('creates a tab group and joins tabs', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    // Add two tabs
    state = reducer(state, actions.addTab({ id: 't1', initialUrl: 'https://example.com' }));
    state = reducer(state, actions.addTab({ id: 't2', initialUrl: 'https://google.com' }));

    assert.strictEqual(state.tabOrder.length, 2);

    // Group t1 and t2
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1', 't2'], title: 'Work', color: 'blue' }));

    const groupIds = Object.keys(state.tabGroups);
    assert.strictEqual(groupIds.length, 1);
    const gid = groupIds[0];
    assert.strictEqual(state.tabGroups[gid].title, 'Work');
    assert.strictEqual(state.tabGroups[gid].color, 'blue');
    assert.strictEqual(state.tabs.t1.groupId, gid);
    assert.strictEqual(state.tabs.t2.groupId, gid);
  });

  it('atomically includes companion split tabs in group operations', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1', initialUrl: 'https://example.com' }));
    state = reducer(state, actions.addTab({ id: 't2', initialUrl: 'https://google.com' }));

    // Create split group between t1 and t2
    state = reducer(state, actions.setSplitGroup({
      pair: { id: 'split-1', leftTabId: 't1', rightTabId: 't2', ratio: 0.5, focusedSide: 'left' }
    }));

    assert.strictEqual(state.tabs.t1.splitPairId, 'split-1');
    assert.strictEqual(state.tabs.t2.splitPairId, 'split-1');

    // Grouping only t1 automatically groups companion t2 as well!
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1'], title: 'Split Group' }));

    const gid = Object.keys(state.tabGroups)[0];
    assert.strictEqual(state.tabs.t1.groupId, gid);
    assert.strictEqual(state.tabs.t2.groupId, gid);
    assert.strictEqual(state.tabs.t1.splitPairId, 'split-1');
    assert.strictEqual(state.tabs.t2.splitPairId, 'split-1');
  });

  it('closing the last tab in a group cleans up the group (Invariant I2)', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1', initialUrl: 'https://example.com' }));
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1'], title: 'Single' }));

    assert.strictEqual(Object.keys(state.tabGroups).length, 1);

    // Remove t1
    state = reducer(state, actions.removeTab('t1'));
    assert.strictEqual(Object.keys(state.tabGroups).length, 0);
  });

  it('pinning a grouped tab ungroups it without leaving group in broken state (Invariant I4)', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1', initialUrl: 'https://example.com' }));
    state = reducer(state, actions.addTab({ id: 't2', initialUrl: 'https://google.com' }));
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1', 't2'], title: 'Pinned Test' }));

    const gid = Object.keys(state.tabGroups)[0];

    // Pin t1
    state = reducer(state, actions.setTabPinned({ id: 't1', pinned: true }));
    assert.strictEqual(state.tabs.t1.isPinned, true);
    assert.strictEqual(state.tabs.t1.groupId, null);
    // t2 is still in the group
    assert.strictEqual(state.tabs.t2.groupId, gid);
    assert.ok(state.tabGroups[gid]);
  });

  it('collapsing group updates activeTab if active was inside', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1' }));
    state = reducer(state, actions.addTab({ id: 't2' }));
    state = reducer(state, actions.addTab({ id: 't3' }));

    state = reducer(state, actions.createTabGroup({ tabIds: ['t1', 't2'] }));
    const gid = Object.keys(state.tabGroups)[0];

    state = reducer(state, actions.setCurrentTab('t1'));
    assert.strictEqual(state.currentTabId, 't1');

    state = reducer(state, actions.toggleGroupCollapse({ groupId: gid, collapsed: true }));
    assert.strictEqual(state.tabGroups[gid].collapsed, true);
    // Switched away from t1 to outside tab t3
    assert.strictEqual(state.currentTabId, 't3');

    // Switching back to t1 automatically expands the group (Invariant I5)
    state = reducer(state, actions.setCurrentTab('t1'));
    assert.strictEqual(state.tabGroups[gid].collapsed, false);
  });

  it('reorderTabs reconciles drag: joining group when dropped inside, un-grouping when dropped outside', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1' }));
    state = reducer(state, actions.addTab({ id: 't2' }));
    state = reducer(state, actions.addTab({ id: 't3' }));
    state = reducer(state, actions.addTab({ id: 't4' }));

    // Group t1 and t2
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1', 't2'], title: 'Group 1' }));
    const gid = Object.keys(state.tabGroups)[0];

    // Drag t3 (ungrouped) between t1 and t2: ['t1', 't3', 't2', 't4']
    state = reducer(state, actions.reorderTabs(['t1', 't3', 't2', 't4']));
    assert.strictEqual(state.tabs.t3.groupId, gid); // t3 joins group 1!

    // Drag t1 past t4 (outside group): ['t3', 't2', 't4', 't1']
    state = reducer(state, actions.reorderTabs(['t3', 't2', 't4', 't1']));
    assert.strictEqual(state.tabs.t1.groupId, null); // t1 left group 1!
    assert.strictEqual(state.tabs.t3.groupId, gid);
    assert.strictEqual(state.tabs.t2.groupId, gid);
  });

  it('joins group when dropped with targetGroupId over group chip or member tab', async () => {
    const { reducer, actions } = await loadSlice();
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1' }));
    state = reducer(state, actions.addTab({ id: 't2' }));

    // Group only t1 (1-tab group)
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1'], title: 'Solo Group' }));
    const gid = Object.keys(state.tabGroups)[0];

    // Drag t2 over the solo group chip / tab with targetGroupId
    state = reducer(state, actions.reorderTabs({ tabOrder: ['t2', 't1'], movedTabId: 't2', targetGroupId: gid }));
    assert.strictEqual(state.tabs.t2.groupId, gid); // t2 joined the group!
    assert.deepStrictEqual(state.tabOrder, ['t2', 't1']);
  });

  it('moves whole group cleanly via moveTabGroup action', async () => {
    const { reducer, actions } = await loadSlice();
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, actions.addTab({ id: 't1' }));
    state = reducer(state, actions.addTab({ id: 't2' }));
    state = reducer(state, actions.addTab({ id: 't3' }));
    state = reducer(state, actions.addTab({ id: 't4' }));

    // Group t1 and t2 at index 0
    state = reducer(state, actions.createTabGroup({ tabIds: ['t1', 't2'], title: 'Alpha' }));
    const gid = Object.keys(state.tabGroups)[0];

    // Move group Alpha to the end (insertIndex 4)
    state = reducer(state, actions.moveTabGroup({ groupId: gid, targetIndex: 4 }));
    assert.strictEqual(state.tabs.t1.groupId, gid);
    assert.strictEqual(state.tabs.t2.groupId, gid);
    // Members moved together to the end: t3, t4, t1, t2
    assert.deepStrictEqual(state.tabOrder, ['t3', 't4', 't1', 't2']);
  });
});
