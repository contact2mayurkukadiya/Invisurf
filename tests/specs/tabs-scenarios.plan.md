# InviSurf Tab Strip & Tab Management Scenario Test Plan

## Overview
The Tab Strip in InviSurf manages dynamic multi-tab browsing with Chrome-grade tab behaviors:
- Adaptive width calculations (240px preferred, shrinking to icon-only at 28px)
- Pinned tabs (fixed at 42px on the left)
- Tab creation via button, keyboard shortcuts, and context menu
- Tab switching via click, shortcuts, and directional cycling
- Multi-mode tab closing (hover-revealed close button, mouse wheel middle-click, keyboard shortcut)
- Tab strip context menu operations (Duplicate, Pin/Unpin, New tab right, Close tabs right, Close other tabs)
- Horizontal overflow and mouse-wheel scroll translation

---

## Detailed Scenarios

### Scenario 1: Tab Lifecycle & Creation (Button & Shortcut)
- **ID**: `1.1 tab-creation-and-keyboard-shortcuts`
- **Actions**:
  1. Count initial tab bar state (1 default tab).
  2. Click `#add-tab` button -> verify tab count increases to 2, new tab is active.
  3. Send shortcut for new tab (`Meta+T` / `Control+T` or shortcut event) -> verify count increases to 3.
  4. Verify that each tab has a unique `id` and `data-tab-id` attribute.

### Scenario 2: Tab Switching & Navigation Coordination
- **ID**: `1.2 tab-switching-and-order`
- **Actions**:
  1. Open 3 tabs with distinct URLs (e.g., NTP, `https://example.com`, `https://github.com`).
  2. Click tab 1 -> verify tab 1 has `.active` class, Omnibox displays empty/NTP placeholder.
  3. Click tab 2 -> verify tab 2 has `.active`, tab 1 loses `.active`, Omnibox updates to `example.com`.
  4. Click tab 3 -> verify tab 3 has `.active`, Omnibox updates to `github.com`.

### Scenario 3: Multi-Mode Tab Closing (Close Button, Middle Click, Shortcut)
- **ID**: `1.3 tab-closing-mechanisms`
- **Actions**:
  1. Open 4 tabs total.
  2. Hover over tab 4 to reveal `.close-btn` and click it -> verify tab 4 closes and tab count becomes 3.
  3. Middle-click (mouse button 1) on tab 3 -> verify middle-click closes tab 3, leaving 2 tabs.
  4. Trigger `shortcut-close-tab` on active tab 2 -> verify tab 2 closes and remaining tab 1 becomes active automatically.

### Scenario 4: Tab Pinning & Unpinning
- **ID**: `2.1 tab-pinning-and-unpinning`
- **Actions**:
  1. Open 2 tabs.
  2. Pin tab 1 via IPC/action (`setTabPinned`) -> verify tab 1 receives `.tab--pinned` class.
  3. Verify pinned tab width is compact (~42px) and placed on the far left.
  4. Unpin tab 1 -> verify `.tab--pinned` class is removed and tab returns to normal width.

### Scenario 5: Context Menu Operations (Duplicate, New Tab to Right, Close to Right)
- **ID**: `2.2 tab-strip-context-menu-actions`
- **Actions**:
  1. From active tab, invoke "New Tab to the Right" action -> verify new tab is inserted immediately after active tab.
  2. Invoke "Duplicate Tab" action -> verify duplicate tab is created with same URL and inserted adjacent.
  3. Invoke "Close Tabs to the Right" -> verify all tabs to the right of target tab are closed.
  4. Invoke "Close Other Tabs" -> verify all tabs except target tab are closed, leaving exactly 1 tab.

### Scenario 6: Tab Overflow & Responsive Width Adaptation
- **ID**: `3.1 tab-overflow-and-responsive-strip`
- **Actions**:
  1. Sequentially add tabs until 8 tabs are open.
  2. Measure individual tab bounding boxes -> verify tab widths adaptively scale down below 240px.
  3. Resize window to compact width (700px) -> verify tab strip switches to `.tab--mode-icon-only` or compact mode without UI crashing or breaking layout.
