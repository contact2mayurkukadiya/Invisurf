const { describe, it } = require('node:test');
const assert = require('node:assert');

async function loadSlice() {
  const mod = await import('../../../src/store/browserSlice.js');
  const model = await import('../../../src/utils/tabGroupModel.js');
  return {
    reducer: mod.default,
    actions: mod,
    repairInvariants: model.repairInvariants,
  };
}

describe('Tab Groups Session Persistence & Rehydration', () => {
  it('does not drop tab groups when tabOrder is empty during initial load', async () => {
    const { repairInvariants } = await loadSlice();
    const savedGroups = {
      'group-1': { id: 'group-1', title: 'Work', color: 'blue', collapsed: false },
      'group-2': { id: 'group-2', title: 'Personal', color: 'red', collapsed: false },
    };

    // When tabOrder is empty (before tabs are mounted/registered)
    const repaired = repairInvariants({}, [], savedGroups, null);
    assert.deepStrictEqual(repaired.groups, savedGroups);
  });

  it('preserves tab groups when restoring session in Redux state', async () => {
    const { reducer, actions } = await loadSlice();

    let state = reducer(undefined, { type: '@@INIT' });

    const savedGroups = {
      'g-123': { id: 'g-123', title: 'Design', color: 'blue', collapsed: false },
    };

    // 1. Dispatch setTabGroups first (as on sessionLoad / restoreWindow)
    state = reducer(state, actions.setTabGroups(savedGroups));
    assert.strictEqual(Object.keys(state.tabGroups).length, 1);
    assert.strictEqual(state.tabGroups['g-123'].title, 'Design');

    // 2. Add tabs belonging to the group (active and sleeping)
    state = reducer(state, actions.addTab({
      id: 'tab-1',
      initialUrl: 'https://figma.com',
      groupId: 'g-123',
    }));
    state = reducer(state, actions.addSleepingTab({
      id: 'tab-2',
      url: 'https://canva.com',
      title: 'Canva',
      groupId: 'g-123',
    }));
    state = reducer(state, actions.addSleepingTab({
      id: 'tab-3',
      url: 'https://dribbble.com',
      title: 'Dribbble',
      groupId: 'g-123',
    }));

    assert.strictEqual(state.tabs['tab-1'].groupId, 'g-123');
    assert.strictEqual(state.tabs['tab-2'].groupId, 'g-123');
    assert.strictEqual(state.tabs['tab-3'].groupId, 'g-123');

    // 3. Dispatch setTabGroups to finalize rehydration and invariant check
    state = reducer(state, actions.setTabGroups(savedGroups));
    assert.strictEqual(Object.keys(state.tabGroups).length, 1);
    assert.strictEqual(state.tabs['tab-1'].groupId, 'g-123');
    assert.strictEqual(state.tabs['tab-2'].groupId, 'g-123');
    assert.strictEqual(state.tabs['tab-3'].groupId, 'g-123');
  });

  it('restores window bootstrap with tabGroups and splitGroups cleanly', async () => {
    const { reducer, actions } = await loadSlice();
    let state = reducer(undefined, { type: '@@INIT' });

    const bootstrapRestoreWindow = {
      tabs: [
        { id: 'tab-a', url: 'https://github.com', groupId: 'g-code', splitPairId: 'split-ab' },
        { id: 'tab-b', url: 'https://gitlab.com', groupId: 'g-code', splitPairId: 'split-ab' },
        { id: 'tab-c', url: 'https://stackoverflow.com', groupId: 'g-code' },
      ],
      activeTabId: 'tab-a',
      splitGroups: {
        'split-ab': { id: 'split-ab', leftTabId: 'tab-a', rightTabId: 'tab-b', ratio: 0.5, focusedSide: 'left' },
      },
      tabGroups: {
        'g-code': { id: 'g-code', title: 'Code', color: 'green', collapsed: false },
      },
    };

    // Hydrate state following App.jsx bootstrap sequence:
    // 1. Initial groups setup
    state = reducer(state, actions.setTabGroups(bootstrapRestoreWindow.tabGroups));

    // 2. Add tabs
    state = reducer(state, actions.addTab({
      id: 'tab-a',
      initialUrl: 'https://github.com',
      splitPairId: 'split-ab',
      groupId: 'g-code',
    }));
    state = reducer(state, actions.addSleepingTab({
      id: 'tab-b',
      url: 'https://gitlab.com',
      title: 'GitLab',
      splitPairId: 'split-ab',
      groupId: 'g-code',
    }));
    state = reducer(state, actions.addSleepingTab({
      id: 'tab-c',
      url: 'https://stackoverflow.com',
      title: 'StackOverflow',
      groupId: 'g-code',
    }));

    // 3. Set split groups
    state = reducer(state, actions.setSplitGroup({
      pair: bootstrapRestoreWindow.splitGroups['split-ab'],
    }));

    // 4. Final invariant verification
    state = reducer(state, actions.setTabGroups(bootstrapRestoreWindow.tabGroups));

    assert.strictEqual(state.tabOrder.length, 3);
    assert.strictEqual(state.tabs['tab-a'].groupId, 'g-code');
    assert.strictEqual(state.tabs['tab-b'].groupId, 'g-code');
    assert.strictEqual(state.tabs['tab-c'].groupId, 'g-code');
    assert.strictEqual(state.tabGroups['g-code'].title, 'Code');
    assert.strictEqual(state.tabs['tab-a'].splitPairId, 'split-ab');
    assert.strictEqual(state.tabs['tab-b'].splitPairId, 'split-ab');
  });
});
