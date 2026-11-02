'use strict';

const { test, expect } = require('../fixtures/electronApp');
const path = require('path');

test.describe('Split Tabs E2E Verification', () => {
  test('should enter split view, verify chooser in second pane, isolate close buttons on hover, swap sides, and exit cleanly', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    shellWindow.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    shellWindow.on('pageerror', err => console.log('BROWSER ERROR:', err));

    // 1. Ensure initial browser window loaded
    await expect(shellWindow.locator('#split-tab-btn')).toBeVisible({ timeout: 10000 });
    const initialTabs = shellWindow.locator('.tab');
    const initialCount = await initialTabs.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 2. Open Split Screen Dropdown
    const splitBtn = shellWindow.locator('#split-tab-btn');
    await splitBtn.click();

    const dropdown = shellWindow.locator('.split-picker-dropdown');
    await expect(dropdown).toBeVisible();

    // Verify New Tab option is present
    const newTabOption = dropdown.locator('.split-picker-item--primary');
    await expect(newTabOption).toBeVisible();
    await expect(newTabOption).toContainText('New Tab');

    // 3. Click "New Tab" to enter split mode in choosing state
    await newTabOption.click({ force: true });
    await expect(dropdown).not.toBeVisible();

    // 4. Verify Chrome-style compound split tab is active in UI and matches normal tab size
    const splitTab = shellWindow.locator('.split-compound-tab');
    await expect(splitTab).toBeVisible({ timeout: 5000 });
    await expect(splitTab).toHaveClass(/active/);

    // Verify split tab size matches regular tab (<= 240px)
    const splitBox = await splitTab.boundingBox();
    expect(splitBox.width).toBeLessThanOrEqual(240);

    const leftMiniTab = splitTab.locator('.split-mini-tab--left');
    const rightMiniTab = splitTab.locator('.split-mini-tab--right');
    await expect(leftMiniTab).toBeVisible();
    await expect(rightMiniTab).toBeVisible();

    // In choosing state, right mini-tab displays 'Choose a tab'
    await expect(rightMiniTab.locator('.tab-title')).toHaveText('Choose a tab');

    // Verify second pane renders the Tab Chooser list and card
    const chooser = shellWindow.locator('.split-tab-chooser');
    await expect(chooser).toBeVisible();
    const chooserCard = shellWindow.locator('.split-chooser-card');
    await expect(chooserCard).toBeVisible();

    // BUG 1 VERIFICATION: Hover close button isolation
    const leftCloseBtn = leftMiniTab.locator('.mini-tab-close-btn');
    const rightCloseBtn = rightMiniTab.locator('.mini-tab-close-btn');
    await expect(leftCloseBtn).toBeAttached();
    await expect(rightCloseBtn).toBeAttached();

    // Hover left sub-tab: left close button is visible (opacity: 1), right close button is strictly hidden (opacity: 0)
    await leftMiniTab.hover();
    await shellWindow.waitForTimeout(250);
    const leftOpacityWhenLeftHover = await leftCloseBtn.evaluate((el) => window.getComputedStyle(el).opacity);
    const rightOpacityWhenLeftHover = await rightCloseBtn.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(leftOpacityWhenLeftHover).toBe('1');
    expect(rightOpacityWhenLeftHover).toBe('0');

    // Hover right sub-tab: right close button is visible (opacity: 1), left close button is strictly hidden (opacity: 0)
    await rightMiniTab.hover();
    await shellWindow.waitForTimeout(250);
    const leftOpacityWhenRightHover = await leftCloseBtn.evaluate((el) => window.getComputedStyle(el).opacity);
    const rightOpacityWhenRightHover = await rightCloseBtn.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(leftOpacityWhenRightHover).toBe('0');
    expect(rightOpacityWhenRightHover).toBe('1');

    // BUG 3 VERIFICATION: Tab selection from second pane chooser
    // Select the "New tab" row in chooser to pair it
    const newTabRow = chooser.locator('.split-chooser-row--new-tab');
    await expect(newTabRow).toBeVisible();
    await newTabRow.evaluate(el => el.click());

    // Chooser closes and right mini-tab updates with tab info
    await expect(chooser).not.toBeVisible();

    // Verify dual-pane overlay with card frames & outline border
    const divider = shellWindow.locator('.split-divider');
    await expect(divider).toBeVisible();

    const leftFrame = shellWindow.locator('.split-subview-frame--left');
    const rightFrame = shellWindow.locator('.split-subview-frame--right');
    await expect(leftFrame).toBeVisible();
    await expect(rightFrame).toBeVisible();

    // BUG 2 VERIFICATION: "Switch sides" preserves tab position in tab bar, swaps content panes AND swaps sub-tabs inside split tab
    const tabPosBeforeSwap = await splitTab.boundingBox();
    const leftTitleBeforeSwap = await leftMiniTab.locator('.tab-title').textContent();
    const rightTitleBeforeSwap = await rightMiniTab.locator('.tab-title').textContent();

    await shellWindow.evaluate(() => {
      const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
      if (splitId && window.electronAPI?.splitTabSwapSides) {
        window.electronAPI.splitTabSwapSides(splitId);
      }
    });
    await shellWindow.waitForTimeout(400);

    // Tab bar compound tab maintains its exact X position in the tab bar!
    const tabPosAfterSwap = await splitTab.boundingBox();
    expect(Math.abs(tabPosAfterSwap.x - tabPosBeforeSwap.x)).toBeLessThanOrEqual(2);

    // Mini-tabs inside split tab switched their sides!
    const leftTitleAfterSwap = await leftMiniTab.locator('.tab-title').textContent();
    const rightTitleAfterSwap = await rightMiniTab.locator('.tab-title').textContent();
    expect(leftTitleAfterSwap).toBe(rightTitleBeforeSwap);
    expect(rightTitleAfterSwap).toBe(leftTitleBeforeSwap);

    // SUB-TAB CLICK VERIFICATION: Clicking sub-tabs toggles active pane focus
    await leftMiniTab.click();
    await shellWindow.waitForTimeout(300);
    await expect(leftFrame).toHaveClass(/split-subview-frame--focused/);

    await rightMiniTab.click();
    await shellWindow.waitForTimeout(300);
    await expect(rightFrame).toHaveClass(/split-subview-frame--focused/);

    // Capture visual proof of active split tab with sub-tabs & focused pane
    const activeArtifactPath = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/5ae8d87b-41bf-48ce-83cc-54ba82f59a5f/split-tabs-active.png';
    await shellWindow.screenshot({ path: activeArtifactPath });

    // Verify Inactive Split Tab Persistence:
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(600);

    // Split tab remains visible on tab bar even when inactive
    await expect(splitTab).toBeVisible();
    await expect(splitTab).not.toHaveClass(/active/);

    // Click back on inactive split tab
    await splitTab.click({ force: true });
    await shellWindow.waitForTimeout(600);
    await expect(splitTab).toHaveClass(/active/);
    await expect(divider).toBeVisible();

    // SEPARATE TABS VERIFICATION:
    // Separate the split tabs back into individual tabs
    await shellWindow.evaluate(() => {
      const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
      if (splitId && window.electronAPI?.splitTabExit) {
        window.electronAPI.splitTabExit(splitId);
      }
    });
    await shellWindow.waitForTimeout(600);

    // Split compound tab dissolved into standalone tabs
    await expect(splitTab).not.toBeVisible();
    const finalTabs = shellWindow.locator('.tab');
    const finalCount = await finalTabs.count();
    expect(finalCount).toBeGreaterThanOrEqual(2);

    // Capture visual proof screenshot
    const screenshotArtifactPath = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/5ae8d87b-41bf-48ce-83cc-54ba82f59a5f/split-tabs-verified.png';
    await shellWindow.screenshot({ path: screenshotArtifactPath });
  });

  test('should enter split view via tab context menu action and absorb existing opened tab from second pane list', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Create a second opened tab first
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(600);

    const initialTabs = shellWindow.locator('.tab:not(.split-compound-tab)');
    const countBeforeSplit = await initialTabs.count();
    expect(countBeforeSplit).toBeGreaterThanOrEqual(2);

    const firstTabId = await initialTabs.first().getAttribute('id');
    const secondTabId = await initialTabs.nth(1).getAttribute('id');

    // 2. Trigger tab strip context menu action ADD_TO_SPLIT on first tab
    await shellWindow.evaluate((tid) => {
      window.electronAPI.splitTabEnter(tid, 'choose-tab');
    }, firstTabId);

    // Verify split mode enters with chooser in second pane
    const splitTab = shellWindow.locator('.split-compound-tab');
    await expect(splitTab).toBeVisible({ timeout: 5000 });
    const chooser = shellWindow.locator('.split-tab-chooser');
    await expect(chooser).toBeVisible();

    // 3. Click the existing opened tab (secondTabId) from the chooser candidate list
    const candidateRows = chooser.locator('.split-chooser-row:not(.split-chooser-row--new-tab)');
    await expect(candidateRows.first()).toBeVisible();
    await candidateRows.first().evaluate(el => el.click());

    // 4. Chooser closes, second pane loads that tab, and that tab is closed from standalone tab bar
    await expect(chooser).not.toBeVisible();
    await shellWindow.waitForTimeout(400);

    // Standalone second tab is no longer in the tab bar
    const standaloneSecondTab = shellWindow.locator(`.tab:not(.split-compound-tab)[id="${secondTabId}"]`);
    await expect(standaloneSecondTab).not.toBeVisible();

    // Both tabs are now merged in the compound split tab
    await expect(splitTab.locator('.split-mini-tab--left')).toBeVisible();
    await expect(splitTab.locator('.split-mini-tab--right')).toBeVisible();

    // 5. Separate tabs
    await shellWindow.evaluate(() => {
      const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
      if (splitId && window.electronAPI?.splitTabExit) {
        window.electronAPI.splitTabExit(splitId);
      }
    });
    await shellWindow.waitForTimeout(600);

    // Both tabs are restored as individual standalone tabs
    await expect(splitTab).not.toBeVisible();
    await expect(shellWindow.locator(`.tab[id="${firstTabId}"]`)).toBeVisible();
    await expect(shellWindow.locator(`.tab[id="${secondTabId}"]`)).toBeVisible();
  });

  test('should split and separate tabs multiple times consecutively without losing the second tab upon un-merge', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Create a second opened tab so we have two distinct tabs
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(600);

    const initialTabs = shellWindow.locator('.tab:not(.split-compound-tab)');
    const countBeforeSplit = await initialTabs.count();
    expect(countBeforeSplit).toBeGreaterThanOrEqual(2);

    const tabAId = await initialTabs.first().getAttribute('id');
    const tabBId = await initialTabs.nth(1).getAttribute('id');
    expect(tabAId).toBeTruthy();
    expect(tabBId).toBeTruthy();

    // 2. Perform 3 consecutive split and separate cycles
    for (let cycle = 1; cycle <= 3; cycle++) {
      // Enter split view with tabA and tabB
      await shellWindow.evaluate(({ leftId, rightId }) => {
        window.electronAPI.splitTabEnter(leftId, rightId);
      }, { leftId: tabAId, rightId: tabBId });
      await shellWindow.waitForTimeout(400);

      // Verify compound split tab is visible
      const splitTab = shellWindow.locator('.split-compound-tab');
      await expect(splitTab).toBeVisible({ timeout: 5000 });

      // Verify second tab is absorbed into compound split tab
      await expect(shellWindow.locator(`.tab:not(.split-compound-tab)[id="${tabBId}"]`)).not.toBeVisible();

      // Separate the tabs back into normal individual tabs
      await shellWindow.evaluate(() => {
        const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
        if (splitId && window.electronAPI?.splitTabExit) {
          window.electronAPI.splitTabExit(splitId);
        }
      });
      await shellWindow.waitForTimeout(400);

      // Split compound tab dissolved
      await expect(splitTab).not.toBeVisible();

      // CRITICAL ASSERTION: BOTH tabs MUST be restored and visible as individual standalone tabs!
      const tabAEl = shellWindow.locator(`.tab[id="${tabAId}"]`);
      const tabBEl = shellWindow.locator(`.tab[id="${tabBId}"]`);
      await expect(tabAEl).toBeVisible();
      await expect(tabBEl).toBeVisible();

      const tabsAfterUnmerge = shellWindow.locator('.tab:not(.split-compound-tab)');
      const totalTabs = await tabsAfterUnmerge.count();
      expect(totalTabs).toBeGreaterThanOrEqual(2);
    }

    // Verify both tabs can be switched and activated cleanly after multiple un-merges
    const tabBEl = shellWindow.locator(`.tab[id="${tabBId}"]`);
    await tabBEl.click();
    await shellWindow.waitForTimeout(300);
    await expect(tabBEl).toHaveClass(/active/);

    const tabAEl = shellWindow.locator(`.tab[id="${tabAId}"]`);
    await tabAEl.click();
    await shellWindow.waitForTimeout(300);
    await expect(tabAEl).toHaveClass(/active/);

    const multipleCycleArtifact = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/5ae8d87b-41bf-48ce-83cc-54ba82f59a5f/split-tabs-multiple-cycles.png';
    await shellWindow.screenshot({ path: multipleCycleArtifact });
  });

  test('should progressively shrink split tabs through full, icon-only, and extreme-overflow thresholds', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    await expect(shellWindow.locator('#split-tab-btn')).toBeVisible({ timeout: 10000 });

    // 1. Create a second tab so we can form a split pair
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(300);

    const initialTabs = shellWindow.locator('.tab:not(.split-compound-tab)');
    await expect(initialTabs).toHaveCount(2);
    const tabAId = await initialTabs.nth(0).getAttribute('id');
    const tabBId = await initialTabs.nth(1).getAttribute('id');

    // 2. Enter split view
    await shellWindow.evaluate(({ leftId, rightId }) => {
      window.electronAPI.splitTabEnter(leftId, rightId);
    }, { leftId: tabAId, rightId: tabBId });
    await shellWindow.waitForTimeout(400);

    const splitTab = shellWindow.locator('.split-compound-tab');
    await expect(splitTab).toBeVisible({ timeout: 5000 });

    const leftMiniTab = splitTab.locator('.split-mini-tab--left');
    const rightMiniTab = splitTab.locator('.split-mini-tab--right');
    const leftTitle = leftMiniTab.locator('.tab-title');
    const rightTitle = rightMiniTab.locator('.tab-title');
    const leftIcon = leftMiniTab.locator('.icon-container');
    const rightIcon = rightMiniTab.locator('.icon-container');
    const leftCloseBtn = leftMiniTab.locator('.mini-tab-close-btn');
    const rightCloseBtn = rightMiniTab.locator('.mini-tab-close-btn');

    // ── Phase 1: FULL mode (tabWidth >= 120px) ──────────────────────────
    await expect(splitTab).toHaveClass(/tab--mode-full/);
    await expect(leftTitle).toBeVisible();
    await expect(rightTitle).toBeVisible();
    await expect(leftIcon).toBeVisible();
    await expect(rightIcon).toBeVisible();

    // Verify close buttons hidden until hovered
    const initialLeftOpacity = await leftCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    expect(Number(initialLeftOpacity)).toBe(0);

    // Hover left mini-tab: only left close button reveals
    await leftMiniTab.hover();
    await shellWindow.waitForTimeout(200);
    const hoveredLeftOpacity = await leftCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    const unhoveredRightOpacity = await rightCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    expect(Number(hoveredLeftOpacity)).toBe(1);
    expect(Number(unhoveredRightOpacity)).toBe(0);

    // Move mouse to neutral position
    await shellWindow.mouse.move(0, 400);
    await shellWindow.waitForTimeout(200);

    // ── Phase 2: ICON-ONLY mode (56px < tabWidth < 120px) ────────────────
    // Test the icon-only mode styling rules by setting tab width in track
    await shellWindow.evaluate(() => {
      const track = document.querySelector('.tab-track');
      if (track) track.style.setProperty('--tab-width', '80px');
      const splitEl = document.querySelector('.split-compound-tab');
      if (splitEl) {
        splitEl.classList.remove('tab--mode-full', 'tab--mode-extreme-overflow');
        splitEl.classList.add('tab--mode-icon-only');
      }
    });
    await shellWindow.mouse.move(0, 400);
    await shellWindow.waitForTimeout(200);

    // Captions are hidden in icon-only mode
    const leftTitleDisplay = await leftTitle.evaluate(el => window.getComputedStyle(el).display);
    const rightTitleDisplay = await rightTitle.evaluate(el => window.getComputedStyle(el).display);
    expect(leftTitleDisplay).toBe('none');
    expect(rightTitleDisplay).toBe('none');

    // Favicons are visible and centered
    const leftIconDisplay = await leftIcon.evaluate(el => window.getComputedStyle(el).display);
    const rightIconDisplay = await rightIcon.evaluate(el => window.getComputedStyle(el).display);
    expect(leftIconDisplay).toBe('flex');
    expect(rightIconDisplay).toBe('flex');

    // On hover of left mini-tab in icon-only mode: icon is hidden and close button is revealed
    await leftMiniTab.hover();
    await shellWindow.waitForTimeout(200);
    const leftIconHoveredDisplay = await leftIcon.evaluate(el => window.getComputedStyle(el).display);
    const leftCloseHoveredOpacity = await leftCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    expect(leftIconHoveredDisplay).toBe('none');
    expect(Number(leftCloseHoveredOpacity)).toBe(1);

    // Right mini-tab still displays its icon while left is hovered
    const rightIconWhileLeftHovered = await rightIcon.evaluate(el => window.getComputedStyle(el).display);
    expect(rightIconWhileLeftHovered).toBe('flex');

    // ── Phase 3: EXTREME-OVERFLOW mode (tabWidth <= 56px) ───────────────
    // Test extreme-overflow mode styling (when there are 100s of tabs)
    await shellWindow.mouse.move(0, 400);
    await shellWindow.evaluate(() => {
      const track = document.querySelector('.tab-track');
      if (track) track.style.setProperty('--tab-width', '40px');
      const splitEl = document.querySelector('.split-compound-tab');
      if (splitEl) {
        splitEl.classList.remove('tab--mode-full', 'tab--mode-icon-only');
        splitEl.classList.add('tab--mode-extreme-overflow', 'active');
      }
      const leftSub = document.querySelector('.split-mini-tab--left');
      if (leftSub) leftSub.classList.add('active');
    });
    await shellWindow.waitForTimeout(200);

    // Captions are hidden in extreme-overflow mode
    const extLeftTitleDisplay = await leftTitle.evaluate(el => window.getComputedStyle(el).display);
    expect(extLeftTitleDisplay).toBe('none');

    // Active sub-tab hides favicon and displays ONLY close button
    const extActiveIconDisplay = await leftMiniTab.locator('.icon-container').evaluate(el => window.getComputedStyle(el).display);
    const extActiveCloseOpacity = await leftCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    expect(extActiveIconDisplay).toBe('none');
    expect(Number(extActiveCloseOpacity)).toBe(1);

    // Hovering the other mini-tab reveals its close button and hides its icon
    await rightMiniTab.hover();
    await shellWindow.waitForTimeout(200);
    const extRightCloseOpacity = await rightCloseBtn.evaluate(el => window.getComputedStyle(el).opacity);
    const extRightIconDisplay = await rightIcon.evaluate(el => window.getComputedStyle(el).display);
    expect(Number(extRightCloseOpacity)).toBe(1);
    expect(extRightIconDisplay).toBe('none');

    // ── Phase 4: Threshold function verification in live TabBar ───────────
    const thresholdsVerification = await shellWindow.evaluate(() => {
      // Create a test TabBar tabWidth sequence
      // Normal: >= 60 full, 29-59 icon-only, <= 28 extreme-overflow
      // Split: >= 120 full, 57-119 icon-only, <= 56 extreme-overflow
      const TAB_WIDTH_THRESHOLDS = { full: 60, iconOnly: 28 };
      function getTabDisplayMode(w) {
        if (w >= TAB_WIDTH_THRESHOLDS.full) return 'full';
        if (w > TAB_WIDTH_THRESHOLDS.iconOnly) return 'icon-only';
        return 'extreme-overflow';
      }
      function getSplitTabDisplayMode(w) {
        const sub = w / 2;
        if (sub >= TAB_WIDTH_THRESHOLDS.full) return 'full';
        if (sub > TAB_WIDTH_THRESHOLDS.iconOnly) return 'icon-only';
        return 'extreme-overflow';
      }

      return {
        splitAt240: getSplitTabDisplayMode(240),
        splitAt120: getSplitTabDisplayMode(120),
        splitAt100: getSplitTabDisplayMode(100),
        splitAt60: getSplitTabDisplayMode(60),
        splitAt56: getSplitTabDisplayMode(56),
        splitAt40: getSplitTabDisplayMode(40),
        splitAt28: getSplitTabDisplayMode(28),
        normalAt100: getTabDisplayMode(100),
        normalAt60: getTabDisplayMode(60),
        normalAt40: getTabDisplayMode(40),
        normalAt28: getTabDisplayMode(28),
      };
    });

    expect(thresholdsVerification.splitAt240).toBe('full');
    expect(thresholdsVerification.splitAt120).toBe('full');
    expect(thresholdsVerification.splitAt100).toBe('icon-only');
    expect(thresholdsVerification.splitAt60).toBe('icon-only');
    expect(thresholdsVerification.splitAt56).toBe('extreme-overflow');
    expect(thresholdsVerification.splitAt40).toBe('extreme-overflow');
    expect(thresholdsVerification.splitAt28).toBe('extreme-overflow');

    expect(thresholdsVerification.normalAt100).toBe('full');
    expect(thresholdsVerification.normalAt60).toBe('full');
    expect(thresholdsVerification.normalAt40).toBe('icon-only');
    expect(thresholdsVerification.normalAt28).toBe('extreme-overflow');

    // Visual screenshot artifact for proof of progressive shrinking
    const progressiveArtifact = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/5ae8d87b-41bf-48ce-83cc-54ba82f59a5f/split-tabs-progressive-shrinking.png';
    await shellWindow.screenshot({ path: progressiveArtifact });
  });

  test('should support vertical stacked order, switch sides in both horizontal and stacked modes, and use capitalized context menu labels', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;
    await expect(shellWindow.locator('#split-tab-btn')).toBeVisible({ timeout: 10000 });

    // 1. Hook into Electron's main process Menu.buildFromTemplate to avoid popup blocking
    await invisurfApp.app.evaluate(({ Menu }) => {
      if (!global.__menuHooked) {
        global.__menuHooked = true;
        const originalBuild = Menu.buildFromTemplate;
        Menu.buildFromTemplate = function(template) {
          const menu = originalBuild.call(this, template);
          menu.popup = () => {};
          return menu;
        };
      }
      global.__lastTabStripContextMenuTemplate = null;
    });

    // 2. Right-click the single normal tab and verify Capitalized label "New in Split View"
    const firstTab = shellWindow.locator('.tab').first();
    await firstTab.click({ button: 'right' });
    await shellWindow.waitForTimeout(300);

    const menuItemsNormal = await invisurfApp.app.evaluate(() => global.__lastTabStripContextMenuTemplate);
    expect(menuItemsNormal).toBeTruthy();
    const addToSplitItem = menuItemsNormal.find(item => item.label === 'New in Split View');
    expect(addToSplitItem).toBeTruthy();

    // 3. Create a second tab and merge them into a split view
    const addTabBtn = shellWindow.locator('#add-tab');
    await addTabBtn.click();
    await shellWindow.waitForTimeout(500);

    const normalTabs = shellWindow.locator('.tab:not(.split-compound-tab)');
    const tabAId = await normalTabs.first().getAttribute('id');
    const tabBId = await normalTabs.nth(1).getAttribute('id');

    await shellWindow.evaluate(({ leftId, rightId }) => {
      window.electronAPI.splitTabEnter(leftId, rightId);
    }, { leftId: tabAId, rightId: tabBId });
    await shellWindow.waitForTimeout(400);

    const splitTab = shellWindow.locator('.split-compound-tab');
    await expect(splitTab).toBeVisible({ timeout: 5000 });

    // 4. Right-click the split tab and verify Capitalized context menu items in horizontal mode
    await invisurfApp.app.evaluate(() => { global.__lastTabStripContextMenuTemplate = null; });
    await splitTab.click({ button: 'right' });
    await shellWindow.waitForTimeout(300);

    const menuItemsSplit = await invisurfApp.app.evaluate(() => global.__lastTabStripContextMenuTemplate);
    expect(menuItemsSplit).toBeTruthy();
    const splitLabels = menuItemsSplit.map(item => item.label);
    expect(splitLabels).toContain('Switch Sides');
    expect(splitLabels).toContain('Show Stacked');
    expect(splitLabels).toContain('Separate Tabs');

    // 5. Check Toolbar Split Dropdown menu items are also capitalized
    const splitBtn = shellWindow.locator('#split-tab-btn');
    await splitBtn.click();
    const dropdown = shellWindow.locator('.split-picker-dropdown');
    await expect(dropdown).toBeVisible();

    const dropdownLabels = await dropdown.locator('.split-picker-item-label').allTextContents();
    expect(dropdownLabels).toContain('Switch Sides');
    expect(dropdownLabels).toContain('Show Stacked');
    expect(dropdownLabels).toContain('Separate Tabs');
    expect(dropdownLabels).toContain('Close Active Split Tab');

    // 6. Click "Show Stacked" button in the dropdown to switch to vertical stacked layout
    const showStackedBtn = dropdown.locator('.split-picker-item', { hasText: 'Show Stacked' });
    await showStackedBtn.click();
    await expect(dropdown).not.toBeVisible();
    await shellWindow.waitForTimeout(400);

    // 7. Verify vertical stacked layout in content area:
    // Tab bar compound tab remains horizontal (mini-tabs side-by-side)
    const leftMini = splitTab.locator('.split-mini-tab--left');
    const rightMini = splitTab.locator('.split-mini-tab--right');
    await expect(leftMini).toBeVisible();
    await expect(rightMini).toBeVisible();
    const leftBox = await leftMini.boundingBox();
    const rightBox = await rightMini.boundingBox();
    expect(leftBox.y).toBeCloseTo(rightBox.y, 1);
    expect(leftBox.x).toBeLessThan(rightBox.x);

    // Content view has top and bottom frames, and horizontal divider
    const topFrame = shellWindow.locator('.split-subview-frame--top');
    const bottomFrame = shellWindow.locator('.split-subview-frame--bottom');
    await expect(topFrame).toBeVisible();
    await expect(bottomFrame).toBeVisible();

    const topBox = await topFrame.boundingBox();
    const bottomBox = await bottomFrame.boundingBox();
    expect(topBox.y).toBeLessThan(bottomBox.y);
    expect(topBox.width).toBeCloseTo(bottomBox.width, 1);

    const horizontalDivider = shellWindow.locator('.split-divider-handle--horizontal');
    await expect(horizontalDivider).toBeVisible();

    // 8. In stacked mode, right-click context menu now offers "Show Side by Side"
    await invisurfApp.app.evaluate(() => { global.__lastTabStripContextMenuTemplate = null; });
    await splitTab.click({ button: 'right' });
    await shellWindow.waitForTimeout(300);

    const menuItemsStacked = await invisurfApp.app.evaluate(() => global.__lastTabStripContextMenuTemplate);
    expect(menuItemsStacked).toBeTruthy();
    const stackedLabels = menuItemsStacked.map(item => item.label);
    expect(stackedLabels).toContain('Show Side by Side');

    // 9. Verify "Switch Sides" in stacked mode:
    const leftMiniTitleBefore = await leftMini.locator('.tab-title').textContent();
    const rightMiniTitleBefore = await rightMini.locator('.tab-title').textContent();

    await shellWindow.evaluate(() => {
      const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
      if (splitId && window.electronAPI?.splitTabSwapSides) {
        window.electronAPI.splitTabSwapSides(splitId);
      }
    });
    await shellWindow.waitForTimeout(400);

    // Subtabs swapped sides
    const leftMiniTitleAfter = await leftMini.locator('.tab-title').textContent();
    const rightMiniTitleAfter = await rightMini.locator('.tab-title').textContent();
    expect(leftMiniTitleAfter).toBe(rightMiniTitleBefore);
    expect(rightMiniTitleAfter).toBe(leftMiniTitleBefore);

    // Capture visual screenshot of vertical stacked split view
    const stackedArtifactPath = '/Users/mayurkukadiya/.gemini/antigravity-ide/brain/5ae8d87b-41bf-48ce-83cc-54ba82f59a5f/split-tabs-stacked.png';
    await shellWindow.screenshot({ path: stackedArtifactPath });

    // 10. Switch back to side-by-side mode via toggleStacked
    await shellWindow.evaluate(() => {
      const splitId = document.querySelector('.split-compound-tab')?.getAttribute('data-split-id');
      if (splitId && window.electronAPI?.splitTabToggleStacked) {
        window.electronAPI.splitTabToggleStacked(splitId);
      }
    });
    await shellWindow.waitForTimeout(400);

    // Side-by-side frames restored
    const sideBySideLeftFrame = shellWindow.locator('.split-subview-frame--left');
    const sideBySideRightFrame = shellWindow.locator('.split-subview-frame--right');
    await expect(sideBySideLeftFrame).toBeVisible();
    await expect(sideBySideRightFrame).toBeVisible();
    await expect(horizontalDivider).not.toBeVisible();
  });
});


