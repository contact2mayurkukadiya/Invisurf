'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Chrome Tab Groups E2E Verification', () => {
  test('creates a tab group, customizes title & color in popup, collapses/expands, and ungroups', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    shellWindow.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    shellWindow.on('pageerror', err => console.log('BROWSER ERROR:', err));

    // 1. Wait for tab bar and add-tab button
    await expect(shellWindow.locator('#add-tab')).toBeVisible({ timeout: 10000 });
    const initialTabs = shellWindow.locator('.tab');
    await expect(initialTabs.first()).toBeVisible();

    // 2. Add two new tabs so we have 3 tabs
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);

    const tabsAfterAdd = shellWindow.locator('.tab');
    await expect(tabsAfterAdd).toHaveCount(3);

    const tab0Id = await tabsAfterAdd.nth(0).getAttribute('id');
    const tab1Id = await tabsAfterAdd.nth(1).getAttribute('id');
    const tab2Id = await tabsAfterAdd.nth(2).getAttribute('id');

    // 3. Create a tab group containing tab0 and tab1 via custom event / Redux
    await shellWindow.evaluate(({ ids }) => {
      window.dispatchEvent(new CustomEvent('invisurf:create-group-for-tabs', {
        detail: { tabIds: ids, title: 'Research' }
      }));
    }, { ids: [tab0Id, tab1Id] });
    await shellWindow.waitForTimeout(400);

    // 4. Verify GroupChip appears on the tab bar
    const groupChip = shellWindow.locator('.group-chip');
    await expect(groupChip).toBeVisible({ timeout: 5000 });
    await expect(groupChip.locator('.group-chip-title')).toHaveText('Research');

    // 5. Verify member tabs have the .tab--in-group underline
    const groupedTabs = shellWindow.locator('.tab--in-group');
    await expect(groupedTabs).toHaveCount(2);

    // 6. Open GroupEditorPopup by right-clicking the chip
    await groupChip.click({ button: 'right' });
    await shellWindow.waitForTimeout(400);

    const getOverlayPage = () => {
      const candidates = [
        ...invisurfApp.app.context().pages(),
        ...invisurfApp.app.windows(),
      ];
      return candidates.find((p) => p.url().includes('chrome-overlay.html?shellMenu=1')) || null;
    };

    await expect.poll(() => getOverlayPage() !== null, { timeout: 6000 }).toBe(true);
    const targetScope = getOverlayPage() || shellWindow;
    const editorPopup = targetScope.locator('.group-editor-popup');
    await expect(editorPopup).toBeVisible({ timeout: 5000 });

    // 7. Change title to 'Projects' and pick 'blue' swatch
    const titleInput = editorPopup.locator('.group-editor-title-input');
    await titleInput.fill('Projects');

    const blueSwatch = editorPopup.locator('.group-editor-swatch[data-color="blue"]');
    await blueSwatch.click();
    await shellWindow.waitForTimeout(200);

    // Close popup by pressing Escape
    await targetScope.keyboard.press('Escape');
    await expect(editorPopup).not.toBeVisible();

    // Verify chip title updated to 'Projects' and swatch is blue
    await expect(groupChip.locator('.group-chip-title')).toHaveText('Projects');

    // 8. Test Collapse & Expand (Rule I5)
    // Click chip to collapse
    await groupChip.click();
    await shellWindow.waitForTimeout(300);

    // Chip should have collapsed class and no tab count badge (per design)
    await expect(groupChip).toHaveClass(/group-chip--collapsed/);
    const countBadge = groupChip.locator('.group-chip-count');
    await expect(countBadge).toHaveCount(0);

    // The two member tabs should now be collapsed (width 0, tab--collapsed-member)
    await expect(shellWindow.locator('.tab--collapsed-member')).toHaveCount(2);
    await expect(shellWindow.locator('.tab:not(.tab--collapsed-member)')).toHaveCount(1);
    await expect(shellWindow.locator('.tab:not(.tab--collapsed-member)').first()).toHaveAttribute('id', tab2Id);

    // Click chip again to expand
    await groupChip.click();
    await shellWindow.waitForTimeout(300);

    await expect(groupChip).not.toHaveClass(/group-chip--collapsed/);
    await expect(shellWindow.locator('.tab--collapsed-member')).toHaveCount(0);
    await expect(shellWindow.locator('.tab:not(.tab--collapsed-member)')).toHaveCount(3);

    // 9. Ungroup via popup action
    await groupChip.click({ button: 'right' });
    await shellWindow.waitForTimeout(300);
    await expect(editorPopup).toBeVisible();

    const ungroupBtn = editorPopup.locator('.group-editor-action-btn', { hasText: 'Ungroup' });
    await ungroupBtn.click();
    await shellWindow.waitForTimeout(300);

    // Group chip should be gone, but all 3 tabs remain
    await expect(groupChip).toHaveCount(0);
    await expect(shellWindow.locator('.tab')).toHaveCount(3);
    await expect(shellWindow.locator('.tab--in-group')).toHaveCount(0);
  });

  test('coexists seamlessly with split tabs inside a group', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    await expect(shellWindow.locator('#add-tab')).toBeVisible({ timeout: 10000 });
    const initialTabs = shellWindow.locator('.tab');
    await expect(initialTabs.first()).toBeVisible();

    // Create a group for the initial tab
    const tab0Id = await initialTabs.first().getAttribute('id');
    await shellWindow.evaluate((tid) => {
      window.dispatchEvent(new CustomEvent('invisurf:create-group-for-tabs', {
        detail: { tabIds: [tid], title: 'Split Group' }
      }));
    }, tab0Id);
    await shellWindow.waitForTimeout(400);

    const groupChip = shellWindow.locator('.group-chip');
    await expect(groupChip).toBeVisible();

    // Now enter split view on tab0
    await shellWindow.evaluate((tid) => {
      window.electronAPI?.splitTabEnter?.(tid, 'choose-tab');
    }, tab0Id);
    await shellWindow.waitForTimeout(500);

    // Split compound tab should be visible and also have .tab--in-group styling
    const splitTab = shellWindow.locator('.split-compound-tab');
    await expect(splitTab).toBeVisible({ timeout: 5000 });
    await expect(splitTab).toHaveClass(/tab--in-group/);

    // Both mini-tabs are preserved inside the group
    await expect(splitTab.locator('.split-mini-tab--left')).toBeVisible();
    await expect(splitTab.locator('.split-mini-tab--right')).toBeVisible();
  });

  test('renders connected 3-sided border on active tab, bottom-only border on inactive tab, and supports drag-to-join & group sorting', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    await expect(shellWindow.locator('#add-tab')).toBeVisible({ timeout: 10000 });
    const addTabBtn = shellWindow.locator('#add-tab');

    // Add tabs so we have tab0, tab1, tab2
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);

    const tabs = shellWindow.locator('.tab');
    await expect(tabs).toHaveCount(3);
    const tab0Id = await tabs.nth(0).getAttribute('id');
    const tab1Id = await tabs.nth(1).getAttribute('id');
    const tab2Id = await tabs.nth(2).getAttribute('id');

    // Create group for tab0 and tab1: "Designer"
    await shellWindow.evaluate(({ ids }) => {
      window.dispatchEvent(new CustomEvent('invisurf:create-group-for-tabs', {
        detail: { tabIds: ids, title: 'Designer' }
      }));
    }, { ids: [tab0Id, tab1Id] });
    await shellWindow.waitForTimeout(400);

    const groupChipWrapper = shellWindow.locator('.group-chip-wrapper');
    await expect(groupChipWrapper).toBeVisible();
    await expect(groupChipWrapper).not.toHaveClass(/group-chip-wrapper--collapsed/);

    // Switch to tab0 so tab0 is ACTIVE and tab1 is INACTIVE
    await tabs.nth(0).click();
    await shellWindow.waitForTimeout(200);

    // Verify active tab in group has the unified Chrome connected border contour
    const activeTab = shellWindow.locator('.tab--in-group.active');
    await expect(activeTab).toBeVisible();
    const activeBorder = activeTab.locator('.tab-group-active-border');
    await expect(activeBorder).toBeVisible();
    await expect(activeBorder.locator('.tab-group-active-border__left')).toBeVisible();
    await expect(activeBorder.locator('.tab-group-active-border__top')).toBeVisible();
    await expect(activeBorder.locator('.tab-group-active-border__right')).toBeVisible();

    // Verify inactive tab in group does NOT have the active border contour, but HAS .tab-group-bottom-bar
    const inactiveTab = shellWindow.locator('.tab--in-group:not(.active)');
    await expect(inactiveTab).toBeVisible();
    await expect(inactiveTab.locator('.tab-group-active-border')).toHaveCount(0);
    await expect(inactiveTab.locator('.tab-group-bottom-bar')).toBeVisible();

    // Test dragging tab2 (ungrouped) onto the group chip to join the group using pointer movement
    const tab2El = shellWindow.locator(`#${tab2Id}`);
    const chipEl = shellWindow.locator('.group-chip');
    const tab2BBox = await tab2El.boundingBox();
    const chipBBox = await chipEl.boundingBox();
    if (tab2BBox && chipBBox) {
      await shellWindow.mouse.move(tab2BBox.x + tab2BBox.width / 2, tab2BBox.y + tab2BBox.height / 2);
      await shellWindow.mouse.down();
      await shellWindow.mouse.move(chipBBox.x + chipBBox.width / 2, chipBBox.y + chipBBox.height / 2, { steps: 10 });
      await shellWindow.mouse.up();
      await shellWindow.waitForTimeout(500);
    }

    // Tab2 should now be part of the group!
    const allGroupedTabs = shellWindow.locator('.tab--in-group');
    await expect(allGroupedTabs).toHaveCount(3);

    // Verify all inactive tabs in the multi-tab group have continuous bottom bars
    const inactiveGroupedTabs = shellWindow.locator('.tab--in-group:not(.active)');
    await expect(inactiveGroupedTabs).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(inactiveGroupedTabs.nth(i).locator('.tab-group-bottom-bar')).toBeVisible();
    }

    // Capture visual verification screenshots
    const artifactDir = '/Users/mayurkukadiya/.gemini/antigravity/brain/4a55070a-1712-4015-b363-d36e8aabb3f6';
    const tabBarEl = shellWindow.locator('.tab-bar');

    // Case 1: Tab 0 active in group
    await tabs.nth(0).click();
    await shellWindow.waitForTimeout(300);
    await tabBarEl.screenshot({ path: `${artifactDir}/multi-tab-group-first-active.png` });

    // Case 2: Tab 2 (last tab in group) active
    await tabs.nth(2).click();
    await shellWindow.waitForTimeout(300);
    await tabBarEl.screenshot({ path: `${artifactDir}/multi-tab-group-last-active.png` });

    // Case 3: Tab 1 (middle tab in group) active
    await tabs.nth(1).click();
    await shellWindow.waitForTimeout(300);
    await tabBarEl.screenshot({ path: `${artifactDir}/multi-tab-group-middle-active.png` });

    // Add a 4th tab outside the group
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);
    // Tab 3 (outside group) is active -> all 3 group tabs are inactive
    await tabBarEl.screenshot({ path: `${artifactDir}/multi-tab-group-all-inactive.png` });

    // Test dragging the whole group chip to the end of the tab strip
    const newChipBBox = await chipEl.boundingBox();
    const tabTrackBBox = await shellWindow.locator('.tab-track').boundingBox();
    if (newChipBBox && tabTrackBBox) {
      await shellWindow.mouse.move(newChipBBox.x + newChipBBox.width / 2, newChipBBox.y + newChipBBox.height / 2);
      await shellWindow.mouse.down();
      // Drag past the rightmost edge
      await shellWindow.mouse.move(tabTrackBBox.x + tabTrackBBox.width + 50, newChipBBox.y + newChipBBox.height / 2, { steps: 5 });
      await shellWindow.mouse.up();
      await shellWindow.waitForTimeout(500);
    }

    // Verify the group chip and all 3 member tabs are still intact and grouped
    await expect(shellWindow.locator('.group-chip')).toBeVisible();
    await expect(shellWindow.locator('.tab--in-group')).toHaveCount(3);
  });

  test('collapses group when 0 non-grouped tabs exist and active tab is inside group, automatically creating and activating a new tab', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    await expect(shellWindow.locator('#add-tab')).toBeVisible({ timeout: 10000 });

    // 1. Start with 2 tabs and put BOTH into a single group (0 non-grouped tabs)
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);

    const tabs = shellWindow.locator('.tab');
    await expect(tabs).toHaveCount(2);
    const tab0Id = await tabs.nth(0).getAttribute('id');
    const tab1Id = await tabs.nth(1).getAttribute('id');

    await shellWindow.evaluate(({ ids }) => {
      window.dispatchEvent(new CustomEvent('invisurf:create-group-for-tabs', {
        detail: { tabIds: ids, title: 'AI' }
      }));
    }, { ids: [tab0Id, tab1Id] });
    await shellWindow.waitForTimeout(400);

    // Verify both tabs are in group
    await expect(shellWindow.locator('.tab--in-group')).toHaveCount(2);
    const groupChip = shellWindow.locator('.group-chip');
    await expect(groupChip).toBeVisible();

    // Verify active tab is tab1 (inside the group)
    const activeTab = shellWindow.locator('.tab.active');
    await expect(activeTab).toHaveCount(1);
    await expect(activeTab).toHaveClass(/tab--in-group/);

    // 2. Click the group chip to collapse it
    await groupChip.click();
    await shellWindow.waitForTimeout(600);

    // 3. Group should be collapsed
    await expect(groupChip).toHaveClass(/group-chip--collapsed/);

    // 4. A new tab must have been automatically created outside the group and activated!
    const tabsAfterCollapse = shellWindow.locator('.tab');
    await expect(tabsAfterCollapse).toHaveCount(3); // 2 grouped + 1 new tab

    const newActiveTab = shellWindow.locator('.tab.active');
    await expect(newActiveTab).toHaveCount(1);
    await expect(newActiveTab).not.toHaveClass(/tab--in-group/);
    await expect(newActiveTab).toBeVisible();

    // Capture screenshot proving the fix
    const artifactDir = '/Users/mayurkukadiya/.gemini/antigravity/brain/4a55070a-1712-4015-b363-d36e8aabb3f6';
    await shellWindow.locator('.tab-bar').screenshot({ path: `${artifactDir}/collapse-zero-non-grouped-creates-new-tab.png` });
  });
});
